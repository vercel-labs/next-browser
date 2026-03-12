/**
 * Cloud sandbox lifecycle and operations.
 * Wraps @vercel/sandbox SDK for creating/managing remote sandboxes.
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudStateFile } from "./cloud-paths.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function getSandboxSDK() {
  try {
    return await import("@vercel/sandbox");
  } catch {
    throw new Error(
      "@vercel/sandbox is not installed. Run: pnpm add @vercel/sandbox"
    );
  }
}

export interface CloudState {
  sandboxId: string;
  createdAt: string;
  publicUrl?: string;
}

function saveState(state: CloudState) {
  writeFileSync(cloudStateFile, JSON.stringify(state, null, 2));
}

function loadState(): CloudState | null {
  if (!existsSync(cloudStateFile)) return null;
  try {
    return JSON.parse(readFileSync(cloudStateFile, "utf-8"));
  } catch {
    return null;
  }
}

function clearState() {
  rmSync(cloudStateFile, { force: true });
}

let sandbox: import("@vercel/sandbox").Sandbox | null = null;

/** System dependencies required for headless Chromium on Amazon Linux 2023. */
const CHROME_SYSTEM_DEPS = [
  "nspr", "nss", "atk", "at-spi2-atk", "cups-libs", "libdrm",
  "libxkbcommon", "libXcomposite", "libXdamage", "libXfixes",
  "libXrandr", "mesa-libgbm", "alsa-lib", "cairo", "pango",
  "glib2", "gtk3", "libX11", "libXext", "libXcursor", "libXi", "libXtst",
];

async function runInSandbox(
  cmd: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!sandbox) throw new Error("no sandbox");
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", cmd],
  });
  let stdout = "";
  let stderr = "";
  for await (const log of result.logs()) {
    if (log.stream === "stdout") stdout += log.data;
    else stderr += log.data;
  }
  await result.wait();
  return { exitCode: result.exitCode, stdout, stderr };
}

export async function create(): Promise<string> {
  if (sandbox) {
    return `sandbox already running: ${sandbox.sandboxId}`;
  }

  loadEnv();

  const existing = loadState();
  if (existing) {
    try {
      const { Sandbox } = await getSandboxSDK();
      sandbox = await Sandbox.get({ sandboxId: existing.sandboxId });
      if (sandbox.status === "running") {
        return `reconnected to ${sandbox.sandboxId}`;
      }
    } catch {
      // stale state
    }
    clearState();
  }

  const { Sandbox } = await getSandboxSDK();
  sandbox = await Sandbox.create({
    resources: { vcpus: 8 },
    timeout: 1_800_000, // 30 min
    ports: [3000],
    runtime: "node22",
  });

  const state: CloudState = {
    sandboxId: sandbox.sandboxId,
    createdAt: new Date().toISOString(),
  };

  try {
    const domain = sandbox.domain(3000);
    state.publicUrl = domain.startsWith("http") ? domain : `https://${domain}`;
  } catch {
    // no public URL yet
  }

  saveState(state);

  // ── Full environment setup ───────────────────────────────────
  // 1. Chrome system deps (headless Chromium on Amazon Linux 2023)
  await runInSandbox(
    `sudo dnf install -y ${CHROME_SYSTEM_DEPS.join(" ")} > /dev/null 2>&1`
  );

  // 2. next-browser + Playwright Chromium
  await runInSandbox(
    `npm install -g @vercel/next-browser 2>&1 | tail -1`
  );
  await runInSandbox(
    `npm install -g playwright @playwright/browser-chromium 2>&1 | tail -1`
  );
  await runInSandbox(
    `npx playwright install chromium 2>&1 | tail -1`
  );

  // 3. SSH key (for private git repos)
  const { homedir } = await import("node:os");
  const sshKeyPath = join(homedir(), ".ssh", "id_ed25519");
  if (existsSync(sshKeyPath)) {
    const key = readFileSync(sshKeyPath, "utf-8");
    await runInSandbox(`mkdir -p ~/.ssh && chmod 700 ~/.ssh`);
    await sandbox.writeFiles([
      { path: "/home/vercel-sandbox/.ssh/id_ed25519", content: Buffer.from(key) },
    ]);
    await runInSandbox(`chmod 600 ~/.ssh/id_ed25519`);
    await runInSandbox(`ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null`);
  }

  // 4. npmrc (for private packages)
  const npmrcPath = join(homedir(), ".npmrc");
  if (existsSync(npmrcPath)) {
    const npmrc = readFileSync(npmrcPath, "utf-8");
    await sandbox.writeFiles([
      { path: "/home/vercel-sandbox/.npmrc", content: Buffer.from(npmrc) },
    ]);
  }

  // 5. Node 24 via nvm (many projects require it)
  await runInSandbox(
    `curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash > /dev/null 2>&1`
  );
  await runInSandbox(
    `source ~/.nvm/nvm.sh && nvm install 24 > /dev/null 2>&1`
  );

  return [
    `sandbox created: ${sandbox.sandboxId}`,
    state.publicUrl ? `url: ${state.publicUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function exec(
  command: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!sandbox) throw new Error("no sandbox running — run `cloud create` first");
  return runInSandbox(command);
}

/** Upload a local file to the sandbox. */
export async function upload(localPath: string, remotePath: string): Promise<string> {
  if (!sandbox) throw new Error("no sandbox running — run `cloud create` first");
  const content = readFileSync(localPath);
  await sandbox.writeFiles([{ path: remotePath, content }]);
  return `uploaded ${localPath} → ${remotePath} (${content.length} bytes)`;
}

export async function destroy(): Promise<string> {
  if (!sandbox) {
    const state = loadState();
    if (state) {
      try {
        loadEnv();
        const { Sandbox } = await getSandboxSDK();
        sandbox = await Sandbox.get({ sandboxId: state.sandboxId });
      } catch {
        clearState();
        return "no sandbox to destroy (cleared stale state)";
      }
    } else {
      return "no sandbox running";
    }
  }

  const id = sandbox.sandboxId;
  await sandbox.stop({ blocking: true });
  sandbox = null;
  clearState();
  return `destroyed ${id}`;
}

export async function status(): Promise<string> {
  const state = loadState();
  if (!state) return "no sandbox running";

  if (sandbox) {
    return [
      `id:      ${sandbox.sandboxId}`,
      `status:  ${sandbox.status}`,
      `created: ${state.createdAt}`,
      state.publicUrl ? `url:     ${state.publicUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `id:      ${state.sandboxId}`,
    `status:  unknown (daemon not running)`,
    `created: ${state.createdAt}`,
    state.publicUrl ? `url:     ${state.publicUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Load .env.local for Vercel credentials.
 */
function loadEnv() {
  const candidates = [
    join(__dirname, "..", ".env.local"),
    join(__dirname, "..", "prototypes", "cloud", ".env.local"),
    resolve(process.cwd(), ".env.local"),
  ];

  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx);
        let value = trimmed.slice(eqIdx + 1);
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
      return;
    } catch {
      continue;
    }
  }
}
