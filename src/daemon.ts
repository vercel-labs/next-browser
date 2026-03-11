import { createServer } from "node:net";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import type { Socket } from "node:net";
import * as browser from "./browser.ts";
import { socketDir, socketPath, pidFile } from "./paths.ts";

mkdirSync(socketDir, { recursive: true, mode: 0o700 });
rmSync(socketPath, { force: true });
rmSync(pidFile, { force: true });

writeFileSync(pidFile, String(process.pid));

const server = createServer((socket) => {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line) dispatch(line, socket);
    }
  });
  socket.on("error", () => {});
});

server.listen(socketPath);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", cleanup);

async function dispatch(line: string, socket: Socket) {
  const cmd = JSON.parse(line);
  const result = await run(cmd).catch((err) => ({ ok: false, error: cleanError(err) }));
  socket.write(JSON.stringify({ id: cmd.id, ...result }) + "\n");
  if (cmd.action === "close") setImmediate(shutdown);
}

function cleanError(err: Error) {
  const msg = err.message;
  const m = msg.match(/^page\.\w+: (?:Error: )?(.+?)(?:\n|$)/);
  return m ? m[1] : msg;
}

type Cmd = {
  action: string;
  url?: string;
  nodeId?: number;
  tool?: string;
  args?: Record<string, unknown>;
  script?: string;
  idx?: number;
  cookies?: { name: string; value: string }[];
  domain?: string;
  width?: number | null;
  height?: number | null;
};

async function run(cmd: Cmd) {
  if (cmd.action === "open") {
    await browser.open(cmd.url);
    return { ok: true };
  }
  if (cmd.action === "cookies") {
    const data = await browser.cookies(cmd.cookies!, cmd.domain!);
    return { ok: true, data };
  }
  if (cmd.action === "lock") {
    await browser.lock();
    return { ok: true };
  }
  if (cmd.action === "unlock") {
    const data = await browser.unlock();
    return { ok: true, data };
  }
  if (cmd.action === "reload") {
    const data = await browser.reload();
    return { ok: true, data };
  }
  if (cmd.action === "capture-goto") {
    const data = await browser.captureGoto(cmd.url as string | undefined);
    return { ok: true, data };
  }
  if (cmd.action === "restart") {
    const data = await browser.restart();
    return { ok: true, data };
  }
  if (cmd.action === "screenshot") {
    const data = await browser.screenshot();
    return { ok: true, data };
  }
  if (cmd.action === "links") {
    const data = await browser.links();
    return { ok: true, data };
  }
  if (cmd.action === "push") {
    const data = await browser.push(cmd.url!);
    return { ok: true, data };
  }
  if (cmd.action === "goto") {
    const data = await browser.goto(cmd.url!);
    return { ok: true, data };
  }
  if (cmd.action === "back") {
    await browser.back();
    return { ok: true };
  }
  if (cmd.action === "tree") {
    const data = await browser.tree();
    return { ok: true, data };
  }
  if (cmd.action === "node") {
    const data = await browser.node(cmd.nodeId!);
    return { ok: true, data };
  }
  if (cmd.action === "eval") {
    const data = await browser.evaluate(cmd.script!);
    return { ok: true, data };
  }
  if (cmd.action === "mcp") {
    const data = await browser.mcp(cmd.tool!, cmd.args);
    return { ok: true, data };
  }
  if (cmd.action === "network") {
    const data = await browser.network(cmd.idx);
    return { ok: true, data };
  }
  if (cmd.action === "viewport") {
    if (cmd.width !== undefined) {
      const data = await browser.viewport(cmd.width, cmd.height!);
      return { ok: true, data };
    }
    const data = await browser.viewportSize();
    return { ok: true, data };
  }
  if (cmd.action === "close") {
    await browser.close();
    return { ok: true };
  }
  return { ok: false, error: `unknown action: ${cmd.action}` };
}

async function shutdown() {
  await browser.close();
  server.close();
  cleanup();
  process.exit(0);
}

function cleanup() {
  rmSync(socketPath, { force: true });
  rmSync(pidFile, { force: true });
}
