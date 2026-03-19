import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".next-browser");

export const socketDir = dir;
export const socketPath =
  process.platform === "win32"
    ? "//./pipe/next-browser-default"
    : join(dir, "default.sock");
export const pidFile = join(dir, "default.pid");
