import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".next-browser");

export const cloudSocketDir = dir;
export const cloudSocketPath = join(dir, "cloud.sock");
export const cloudPidFile = join(dir, "cloud.pid");
export const cloudStateFile = join(dir, "cloud.json");
