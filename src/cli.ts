#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { send } from "./client.ts";

const args = process.argv.slice(2);
const cmd = args[0];
const arg = args[1];

if (cmd === "--help" || cmd === "-h" || !cmd) {
  printUsage();
  process.exit(0);
}

if (cmd === "--version" || cmd === "-v") {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  console.log(version);
  process.exit(0);
}

if (cmd === "open") {
  if (!arg) {
    console.error("usage: next-browser open <url> [--cookies-json <file>]");
    process.exit(1);
  }
  const url = /^https?:\/\//.test(arg) ? arg : `http://${arg}`;
  const cookieIdx = args.indexOf("--cookies-json");
  const cookieFile = cookieIdx >= 0 ? args[cookieIdx + 1] : undefined;

  if (cookieFile) {
    const res = await send("open");
    if (!res.ok) exit(res, "");
    const raw = readFileSync(cookieFile, "utf-8");
    const cookies = JSON.parse(raw);
    const domain = new URL(url).hostname;
    const cRes = await send("cookies", { cookies, domain });
    if (!cRes.ok) exit(cRes, "");
    await send("goto", { url });
    exit(res, `opened → ${url} (${cookies.length} cookies for ${domain})`);
  }

  const res = await send("open", { url });
  exit(res, `opened → ${url}`);
}

if (cmd === "ppr" && arg === "lock") {
  const res = await send("lock");
  exit(res, "locked");
}

if (cmd === "ppr" && arg === "unlock") {
  const res = await send("unlock");
  const d = res.ok ? (res.data as { text?: string } | string | null) : null;
  const text = typeof d === "string" ? d : d?.text ?? "";
  exit(res, res.ok ? `unlocked${text ? `\n\n${text}` : ""}` : "unlocked");
}

if (cmd === "reload") {
  const res = await send("reload");
  exit(res, res.ok ? `reloaded → ${res.data}` : "");
}

if (cmd === "perf") {
  const res = await send("perf", arg ? { url: arg } : {});
  if (!res.ok) exit(res, "");
  const d = res.data as {
    url: string;
    ttfb: number | null;
    lcp: { startTime: number; size: number; element: string | null; url: string | null } | null;
    cls: { score: number; entries: { value: number; startTime: number }[] };
    hydration: { startTime: number; endTime: number; duration: number } | null;
    phases: { label: string; startTime: number; endTime: number; duration: number }[];
    hydratedComponents: { name: string; startTime: number; endTime: number; duration: number }[];
  };
  const lines: string[] = [`# Page Load Profile — ${d.url}`, ""];

  // Core Web Vitals
  lines.push("## Core Web Vitals");
  const ttfbStr = d.ttfb != null ? `${d.ttfb}ms` : "—";
  lines.push(`  TTFB              ${ttfbStr.padStart(10)}`);
  if (d.lcp) {
    const lcpLabel = d.lcp.element ? ` (${d.lcp.element}${d.lcp.url ? `: ${d.lcp.url.slice(0, 60)}` : ""})` : "";
    lines.push(`  LCP               ${String(d.lcp.startTime + "ms").padStart(10)}${lcpLabel}`);
  } else {
    lines.push(`  LCP                        —`);
  }
  lines.push(`  CLS               ${String(d.cls.score).padStart(10)}`);
  lines.push("");

  // React Hydration
  if (d.hydration) {
    lines.push(`## React Hydration — ${d.hydration.duration}ms (${d.hydration.startTime}ms → ${d.hydration.endTime}ms)`);
  } else {
    lines.push("## React Hydration — no data (requires profiling build)");
  }
  if (d.phases.length > 0) {
    for (const p of d.phases) {
      lines.push(`  ${p.label.padEnd(28)} ${String(p.duration + "ms").padStart(10)}  (${p.startTime} → ${p.endTime})`);
    }
    lines.push("");
  }
  if (d.hydratedComponents.length > 0) {
    lines.push(`## Hydrated components (${d.hydratedComponents.length} total, sorted by duration)`);
    const top = d.hydratedComponents.slice(0, 30);
    for (const c of top) {
      lines.push(`  ${c.name.padEnd(40)} ${String(c.duration + "ms").padStart(10)}`);
    }
    if (d.hydratedComponents.length > 30) {
      lines.push(`  ... and ${d.hydratedComponents.length - 30} more`);
    }
  }
  exit(res, lines.join("\n"));
}

if (cmd === "restart-server") {
  const res = await send("restart");
  exit(res, res.ok ? `restarted → ${res.data}` : "");
}

if (cmd === "push") {
  if (arg) {
    const res = await send("push", { url: arg });
    exit(res, res.ok ? `→ ${res.data}` : "");
  }
  const linksRes = await send("links");
  if (!linksRes.ok) exit(linksRes, "");
  const links = linksRes.data as { href: string; text: string }[];
  if (links.length === 0) {
    console.error("no links on current page");
    process.exit(1);
  }
  const picked = await pick(links.map((l) => `${l.href}  ${l.text}`));
  const res = await send("push", { url: links[picked].href });
  exit(res, res.ok ? `→ ${res.data}` : "");
}

if (cmd === "goto") {
  const res = await send("goto", { url: arg });
  exit(res, res.ok ? `→ ${res.data}` : "");
}

if (cmd === "ssr" && arg === "lock") {
  const res = await send("ssr-lock");
  exit(res, "ssr locked — external scripts blocked on all navigations");
}

if (cmd === "ssr" && arg === "unlock") {
  const res = await send("ssr-unlock");
  exit(res, "ssr unlocked — external scripts re-enabled");
}


if (cmd === "back") {
  const res = await send("back");
  exit(res, "back");
}


if (cmd === "screenshot") {
  const fullPage = args.includes("--full-page");
  const caption = args.slice(1).filter((a) => a !== "--full-page").join(" ") || undefined;
  const res = await send("screenshot", { fullPage, caption });
  exit(res, res.ok ? String(res.data) : "");
}

if (cmd === "snapshot") {
  const res = await send("snapshot");
  exit(res, res.ok ? json(res.data) : "");
}

if (cmd === "click") {
  if (!arg) {
    console.error("usage: next-browser click <ref|text|selector>");
    process.exit(1);
  }
  const res = await send("click", { selector: arg });
  exit(res, "clicked");
}

if (cmd === "fill") {
  const value = args[2];
  if (!arg || value === undefined) {
    console.error("usage: next-browser fill <ref|selector> <value>");
    process.exit(1);
  }
  const res = await send("fill", { selector: arg, value });
  exit(res, "filled");
}

if (cmd === "eval") {
  // Check if first arg is a ref (e.g. "e3") — if so, second arg is the script
  let ref: string | undefined;
  let scriptArg = arg;
  let fileArgIdx = 2;
  if (arg && /^e\d+$/.test(arg)) {
    ref = arg;
    scriptArg = args[2];
    fileArgIdx = 3;
  }

  let script: string | undefined;
  if (scriptArg === "--file" || scriptArg === "-f") {
    const filePath = args[fileArgIdx];
    if (!filePath) {
      console.error("usage: next-browser eval [ref] --file <path>");
      process.exit(1);
    }
    script = readFileSync(filePath, "utf-8");
  } else if (scriptArg === "-") {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    script = Buffer.concat(chunks).toString("utf-8");
  } else {
    script = scriptArg;
  }
  if (!script) {
    console.error("usage: next-browser eval [ref] <script>\n       next-browser eval [ref] --file <path>\n       echo 'script' | next-browser eval -");
    process.exit(1);
  }
  const res = await send("eval", { script, ...(ref ? { selector: ref } : {}) });
  exit(res, res.ok ? json(res.data) : "");
}

if (cmd === "tree") {
  const res = arg != null
    ? await send("node", { nodeId: Number(arg) })
    : await send("tree");
  exit(res, res.ok ? String(res.data) : "");
}

const mcpTools: Record<string, string> = {
  errors: "get_errors",
  page: "get_page_metadata",
  project: "get_project_metadata",
  routes: "get_routes",
};

if (cmd in mcpTools) {
  const res = await send("mcp", { tool: mcpTools[cmd] });
  exit(res, res.ok ? json(res.data) : "");
}

if (cmd === "logs") {
  const res = await send("mcp", { tool: "get_logs" });
  if (!res.ok) exit(res, "");
  const data = res.data as { logFilePath?: string };
  if (!data?.logFilePath) exit(res, json(data));
  const content = readTail(data.logFilePath, 100);
  console.log(content || "(log file is empty)");
  process.exit(0);
}

if (cmd === "browser-logs") {
  const res = await send("browser-logs");
  if (!res.ok) exit(res, "");
  const entries = res.data as { level: string; args: string; timestamp: number }[];
  if (entries.length === 0) {
    console.log("(no console output captured)");
    process.exit(0);
  }
  const lines = entries.map(
    (e) => `[${e.level.toUpperCase().padEnd(5)}] ${e.args}`,
  );
  const output = lines.join("\n");
  if (output.length > 4000) {
    const path = join(tmpdir(), `next-browser-console-${process.pid}.log`);
    writeFileSync(path, output);
    console.log(`(${entries.length} entries written to ${path})`);
  } else {
    console.log(output);
  }
  process.exit(0);
}

if (cmd === "renders" && arg === "start") {
  const res = await send("renders-start");
  exit(res, "recording renders — interact with the page, then run `renders stop`");
}

if (cmd === "renders" && arg === "stop") {
  const useJson = args.includes("--json");
  const res = await send("renders-stop");
  if (!res.ok) exit(res, "");
  type Change = { type: string; name?: string; prev?: string; next?: string };
  type Component = {
    name: string;
    count: number;
    totalTime: number;
    selfTime: number;
    domMutations: number;
    changes: Change[];
    changeSummary: Record<string, number>;
  };
  const d = res.data as {
    elapsed: number;
    fps: { avg: number; min: number; max: number; drops: number };
    totalRenders: number;
    totalComponents: number;
    components: Component[];
  };

  if (d.components.length === 0) {
    if (useJson) console.log(JSON.stringify(d, null, 2));
    else console.log("(no renders captured)");
    process.exit(0);
  }

  if (useJson) {
    const output = JSON.stringify(d, null, 2);
    if (output.length > 4000) {
      const path = join(tmpdir(), `next-browser-renders-${process.pid}.json`);
      writeFileSync(path, output);
      console.log(path);
    } else {
      console.log(output);
    }
    process.exit(0);
  }

  const lines: string[] = [
    `# Render Profile — ${d.elapsed}s recording`,
    `# ${d.totalRenders} renders across ${d.totalComponents} components`,
    `# FPS: avg ${d.fps.avg}, min ${d.fps.min}, max ${d.fps.max}, drops (<30fps): ${d.fps.drops}`,
    "",
    "## Components by total render time",
  ];

  const nameW = Math.max(9, ...d.components.slice(0, 50).map((c) => c.name.length));
  const header = `| ${"Component".padEnd(nameW)} | Renders | Total    | Self     | DOM | Top change reason          |`;
  const sep    = `| ${"-".repeat(nameW)} | ------- | -------- | -------- | --- | -------------------------- |`;
  lines.push(header, sep);

  for (const c of d.components.slice(0, 50)) {
    const total = c.totalTime > 0 ? `${c.totalTime}ms` : "—";
    const self = c.selfTime > 0 ? `${c.selfTime}ms` : "—";
    const dom = `${c.domMutations}/${c.count}`;
    const topChange = Object.entries(c.changeSummary).sort((a, b) => b[1] - a[1])[0];
    const changeStr = topChange ? topChange[0] : "—";
    lines.push(
      `| ${c.name.padEnd(nameW)} | ${String(c.count).padStart(7)} | ${total.padStart(8)} | ${self.padStart(8)} | ${dom.padStart(3)} | ${changeStr.padEnd(26)} |`,
    );
  }
  if (d.components.length > 50) {
    lines.push(`... and ${d.components.length - 50} more`);
  }

  // Detail: show prev→next values for top components with non-mount changes
  const detailed = d.components
    .filter((c) => c.changes.some((ch) => ch.type !== "mount" && ch.type !== "parent"))
    .slice(0, 15);
  if (detailed.length > 0) {
    lines.push("", "## Change details (prev → next)");
    for (const c of detailed) {
      lines.push(`  ${c.name}`);
      // Deduplicate: show unique type+name combinations with their prev→next
      const seen = new Set<string>();
      for (const ch of c.changes) {
        if (ch.type === "mount" || ch.type === "parent") continue;
        const key = `${ch.type}:${ch.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = ch.type === "props" ? `props.${ch.name}`
          : ch.type === "state" ? `state (${ch.name})`
          : `context (${ch.name})`;
        lines.push(`    ${label}: ${ch.prev ?? "?"} → ${ch.next ?? "?"}`);
      }
    }
  }

  const output = lines.join("\n");
  if (output.length > 4000) {
    const path = join(tmpdir(), `next-browser-renders-${process.pid}.txt`);
    writeFileSync(path, output);
    console.log(`(${d.totalComponents} components written to ${path})`);
  } else {
    console.log(output);
  }
  process.exit(0);
}

if (cmd === "action") {
  const res = await send("mcp", { tool: "get_server_action_by_id", args: { actionId: arg } });
  exit(res, res.ok ? json(res.data) : "");
}

if (cmd === "network") {
  const res = await send("network", arg != null ? { idx: Number(arg) } : {});
  exit(res, res.ok ? String(res.data) : "");
}

if (cmd === "viewport") {
  if (arg) {
    const match = arg.match(/^(\d+)x(\d+)$/);
    if (!match) {
      console.error("usage: next-browser viewport <width>x<height>");
      process.exit(1);
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    const res = await send("viewport", { width, height });
    exit(res, res.ok ? `viewport set to ${width}x${height}` : "");
  }
  const res = await send("viewport", {});
  if (!res.ok) exit(res, "");
  const data = res.data as { width: number; height: number };
  exit(res, `${data.width}x${data.height}`);
}

if (cmd === "close") {
  const res = await send("close");
  exit(res, "closed");
}

console.error(`unknown command: ${cmd}\n`);
printUsage();
process.exit(1);

function exit(res: { ok: true; data?: unknown } | { ok: false; error: string }, message: string): never {
  if (res.ok) {
    console.log(message);
    process.exit(0);
  }
  console.error(`error: ${res.error}`);
  process.exit(1);
}

function json(data: unknown) {
  return JSON.stringify(data, null, 2);
}

function readTail(path: string, lines: number): string {
  try {
    const content = readFileSync(path, "utf-8");
    const all = content.split("\n");
    return all.slice(-lines).join("\n").trim();
  } catch {
    return `(could not read ${path})`;
  }
}

function pick(items: string[]): Promise<number> {
  return new Promise((resolve) => {
    let idx = 0;
    const render = () => {
      process.stdout.write("\x1B[?25l");
      for (let i = 0; i < items.length; i++) {
        if (i > 0) process.stdout.write("\n");
        process.stdout.write(i === idx ? `\x1B[36m❯ ${items[i]}\x1B[0m` : `  ${items[i]}`);
      }
      process.stdout.write(`\x1B[${items.length - 1}A\r`);
    };
    render();
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (key: Buffer) => {
      const k = key.toString();
      if (k === "\x1B[A" && idx > 0) { idx--; process.stdout.write(`\r\x1B[J`); render(); }
      else if (k === "\x1B[B" && idx < items.length - 1) { idx++; process.stdout.write(`\r\x1B[J`); render(); }
      else if (k === "\r" || k === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write(`\r\x1B[J\x1B[?25h`);
        resolve(idx);
      }
      else if (k === "\x03" || k === "q") {
        process.stdout.write(`\r\x1B[J\x1B[?25h`);
        process.exit(0);
      }
    });
  });
}

function printUsage() {
  console.error(
    "usage: next-browser <command> [args]\n" +
      "\n" +
      "  open <url> [--cookies-json <file>]  launch browser and navigate\n" +
      "  close              close browser and daemon\n" +
      "\n" +
      "  goto <url>         full-page navigation (new document load)\n" +
      "  ssr lock           block external scripts on all navigations\n" +
      "  ssr unlock         re-enable external scripts\n" +
      "  push [path]        client-side navigation (interactive picker if no path)\n" +
      "  back               go back in history\n" +
      "  reload             reload current page\n" +
      "  perf [url]         profile page load (CWVs + React hydration timing)\n" +
      "  renders start      start recording React re-renders\n" +
      "  renders stop [--json]  stop and print render profile\n" +
      "  restart-server     restart the Next.js dev server (clears fs cache)\n" +
      "\n" +
      "  ppr lock           enter PPR instant-navigation mode\n" +
      "  ppr unlock         exit PPR mode and show shell analysis\n" +
      "\n" +
      "  tree               show React component tree\n" +
      "  tree <id>          inspect component (props, hooks, state, source)\n" +
      "\n" +
      "  viewport [WxH]     show or set viewport size (e.g. 1280x720)\n" +
      "  screenshot [caption] [--full-page]  screenshot + Screenshot Log\n" +
      "  snapshot           accessibility tree with interactive refs\n" +
      "  click <ref|sel>    click an element (real pointer events)\n" +
      "  fill <ref|sel> <v> fill a text input\n" +
      "  eval [ref] <script> evaluate JS in page context\n" +
      "  eval --file <path> evaluate JS from a file\n" +
      "  eval -             evaluate JS from stdin\n" +
      "\n" +
      "  errors             show build/runtime errors\n" +
      "  logs               show recent dev server log output\n" +
      "  browser-logs       show browser console output (log/warn/error/info)\n" +
      "  network [idx]      list network requests, or inspect one\n" +
      "\n" +
      "  page               show current page segments and router info\n" +
      "  project            show project path and dev server url\n" +
      "  routes             list app routes\n" +
      "  action <id>        inspect a server action by id",
  );
}
