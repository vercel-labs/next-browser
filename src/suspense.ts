import type { Page } from "playwright";
import * as sourcemap from "./sourcemap.ts";

export type Boundary = {
  id: number;
  parentID: number;
  name: string | null;
  isSuspended: boolean;
  environments: string[];
  suspendedBy: Suspender[];
  unknownSuspenders: string | null;
  owners: string[];
  jsxSource: [string, number, number] | null;
};

export type Suspender = {
  name: string;
  description: string;
  duration: number;
  env: string | null;
  ownerName: string | null;
  awaiterName: string | null;
};

export async function snapshot(page: Page): Promise<Boundary[]> {
  return page.evaluate(inPageSuspense, true);
}

export async function countBoundaries(page: Page): Promise<{ total: number; suspended: number }> {
  const boundaries = await page.evaluate(inPageSuspense, false).catch(() => [] as Boundary[]);
  const nonRoot = boundaries.filter((b) => b.parentID !== 0);
  return { total: nonRoot.length, suspended: nonRoot.filter((b) => b.isSuspended).length };
}

export async function snapshotFromDom(page: Page): Promise<Boundary[]> {
  const count = await page.evaluate(() =>
    document.querySelectorAll('template[id^="B:"]').length,
  ).catch(() => 0);

  const boundaries: Boundary[] = [];
  for (let i = 0; i < count; i++) {
    boundaries.push({
      id: -(i + 1),
      parentID: 1,
      name: `shell-hole-${i}`,
      isSuspended: true,
      environments: [],
      suspendedBy: [],
      unknownSuspenders: null,
      owners: [],
      jsxSource: null,
    });
  }
  return boundaries;
}

export async function formatAnalysis(
  unlocked: Boundary[],
  locked: Boundary[],
  origin: string,
): Promise<string> {
  await resolveSources(unlocked, origin);
  await resolveSources(locked, origin);

  const fromDom = locked.length > 0 && locked[0].id < 0;

  const holes: { shell: Boundary; full: Boundary | undefined }[] = [];
  const statics: Boundary[] = [];

  if (fromDom) {
    const dynamicUnlocked = unlocked.filter(
      (b) => b.parentID !== 0 && b.suspendedBy.length > 0,
    );
    for (const lb of locked) {
      const match = dynamicUnlocked.shift();
      holes.push({ shell: lb, full: match });
    }
    for (const ub of unlocked) {
      if (ub.parentID !== 0 && ub.suspendedBy.length === 0) statics.push(ub);
    }
  } else {
    const unlockedByKey = new Map<string, Boundary>();
    for (const b of unlocked) unlockedByKey.set(boundaryKey(b), b);
    for (const lb of locked) {
      if (lb.isSuspended) {
        holes.push({ shell: lb, full: unlockedByKey.get(boundaryKey(lb)) });
      } else {
        statics.push(lb);
      }
    }
  }

  const totalBoundaries = fromDom ? holes.length + statics.length : locked.length;

  const lines = [
    "# PPR Shell Analysis",
    `# ${totalBoundaries} boundaries: ${holes.length} dynamic holes, ${statics.length} static`,
    "",
  ];

  if (holes.length > 0) {
    lines.push("## Dynamic holes (suspended in shell)");
    for (const { shell, full } of holes) {
      const b = full ?? shell;
      const name = b.name?.startsWith("shell-hole") ? "(hole)" : (b.name ?? "(unnamed)");
      const src = b.jsxSource ? `${b.jsxSource[0]}:${b.jsxSource[1]}:${b.jsxSource[2]}` : null;
      lines.push(`  ${name}${src ? ` at ${src}` : ""}`);
      if (b.owners.length > 0) lines.push(`    rendered by: ${b.owners.join(" > ")}`);
      if (shell.environments.length > 0) lines.push(`    environments: ${shell.environments.join(", ")}`);
      if (full && full.suspendedBy.length > 0) {
        lines.push("    blocked by:");
        for (const s of full.suspendedBy) {
          const dur = s.duration > 0 ? ` (${s.duration}ms)` : "";
          const env = s.env ? ` [${s.env}]` : "";
          const owner = s.ownerName ? ` initiated by <${s.ownerName}>` : "";
          const awaiter = s.awaiterName ? ` awaited in <${s.awaiterName}>` : "";
          lines.push(`      - ${s.name}: ${s.description || "(no description)"}${dur}${env}${owner}${awaiter}`);
        }
      } else if (full?.unknownSuspenders) {
        lines.push(`    suspenders unknown: ${full.unknownSuspenders}`);
      }
    }
    lines.push("");
  }

  if (statics.length > 0) {
    lines.push("## Static (pre-rendered in shell)");
    for (const b of statics) {
      const name = b.name ?? "(unnamed)";
      const src = b.jsxSource ? ` at ${b.jsxSource[0]}:${b.jsxSource[1]}:${b.jsxSource[2]}` : "";
      lines.push(`  ${name}${src}`);
    }
  }

  return lines.join("\n");
}

function boundaryKey(b: Boundary): string {
  if (b.jsxSource) return `${b.jsxSource[0]}:${b.jsxSource[1]}:${b.jsxSource[2]}`;
  return b.name ?? `id-${b.id}`;
}

async function resolveSources(boundaries: Boundary[], origin: string) {
  for (const b of boundaries) {
    if (b.jsxSource) {
      const [file, line, col] = b.jsxSource;
      const resolved =
        (await sourcemap.resolve(origin, file, line, col)) ??
        (await sourcemap.resolveViaMap(origin, file, line, col));
      if (resolved) b.jsxSource = [resolved.file, resolved.line, resolved.column];
    }
  }
}

async function inPageSuspense(inspect: boolean): Promise<Boundary[]> {
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) throw new Error("React DevTools hook not installed");
  const ri = hook.rendererInterfaces?.get?.(1);
  if (!ri) throw new Error("no React renderer attached");

  const batches = await collect(ri);

  const boundaryMap = new Map<
    number,
    {
      id: number;
      parentID: number;
      name: string | null;
      isSuspended: boolean;
      environments: string[];
    }
  >();

  for (const ops of batches) decodeSuspenseOps(ops, boundaryMap);

  const results: Boundary[] = [];

  for (const b of boundaryMap.values()) {
    if (b.parentID === 0) continue;

    const boundary: Boundary = {
      id: b.id,
      parentID: b.parentID,
      name: b.name,
      isSuspended: b.isSuspended,
      environments: b.environments,
      suspendedBy: [],
      unknownSuspenders: null,
      owners: [],
      jsxSource: null,
    };

    if (inspect && ri.hasElementWithId(b.id)) {
      const displayName = ri.getDisplayNameForElementID(b.id);
      if (displayName) boundary.name = displayName;
      const result = ri.inspectElement(1, b.id, null, true);
      if (result?.type === "full-data") {
        parseInspection(boundary, result.value);
      }
    }

    results.push(boundary);
  }

  return results;

  function collect(renderer: { flushInitialOperations: () => void }) {
    return new Promise<number[][]>((resolve) => {
      const out: number[][] = [];
      const listener = (e: MessageEvent) => {
        const p = e.data?.payload;
        if (e.data?.source === "react-devtools-bridge" && p?.event === "operations") {
          out.push(p.payload);
        }
      };
      window.addEventListener("message", listener);
      renderer.flushInitialOperations();
      setTimeout(() => {
        window.removeEventListener("message", listener);
        resolve(out);
      }, 50);
    });
  }

  function decodeSuspenseOps(
    ops: number[],
    map: Map<number, { id: number; parentID: number; name: string | null; isSuspended: boolean; environments: string[] }>,
  ) {
    let i = 2;

    const strings: (string | null)[] = [null];
    const tableEnd = ++i + ops[i - 1];
    while (i < tableEnd) {
      const len = ops[i++];
      strings.push(String.fromCodePoint(...ops.slice(i, i + len)));
      i += len;
    }

    while (i < ops.length) {
      const op = ops[i];

      if (op === 1) {
        const type = ops[i + 2];
        i += 3 + (type === 11 ? 4 : 5);
      } else if (op === 2) {
        i += 2 + ops[i + 1];
      } else if (op === 3) {
        i += 3 + ops[i + 2];
      } else if (op === 4) {
        i += 3;
      } else if (op === 5) {
        i += 4;
      } else if (op === 6) {
        i++;
      } else if (op === 7) {
        i += 3;
      } else if (op === 8) {
        const id = ops[i + 1];
        const parentID = ops[i + 2];
        const nameStrID = ops[i + 3];
        const isSuspended = ops[i + 4] === 1;
        const numRects = ops[i + 5];
        i += 6;
        if (numRects !== -1) i += numRects * 4;

        map.set(id, {
          id,
          parentID,
          name: strings[nameStrID] ?? null,
          isSuspended,
          environments: [],
        });
      } else if (op === 9) {
        i += 2 + ops[i + 1];
      } else if (op === 10) {
        i += 3 + ops[i + 2];
      } else if (op === 11) {
        const numRects = ops[i + 2];
        i += 3;
        if (numRects !== -1) i += numRects * 4;
      } else if (op === 12) {
        i++;
        const changeLen = ops[i++];
        for (let c = 0; c < changeLen; c++) {
          const id = ops[i++];
          i++; // hasUniqueSuspenders
          i++; // endTime
          const isSuspended = ops[i++] === 1;
          const envLen = ops[i++];
          const envs: string[] = [];
          for (let e = 0; e < envLen; e++) {
            const name = strings[ops[i++]];
            if (name != null) envs.push(name);
          }

          const node = map.get(id);
          if (node) {
            node.isSuspended = isSuspended;
            for (const env of envs) {
              if (!node.environments.includes(env)) node.environments.push(env);
            }
          }
        }
      } else if (op === 13) {
        i += 2;
      } else {
        i++;
      }
    }
  }

  function parseInspection(boundary: Boundary, data: any) {
    const rawSuspendedBy = data.suspendedBy;
    const rawSuspenders = Array.isArray(rawSuspendedBy)
      ? rawSuspendedBy
      : Array.isArray(rawSuspendedBy?.data)
        ? rawSuspendedBy.data
        : null;

    if (rawSuspenders) {
      for (const entry of rawSuspenders) {
        const awaited = entry?.awaited;
        if (!awaited) continue;
        const desc = preview(awaited.description) || preview(awaited.value);
        boundary.suspendedBy.push({
          name: awaited.name ?? "unknown",
          description: desc,
          duration: awaited.end && awaited.start ? Math.round(awaited.end - awaited.start) : 0,
          env: awaited.env ?? entry?.env ?? null,
          ownerName: awaited.owner?.displayName ?? null,
          awaiterName: entry?.owner?.displayName ?? null,
        });
      }
    }

    if (data.unknownSuspenders && data.unknownSuspenders !== 0) {
      const reasons: Record<number, string> = {
        1: "production build (no debug info)",
        2: "old React version (missing tracking)",
        3: "thrown Promise (library using throw instead of use())",
      };
      boundary.unknownSuspenders = reasons[data.unknownSuspenders] ?? "unknown reason";
    }

    if (Array.isArray(data.owners)) {
      for (const o of data.owners) {
        if (o?.displayName) boundary.owners.push(o.displayName);
      }
    }

    if (Array.isArray(data.stack) && data.stack.length > 0) {
      const frame = data.stack[0];
      if (Array.isArray(frame) && frame.length >= 4) {
        boundary.jsxSource = [frame[1] || "(unknown)", frame[2], frame[3]];
      }
    }
  }

  function preview(v: any): string {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v !== "object") return String(v);
    if (typeof v.preview_long === "string") return v.preview_long;
    if (typeof v.preview_short === "string") return v.preview_short;
    if (typeof v.value === "string") return v.value;
    try {
      const s = JSON.stringify(v);
      return s.length > 80 ? s.slice(0, 77) + "..." : s;
    } catch {
      return "";
    }
  }
}
