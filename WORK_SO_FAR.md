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

**`cloud create` auto-provisions (8 vCPUs / 16GB, 30 min timeout):**
1. Chrome system deps (headless Chromium on Amazon Linux 2023)
2. `next-browser` globally + Playwright Chromium
3. SSH key (`~/.ssh/id_ed25519` → sandbox, + github.com known_hosts)
4. npmrc (`~/.npmrc` → sandbox, for private `@vercel/*` packages)
5. Node 24 via nvm (many repos require it)

**Architecture:** Same daemon + stateless client pattern as the local browser. Separate daemon on `cloud.sock` so local and cloud can run simultaneously.

### 3. Validated End-to-End

**Against `vercel/front` (real production monorepo):**
- ✅ SSH auth → `git clone --depth 1 git@github.com:vercel/front.git` (34K files)
- ✅ Private packages → `pnpm install` with npmrc auth (1m 38s)
- ✅ Node 24 → nvm install in sandbox
- ✅ `.env.local` upload → base64 pipe through `cloud exec`
- ✅ Dev server start → `NEXT_PUBLIC_DASH=1 pnpm vercel-site` (port 3024)
- ✅ **Headless Chromium + dev server simultaneously** — works at 8 vCPUs / 16GB (OOM at 4 vCPUs)
- ✅ **`browser.open()` + `screenshot()` + `tree()`** — 5837 React nodes on Vercel login page
- ⚠️ **CLI `next-browser open` fails** — daemon spawn mechanism conflicts with `cloud exec` process management. Direct API calls work fine.

**Against simple Next.js app (create-next-app):**
- ✅ All CLI commands work: `tree`, `tree <id>`, `screenshot`, `eval`, `routes`, `network`, `viewport`
- ✅ Full React component tree in headless mode (no extension needed)

### 4. Key Findings

- **npm token expiry** — `npm login --scope=@vercel-private` needed to refresh tokens for private `@vercel/*` packages. Local pnpm installs mask this because packages are cached in the store.
- **Vercel Sandbox needs `.vercel/` project link** — the `@vercel/oidc` module walks up the directory tree looking for `.vercel/project.json`. We symlink from `prototypes/cloud/.vercel`.
- **`pnpm vercel-site` not `pnpm --filter vercel-site dev`** — the front repo uses a custom script that sets up microfrontends routing (port 3024).

## What's Left

### Immediate
- **Fix daemon spawn in `cloud exec`** — `next-browser open` spawns a detached daemon which conflicts with `sandbox.runCommand()` waiting for process exit. Options: (a) run in-process instead of daemon when headless, (b) use sandbox's detached command mode.
- **File upload/download commands** — `cloud upload <local> <remote>` and `cloud download <remote> <local>` for screenshots, env files, etc.

### Future
- **`cloud open`** — higher-level command that does: create + clone + install + dev server + browser open, all in one.
- **`cloud sync`** — incremental file sync (upload changed files by mtime) for fast iteration.
- **`cloud logs`** — stream dev server logs from the sandbox.
- **Snapshot/restore** — use `sandbox.snapshot()` to save a provisioned sandbox and restore it instantly (skip the ~3 min setup).
- **PPR in headless** — the `ppr lock/unlock` commands should work since they use the same hook, but untested in cloud.
