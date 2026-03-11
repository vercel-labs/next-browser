import { createServer } from "node:net";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import type { Socket } from "node:net";
import * as cloud from "./cloud.ts";
import { cloudSocketDir, cloudSocketPath, cloudPidFile } from "./cloud-paths.ts";

mkdirSync(cloudSocketDir, { recursive: true, mode: 0o700 });
rmSync(cloudSocketPath, { force: true });
rmSync(cloudPidFile, { force: true });

writeFileSync(cloudPidFile, String(process.pid));

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

server.listen(cloudSocketPath);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", cleanup);

async function dispatch(line: string, socket: Socket) {
  const cmd = JSON.parse(line);
  const result = await run(cmd).catch((err: Error) => ({
    ok: false,
    error: err.message,
  }));
  socket.write(JSON.stringify({ id: cmd.id, ...result }) + "\n");
  if (cmd.action === "destroy") setImmediate(shutdown);
}

type Cmd = {
  action: string;
  command?: string;
  localPath?: string;
  remotePath?: string;
};

async function run(cmd: Cmd) {
  if (cmd.action === "create") {
    const data = await cloud.create();
    return { ok: true, data };
  }
  if (cmd.action === "exec") {
    if (!cmd.command) return { ok: false, error: "missing command" };
    const result = await cloud.exec(cmd.command);
    const data = [
      result.stdout,
      result.stderr ? `stderr:\n${result.stderr}` : "",
      result.exitCode !== 0 ? `exit code: ${result.exitCode}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return { ok: result.exitCode === 0, data };
  }
  if (cmd.action === "status") {
    const data = await cloud.status();
    return { ok: true, data };
  }
  if (cmd.action === "upload") {
    if (!cmd.localPath || !cmd.remotePath) return { ok: false, error: "missing localPath or remotePath" };
    const data = await cloud.upload(cmd.localPath, cmd.remotePath);
    return { ok: true, data };
  }
  if (cmd.action === "destroy") {
    const data = await cloud.destroy();
    return { ok: true, data };
  }
  return { ok: false, error: `unknown action: ${cmd.action}` };
}

async function shutdown() {
  try {
    await cloud.destroy();
  } catch {
    // best effort
  }
  server.close();
  cleanup();
  process.exit(0);
}

function cleanup() {
  rmSync(cloudSocketPath, { force: true });
  rmSync(cloudPidFile, { force: true });
}
