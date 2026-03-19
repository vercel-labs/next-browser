#!/usr/bin/env node
import { readFileSync } from "node:fs";
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

if (cmd === "ssr-goto") {
  const res = await send("ssr-goto", { url: arg });
  exit(res, res.ok ? `→ ${res.data} (external scripts blocked)` : "");
}


if (cmd === "back") {
  const res = await send("back");
  exit(res, "back");
}

if (cmd === "screenshot") {
  const res = await send("screenshot");
  exit(res, res.ok ? String(res.data) : "");
}

if (cmd === "eval") {
  if (!arg) {
    console.error("usage: next-browser eval <script>");
    process.exit(1);
  }
  const res = await send("eval", { script: arg });
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
      "  ssr-goto <url>     goto but block external scripts (SSR shell)\n" +
      "  push [path]        client-side navigation (interactive picker if no path)\n" +
      "  back               go back in history\n" +
      "  reload             reload current page\n" +
      "  perf [url]         profile page load (CWVs + React hydration timing)\n" +
      "  restart-server     restart the Next.js dev server (clears fs cache)\n" +
      "\n" +
      "  ppr lock           enter PPR instant-navigation mode\n" +
      "  ppr unlock         exit PPR mode and show shell analysis\n" +
      "\n" +
      "  tree               show React component tree\n" +
      "  tree <id>          inspect component (props, hooks, state, source)\n" +
      "\n" +
      "  viewport [WxH]     show or set viewport size (e.g. 1280x720)\n" +
      "  screenshot         save full-page screenshot to tmp file\n" +
      "  eval <script>      evaluate JS in page context\n" +
      "\n" +
      "  errors             show build/runtime errors\n" +
      "  logs               show recent dev server log output\n" +
      "  network [idx]      list network requests, or inspect one\n" +
      "\n" +
      "  page               show current page segments and router info\n" +
      "  project            show project path and dev server url\n" +
      "  routes             list app routes\n" +
      "  action <id>        inspect a server action by id",
  );
}
