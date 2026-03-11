# Cloud Sandbox — Work So Far

## What's Done

### 1. Headless Mode + Tree Fix (merged to main, published as 0.1.5)

**Branch:** `jude/headless-support` (merged to `main`)

- **Dropped the Chrome DevTools extension** from browser launch. The `installHook.js` injected via `addInitScript` is sufficient — React registers its renderers on the hook directly, no extension needed.
- **Fixed `tree.ts`** to collect operations via `hook.emit` instead of `window.postMessage`. The old approach depended on the extension bridge; the new one works in both headed and headless mode.
- **Added `NEXT_BROWSER_HEADLESS=1`** env var for headless Chromium (cloud sandboxes, CI).
- **Set consistent 1440x900 viewport** for both headed and headless modes.
- **Result:** `next-browser tree`, `tree <id>`, `screenshot`, `eval`, `network`, `routes`, `viewport` all work in headless mode without any browser extension.

### 2. Cloud CLI Commands (this branch, `jude/cloud`)

**New files:**
| File                  | Purpose                                           |
|-----------------------|---------------------------------------------------|
| `src/cloud-paths.ts`  | Socket/pid/state file paths for cloud daemon      |
| `src/cloud.ts`        | Sandbox lifecycle, browser setup, SSH, npmrc, nvm  |
| `src/cloud-daemon.ts` | Separate daemon on `~/.next-browser/cloud.sock`   |
| `src/cloud-client.ts` | Client that auto-spawns cloud daemon              |

**Commands:**
```
next-browser cloud create      # create sandbox + full env setup
next-browser cloud exec <cmd>  # run shell command in sandbox
next-browser cloud status      # show sandbox info
next-browser cloud destroy     # tear down sandbox
```

**`cloud create` auto-provisions:**
1. Chrome system deps (headless Chromium on Amazon Linux 2023)
2. `next-browser` globally + Playwright Chromium
3. SSH key (`~/.ssh/id_ed25519` → sandbox, + github.com known_hosts)
4. npmrc (`~/.npmrc` → sandbox, for private `@vercel/*` packages)
5. Node 24 via nvm (many repos require it)

**Architecture:** Same daemon + stateless client pattern as the local browser. Separate daemon on `cloud.sock` so local and cloud can run simultaneously.

### 3. Validated End-to-End

Tested the full flow against `vercel/front`:
- ✅ SSH auth → `git clone --depth 1 git@github.com:vercel/front.git` (34K files)
- ✅ Private packages → `pnpm install` with npmrc auth (1m 47s)
- ✅ Node 24 → nvm install in sandbox
- ✅ `.env.local` upload → base64 pipe through `cloud exec`
- ✅ Dev server start → `NEXT_PUBLIC_DASH=1 pnpm vercel-site`
- ❌ Running dev server + Chromium simultaneously → **OOM killed** at 4 vCPUs / 8GB

Tested against simple Next.js app (create-next-app):
- ✅ All commands work: `tree`, `tree <id>`, `screenshot`, `eval`, `routes`, `network`, `viewport`
- ✅ Full React component tree in headless mode (no extension needed)

## What's Left

### Immediate
- **Bump sandbox resources** — 4 vCPUs / 8GB is not enough for front repo + Chromium. Need 8+ vCPUs. Just a config change in `cloud.ts`.
- **File upload/download commands** — `cloud upload <local> <remote>` and `cloud download <remote> <local>`. The `upload` action is partially implemented in the daemon. Download would use `sandbox.readFileToBuffer()`.
- **Timeout on `cloud exec`** — long-running commands (pnpm install, dev server) can exceed the socket read timeout. Need either streaming output or a longer timeout.

### Future
- **`cloud open`** — higher-level command that does: create + clone + install + dev server + browser open, all in one.
- **`cloud sync`** — incremental file sync (upload changed files by mtime) for fast iteration.
- **`cloud logs`** — stream dev server logs from the sandbox.
- **Snapshot/restore** — use `sandbox.snapshot()` to save a provisioned sandbox and restore it instantly (skip the 3+ min setup).
- **PPR in headless** — the `ppr lock/unlock` commands should work since they use the same hook, but untested in cloud.
