import { connect as netConnect, type Socket } from "node:net";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { socketPath, pidFile } from "./paths.ts";

export type Response = { ok: true; data?: unknown } | { ok: false; error: string };

export async function send(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<Response> {
  await ensureDaemon();
  const socket = await connect();
  const id = String(Date.now());
  socket.write(JSON.stringify({ id, action, ...payload }) + "\n");
  const line = await readLine(socket);
  socket.end();
  return JSON.parse(line);
}

async function ensureDaemon() {
  if (daemonAlive() && (await connect().then(ok, no))) return;

  const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const daemon = fileURLToPath(new URL(`./daemon${ext}`, import.meta.url));
  const child = spawn(process.execPath, [daemon], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  for (let i = 0; i < 50; i++) {
    if (await connect().then(ok, no)) return;
    await sleep(100);
  }
  throw new Error(`daemon failed to start (${socketPath})`);
}

function daemonAlive() {
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, "utf-8"));
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    rmSync(pidFile, { force: true });
    rmSync(socketPath, { force: true });
    return false;
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(socketPath);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function readLine(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline >= 0) resolve(buffer.slice(0, newline));
    });
    socket.on("error", reject);
  });
}

function ok(s: Socket) {
  s.destroy();
  return true;
}

function no() {
  return false;
}
