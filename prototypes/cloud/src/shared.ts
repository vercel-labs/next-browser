/**
 * Shared utilities for cloud prototypes.
 * Wraps @vercel/sandbox with helpers from the dev3000 reference implementation.
 */

import { Sandbox } from "@vercel/sandbox";

// Load env from agent-eval's .env.local
import { readFileSync } from "fs";
import { join } from "path";

const AGENT_EVAL_ENV = join(
  process.env.HOME || "/Users/judegao",
  "workspace/repo/agent-eval/.env.local"
);

export function loadEnv() {
  try {
    const content = readFileSync(AGENT_EVAL_ENV, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      let value = trimmed.slice(eqIdx + 1);
      // Strip quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    console.log("[env] Loaded credentials from agent-eval/.env.local");
  } catch {
    console.log("[env] No .env.local found, using existing env vars");
  }
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command in sandbox, collecting streamed output.
 */
export async function run(
  sandbox: Sandbox,
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string> }
): Promise<CommandResult> {
  const result = await sandbox.runCommand({
    cmd,
    args,
    cwd: opts?.cwd,
    env: opts?.env,
  });

  let stdout = "";
  let stderr = "";
  for await (const log of result.logs()) {
    if (log.stream === "stdout") {
      stdout += log.data;
    } else {
      stderr += log.data;
    }
  }

  await result.wait();

  return { exitCode: result.exitCode, stdout, stderr };
}

/**
 * Run a shell command in sandbox.
 */
export async function shell(
  sandbox: Sandbox,
  command: string,
  opts?: { cwd?: string; env?: Record<string, string> }
): Promise<CommandResult> {
  return run(sandbox, "bash", ["-lc", command], opts);
}

/**
 * Run a detached command (background process) and optionally stream its logs.
 */
export async function runDetached(
  sandbox: Sandbox,
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string> }
) {
  const result = await sandbox.runCommand({
    cmd,
    args,
    cwd: opts?.cwd,
    env: opts?.env,
    detached: true,
  });
  return result;
}

/**
 * Wait for a port to be available inside the sandbox.
 */
export async function waitForPort(
  sandbox: Sandbox,
  port: number,
  timeoutMs = 60000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await shell(
      sandbox,
      `curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://localhost:${port}/ 2>/dev/null || echo "000"`
    );
    const code = result.stdout.trim();
    if (code !== "000" && code !== "") {
      console.log(`[port] localhost:${port} responded with HTTP ${code}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Port ${port} did not become available within ${timeoutMs}ms`);
}

/**
 * System dependencies required for Chromium on Amazon Linux 2023.
 * From dev3000 sandbox-chrome.ts reference.
 */
const SYSTEM_DEPS = [
  "nspr", "nss", "atk", "at-spi2-atk", "cups-libs", "libdrm",
  "libxkbcommon", "libXcomposite", "libXdamage", "libXfixes",
  "libXrandr", "mesa-libgbm", "alsa-lib", "cairo", "pango",
  "glib2", "gtk3", "libX11", "libXext", "libXcursor", "libXi", "libXtst",
];

/**
 * Install Chrome system deps + @sparticuz/chromium in sandbox.
 * Returns the executable path.
 */
export async function installChrome(
  sandbox: Sandbox,
  cwd = "/vercel/sandbox"
): Promise<string> {
  console.log("[chrome] Installing system dependencies...");
  await shell(
    sandbox,
    `sudo dnf install -y ${SYSTEM_DEPS.join(" ")} > /tmp/chrome-deps.log 2>&1 || true`
  );

  console.log("[chrome] Installing @sparticuz/chromium + puppeteer-core...");
  const install = await shell(
    sandbox,
    `cd ${cwd} && pnpm add @sparticuz/chromium puppeteer-core`
  );
  if (install.exitCode !== 0) {
    throw new Error(`Chromium install failed: ${install.stderr}`);
  }

  console.log("[chrome] Getting executable path...");
  const pathResult = await run(
    sandbox,
    "node",
    ["-e", "require('@sparticuz/chromium').executablePath().then(p => console.log(p))"],
    { cwd }
  );
  if (pathResult.exitCode !== 0 || !pathResult.stdout.trim()) {
    throw new Error(`Failed to get Chromium path: ${pathResult.stderr}`);
  }

  const chromePath = pathResult.stdout.trim();
  console.log(`[chrome] Chromium at: ${chromePath}`);
  return chromePath;
}

/**
 * Launch headless Chrome with CDP enabled.
 * Returns the CDP WebSocket URL.
 */
export async function launchChrome(
  sandbox: Sandbox,
  chromePath: string,
  port = 9222
): Promise<string> {
  const flags = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=/tmp/chrome-profile",
    "--headless=new",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-translate",
    "--mute-audio",
  ];

  console.log("[chrome] Launching headless Chrome...");

  // Launch Chrome as a detached process
  await runDetached(sandbox, "bash", [
    "-c",
    `"${chromePath}" ${flags.join(" ")} about:blank > /tmp/chrome.log 2>&1`,
  ]);

  // Wait a bit for Chrome to start
  await new Promise((r) => setTimeout(r, 2000));

  // Poll for CDP with individual short commands
  const start = Date.now();
  const timeout = 30000;
  while (Date.now() - start < timeout) {
    try {
      const result = await shell(
        sandbox,
        `curl -s --max-time 3 http://127.0.0.1:${port}/json/version 2>/dev/null || echo "not_ready"`
      );
      if (result.stdout.includes("webSocketDebuggerUrl")) {
        const info = JSON.parse(result.stdout.trim());
        console.log(`[chrome] CDP ready: ${info.webSocketDebuggerUrl}`);
        return info.webSocketDebuggerUrl;
      }
    } catch {
      // Connection might fail, keep trying
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Dump Chrome logs for debugging
  const chromeLogs = await shell(sandbox, "cat /tmp/chrome.log 2>/dev/null || echo 'no chrome logs'");
  throw new Error(`Chrome CDP not available after ${timeout}ms. Chrome logs:\n${chromeLogs.stdout}`);
}

/**
 * Fix Turbopack workspace root issue in Next.js 16+.
 * create-next-app doesn't set turbopack.root, causing errors when
 * the project is in a subdirectory of the sandbox.
 */
export async function fixTurbopackRoot(
  sandbox: Sandbox,
  appDir: string
): Promise<void> {
  // Overwrite next.config.ts to set turbopack root
  await sandbox.writeFiles([
    {
      path: `${appDir}/next.config.ts`,
      content: Buffer.from(`import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: "${appDir}",
  },
};

export default nextConfig;
`),
    },
  ]);
}

export function elapsed(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}
