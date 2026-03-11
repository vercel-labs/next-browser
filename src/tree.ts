import type { Page } from "playwright";

export type Node = {
  id: number;
  type: number;
  name: string | null;
  key: string | null;
  parent: number;
};

export async function snapshot(page: Page): Promise<Node[]> {
  return page.evaluate(inPageSnapshot);
}

export type Inspection = {
  text: string;
  source: [file: string, line: number, column: number] | null;
};

export async function inspect(page: Page, id: number): Promise<Inspection> {
  return page.evaluate(inPageInspect, id);
}

export function path(nodes: Node[], id: number): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const names: string[] = [];
  for (let n = byId.get(id); n; n = byId.get(n.parent)) {
    names.push(n.name ?? typeName(n.type));
  }
  return names.reverse().join(" > ");
}

const HEADER =
  "# React component tree\n" +
  "# Columns: depth id parent name [key=...]\n" +
  "# Use `tree <id>` for props/hooks/state. IDs valid until next navigation.\n";

export function format(nodes: Node[]): string {
  const children = new Map<number, Node[]>();
  for (const n of nodes) {
    const list = children.get(n.parent) ?? [];
    list.push(n);
    children.set(n.parent, list);
  }

  const lines: string[] = [HEADER];
  for (const root of children.get(0) ?? []) walk(root, 0);
  return lines.join("\n");

  function walk(node: Node, depth: number) {
    const name = node.name ?? typeName(node.type);
    const key = node.key ? ` key=${JSON.stringify(node.key)}` : "";
    const parent = node.parent || "-";
    lines.push(`${depth} ${node.id} ${parent} ${name}${key}`);
    for (const c of children.get(node.id) ?? []) walk(c, depth + 1);
  }
}

function typeName(type: number): string {
  const names: Record<number, string> = {
    11: "Root",
    12: "Suspense",
    13: "SuspenseList",
  };
  return names[type] ?? `(${type})`;
}

/**
 * Runs inside the page. Asks the DevTools backend to flush the full
 * component tree as an operations batch, then decodes TREE_OPERATION_ADD
 * entries into a flat node list.
 *
 * Wire format (React DevTools v6/v7):
 *   Header:  [rendererID, rootID, stringTableSize, ...stringTable]
 *   ADD:     [1, id, type, ...4 ints]              if type == 11 (Root)
 *            [1, id, type, parentID, ownerID,
 *                displayNameStrID, keyStrID, _]    otherwise
 */
async function inPageSnapshot(): Promise<Node[]> {
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) throw new Error("React DevTools hook not installed");

  const ri = hook.rendererInterfaces?.get?.(1);
  if (!ri) throw new Error("no React renderer attached");

  const batches = await collect(ri);
  return batches.flatMap(decode);

  function collect(ri: { flushInitialOperations: () => void }) {
    return new Promise<number[][]>((resolve) => {
      const out: number[][] = [];

      // Listen on the hook directly (works in both headed and headless)
      const origEmit = hook.emit;
      hook.emit = function (event: string, data: number[]) {
        if (event === "operations") out.push(Array.from(data));
        return origEmit.apply(hook, arguments);
      };

      ri.flushInitialOperations();

      setTimeout(() => {
        hook.emit = origEmit;
        resolve(out);
      }, 50);
    });
  }

  function decode(ops: number[]): Node[] {
    let i = 2;

    const strings: (string | null)[] = [null];
    const tableEnd = ++i + ops[i - 1];
    while (i < tableEnd) {
      const len = ops[i++];
      strings.push(String.fromCodePoint(...ops.slice(i, i + len)));
      i += len;
    }

    const nodes: Node[] = [];
    while (i < ops.length) {
      const op = ops[i];
      if (op === 1) {
        const id = ops[i + 1];
        const type = ops[i + 2];
        i += 3;
        if (type === 11) {
          nodes.push({ id, type, name: null, key: null, parent: 0 });
          i += 4;
        } else {
          nodes.push({
            id,
            type,
            name: strings[ops[i + 2]] ?? null,
            key: strings[ops[i + 3]] ?? null,
            parent: ops[i],
          });
          i += 5;
        }
      } else {
        i += skip(op, ops, i);
      }
    }
    return nodes;
  }

  function skip(op: number, ops: number[], i: number): number {
    if (op === 2) return 2 + ops[i + 1];
    if (op === 3) return 3 + ops[i + 2];
    if (op === 4) return 3;
    if (op === 5) return 4;
    if (op === 6) return 1;
    if (op === 7) return 3;
    if (op === 8) return 6 + rects(ops[i + 5]);
    if (op === 9) return 2 + ops[i + 1];
    if (op === 10) return 3 + ops[i + 2];
    if (op === 11) return 3 + rects(ops[i + 2]);
    if (op === 12) return suspenders(ops, i);
    if (op === 13) return 2;
    return 1;
  }

  function rects(n: number) {
    return n === -1 ? 0 : n * 4;
  }

  function suspenders(ops: number[], i: number) {
    let j = i + 2;
    for (let c = 0; c < ops[i + 1]; c++) j += 5 + ops[j + 4];
    return j - i;
  }
}

/**
 * Runs inside the page. Calls rendererInterface.inspectElement(id) —
 * the same call the DevTools sidebar uses — and formats the dehydrated
 * props/hooks/state into a plain-text summary.
 */
function inPageInspect(id: number): Inspection {
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const ri = hook?.rendererInterfaces?.get?.(1);
  if (!ri) throw new Error("no React renderer attached");
  if (!ri.hasElementWithId(id)) throw new Error(`element ${id} not found (page reloaded?)`);

  const result = ri.inspectElement(1, id, null, true);
  if (result?.type !== "full-data") throw new Error(`inspect failed: ${result?.type}`);

  const v = result.value;
  const name = ri.getDisplayNameForElementID(id);
  const lines: string[] = [`${name} #${id}`];

  if (v.key != null) lines.push(`key: ${JSON.stringify(v.key)}`);

  section("props", v.props);
  section("hooks", v.hooks);
  section("state", v.state);
  section("context", v.context);

  if (v.owners?.length) {
    const chain = v.owners.map((o: { displayName: string }) => o.displayName).join(" > ");
    lines.push(`rendered by: ${chain}`);
  }

  const source = Array.isArray(v.source)
    ? ([v.source[1], v.source[2], v.source[3]] as [string, number, number])
    : null;

  return { text: lines.join("\n"), source };

  function section(label: string, payload: unknown) {
    const data = (payload as { data?: unknown })?.data ?? payload;
    if (data == null) return;
    if (Array.isArray(data)) {
      if (data.length === 0) return;
      lines.push(`${label}:`);
      for (const h of data) lines.push(`  ${hookLine(h)}`);
    } else if (typeof data === "object") {
      const entries = Object.entries(data);
      if (entries.length === 0) return;
      lines.push(`${label}:`);
      for (const [k, val] of entries) lines.push(`  ${k}: ${preview(val)}`);
    }
  }

  function hookLine(h: { id: number | null; name: string; value: unknown; subHooks?: unknown[] }) {
    const idx = h.id != null ? `[${h.id}] ` : "";
    const sub = h.subHooks?.length ? ` (${h.subHooks.length} sub)` : "";
    return `${idx}${h.name}: ${preview(h.value)}${sub}`;
  }

  function preview(v: unknown): string {
    if (v == null) return String(v);
    if (typeof v !== "object") return JSON.stringify(v);
    const d = v as { type?: string; preview_long?: string; preview_short?: string };
    if (d.type === "undefined") return "undefined";
    if (d.preview_long) return d.preview_long;
    if (d.preview_short) return d.preview_short;
    if (Array.isArray(v)) return `[${v.map(preview).join(", ")}]`;
    const entries = Object.entries(v).map(([k, val]) => `${k}: ${preview(val)}`);
    return `{${entries.join(", ")}}`;
  }
}
