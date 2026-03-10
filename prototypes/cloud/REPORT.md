# Technical Report: Async Next Browser Cloud Architecture

**Date:** 2026-03-10
**Author:** Prototype exploration for async Next Browser
**Status:** All 4 prototypes passing

---

## Executive Summary

We built and tested four prototypes to validate the feasibility of running an AI-powered Next.js development environment entirely in the cloud via Vercel Sandbox. The results are overwhelmingly positive: every core primitive works, including headless Chrome in the sandbox. The full integration prototype demonstrates a multi-turn AI agent that can edit files, navigate a browser, take screenshots, and verify changes — all against a Next.js dev server running in a Vercel Sandbox.

---

## Prototype Results

| Prototype | What it Tests                          | Result  | Time    |
|-----------|----------------------------------------|---------|---------|
| 01        | Sandbox + Next.js dev server           | PASS    | 18.3s   |
| 02        | Chrome + dev server + screenshot       | PASS    | 43.8s   |
| 03        | Multi-turn agent (Anthropic SDK)       | PASS    | 104.4s  |
| 04        | Full integration (agent + Chrome + dev)| PASS    | 145.2s  |

---

## Prototype 1: Sandbox + Dev Server

**Goal:** Validate the most basic primitive — can we run `next dev` in a Vercel Sandbox and access it?

**What happens:**
1. Create a Vercel Sandbox with port 3000 exposed (2s)
2. Run `create-next-app` inside the sandbox (11s)
3. Start `next dev` as a background process
4. Access the dev server via the sandbox's public URL

**Key findings:**
- Sandbox creation is fast (~2s)
- `create-next-app` works out of the box in the sandbox (Amazon Linux 2023, Node 22)
- The dev server is accessible both internally (`localhost:3000`) and externally via `sandbox.domain(3000)` which returns a public `https://sb-*.vercel.run` URL
- Next.js 16.1.6 with Turbopack is the default. Turbopack requires a `turbopack.root` config fix when the app is in a subdirectory
- Total time from zero to running dev server accessible via public URL: **18 seconds**

**Implication:** This is the foundational primitive. It works cleanly and fast enough for interactive use.

---

## Prototype 2: Chrome in the Sandbox

**Goal:** Can we run headless Chromium inside the sandbox and take a screenshot of the dev server?

**What happens:**
1. Create sandbox, scaffold Next.js app
2. Install system dependencies via `sudo dnf install` (Amazon Linux 2023)
3. Install `@sparticuz/chromium` + `puppeteer-core` via pnpm
4. Extract the Chromium executable path
5. Launch Chrome with CDP debugging enabled
6. Connect puppeteer-core via CDP WebSocket
7. Navigate to `localhost:3000` and take a screenshot
8. Download the screenshot to the local machine

**Key findings:**
- Chrome installation takes ~24s (system deps + npm package + binary extraction)
- The `@sparticuz/chromium` package provides a pre-compiled Chromium binary designed for serverless environments — this is the same approach used by dev3000
- CDP (Chrome DevTools Protocol) works perfectly at `ws://127.0.0.1:9222/devtools/browser/...`
- puppeteer-core connects and can navigate, screenshot, evaluate JS, etc.
- **Critical ordering:** Chrome must be installed BEFORE starting the dev server. Running `pnpm add` while the dev server is running kills it (modifies node_modules)
- **Connection management:** Long-running sandbox commands can cause connection drops. Use `runDetached` for background processes and keep polling commands short
- Screenshots can be read back from the sandbox via `sandbox.readFileToBuffer()`
- Total time including Chrome setup: **44 seconds**

**Implication:** Full browser automation in the sandbox is feasible. The 24s Chrome install could be eliminated with sandbox snapshots (pre-bake Chrome into a base image).

---

## Prototype 3: Multi-Turn Agent (Anthropic SDK)

**Goal:** Can we have a multi-turn conversation with an AI agent that operates on the sandbox?

**Architecture:** Agent runs OUTSIDE the sandbox (via Anthropic SDK). The sandbox is exposed as tools:
- `run_shell` — execute bash commands
- `read_file` / `write_file` — file operations
- `curl_page` — fetch dev server pages

**Conversation tested (3 turns):**
1. "What pages does this app have?" → Agent explored file structure, read source files
2. "Add an /about page" → Agent created directory, wrote page.tsx, verified with curl
3. "Verify /about works" → Agent fetched the page, confirmed HTML output

**Key findings:**
- The Anthropic SDK tool-use loop works perfectly for multi-turn sandbox interaction
- Agent autonomously uses tools in the right order: explore → create → verify
- Each turn takes 3-8 seconds for the LLM response + tool execution
- The agent correctly operates within the sandbox context (file paths, ports, etc.)
- 34 messages total across 3 user turns (includes all tool calls and results)
- **No custom protocol needed:** The standard Anthropic SDK messages API with tools handles multi-turn perfectly
- Total conversation time: **104 seconds** (including 20s setup)

**Implication:** The multi-turn problem from the brain dump is essentially solved. The Anthropic SDK's tool-use pattern naturally handles the back-and-forth. No need for WebSocket or SSE streaming protocol — just the standard messages API.

---

## Prototype 4: Full Integration

**Goal:** The complete vision — multi-turn agent with both file/shell access AND browser automation, all against a sandbox dev server.

**Architecture:** Same as Prototype 3, but with additional browser tools:
- `browser_navigate` — go to a URL in headless Chrome
- `browser_screenshot` — capture the page visually
- `browser_get_text` — read visible text content
- `browser_console_errors` — check for runtime errors

**Conversation tested (3 turns):**
1. "Screenshot the homepage, list file structure" → Agent navigated, screenshotted, explored files
2. "Create a /dashboard with 3 stat cards" → Agent wrote a full Tailwind-styled dashboard page, navigated to it, took a screenshot to verify
3. "Check for console errors, verify stats render" → Agent ran error check (clean) and text extraction (all stats present)

**Key findings:**
- Full stack works: agent edits code → dev server hot-reloads → browser navigates → screenshot confirms
- The agent naturally uses browser tools to verify its own work (screenshot after creating a page)
- Console error checking provides a debugging feedback loop
- Text extraction gives the agent a way to verify content without parsing HTML
- Puppeteer scripts run inside the sandbox (same Node.js environment as the app)
- Two screenshots were taken and downloaded locally — both pixel-perfect
- Setup time: **39s** (sandbox + app + Chrome + dev server)
- Total time: **145 seconds** for 3 turns with visual verification

**Implication:** This is a working proof of concept for the full async Next Browser vision. An agent can make code changes and visually verify them in a cloud environment.

---

## Architecture Decision: Option A Wins

The brain dump identified two architectures:
- **Option A (Full Remote):** Everything in sandbox, agent drives from outside via tools
- **Option B (Hybrid):** Agent runs locally, proxies every operation into sandbox

Our prototypes validate a **modified Option A**: the environment (dev server, Chrome) runs in the sandbox, and the agent runs outside but operates on the sandbox via tools. This gives us:

1. **Direct tool access** — shell, files, browser all work naturally as tool calls
2. **No proxy layer** — no need to replicate Next Browser's command surface over a network boundary
3. **Standard SDK** — the Anthropic SDK's tool-use pattern handles multi-turn natively
4. **Clean separation** — sandbox is stateful environment, agent is stateless conversation

The concern from the brain dump about Option B ("every file operation needs to be proxied as sandbox commands") is real, but it turns out the proxy is trivially simple when done as Anthropic SDK tools rather than trying to replicate a local CLI experience.

---

## Performance Breakdown

| Operation                    | Time   | Notes                                        |
|------------------------------|--------|----------------------------------------------|
| Sandbox creation             | ~2s    | Consistent across all runs                   |
| `create-next-app`            | 11-17s | Varies; could use git source instead         |
| Chrome system deps           | ~5s    | `dnf install` on Amazon Linux 2023           |
| Chrome npm install           | ~15s   | `@sparticuz/chromium` + `puppeteer-core`     |
| Chrome binary extraction     | ~4s    | First-time `executablePath()` call           |
| Chrome launch + CDP ready    | ~2.5s  | Background process + CDP polling             |
| Dev server startup           | <1s    | Turbopack is fast                            |
| LLM turn (with tools)       | 3-8s   | Depends on tool count and response length    |
| Screenshot (in sandbox)     | ~1s    | Navigate + capture                           |
| Screenshot download         | <1s    | `readFileToBuffer` from sandbox              |

**Total setup (cold start):** ~40s for full environment (sandbox + app + Chrome + dev server)

**Optimization opportunity:** Sandbox snapshots could reduce setup to ~5s by pre-baking Chrome + system deps into a base image. The dev3000 reference already implements this pattern.

---

## Key Technical Discoveries

### 1. Vercel Sandbox is More Capable Than Expected
- Runs Amazon Linux 2023 with `sudo` access
- Supports `dnf install` for system packages
- Can expose up to 4 ports with public URLs
- Detached commands work for background processes
- File read/write via SDK (no need to shell out for everything)
- 8 vCPU option provides good performance

### 2. `@sparticuz/chromium` is the Right Choice
- Purpose-built for serverless/containerized environments
- Pre-compiled binary avoids the heavy Playwright browser download
- Works with puppeteer-core via CDP
- Same approach used in production by dev3000

### 3. Turbopack Needs Configuration
- Next.js 16+ uses Turbopack by default
- When the app is in a subdirectory (e.g., `/vercel/sandbox/my-app`), Turbopack can't infer the workspace root
- Fix: set `turbopack.root` in `next.config.ts`

### 4. Command Ordering Matters
- `pnpm add` during a running dev server kills it (modifies node_modules)
- Install all dependencies before starting the dev server
- Use `runDetached` for long-running processes (dev server, Chrome)

### 5. Connection Management
- Long-running sandbox commands can timeout and drop the connection
- Solution: use detached commands for anything that takes >10s
- Keep polling commands short and independent

### 6. Multi-Turn is a Solved Problem
- The Anthropic SDK's messages API + tools handles this natively
- No custom WebSocket/SSE streaming protocol needed
- Each turn: user message → agent response (with tool calls) → tool results → continue
- Conversation state maintained in the messages array

---

## What's Missing for Production

### 1. Sandbox Snapshots
Pre-bake Chrome + system deps into a snapshot. The dev3000 codebase shows how:
- Create base sandbox, install deps, snapshot it
- Store snapshot ID in Vercel Blob
- Restore from snapshot for each new session (~5s vs ~40s cold start)

### 2. Next Browser Skills Integration
The current tools are generic (shell, files, browser). For the full Next Browser experience, we'd want:
- React DevTools tree inspection via Chrome extension
- PPR lock/unlock analysis
- Next.js MCP endpoint integration (errors, routes, page metadata)
- Source-mapped component locations

This requires either:
- Running Next Browser's daemon inside the sandbox (preferred — it already manages Chromium)
- Or porting Next Browser's commands to puppeteer-core + CDP (more work, less capability)

### 3. Streaming Responses
Current prototype waits for full agent response before showing anything. For interactive use:
- Use `client.messages.stream()` for token-by-token output
- Stream tool execution progress back to the user
- This is a UI concern, not an architecture problem

### 4. Git Integration
- Clone user's repo instead of scaffolding from scratch
- Support GitHub PAT for private repos
- The dev3000 `createD3kSandbox` already handles this (git source)

### 5. Session Persistence
- Sandbox timeout is configurable (up to plan max)
- Could snapshot and restore sessions
- Conversation history needs external storage for resumption

---

## Recommended Next Steps

1. **Snapshot optimization** — Create a base snapshot with Chrome pre-installed; get cold start from 40s → 5s
2. **Next Browser in sandbox** — Install Next Browser inside the sandbox so the agent gets full DevTools + PPR capabilities
3. **Git source** — Replace `create-next-app` with `git clone` from user's repo
4. **Streaming UI** — Build a simple web UI that streams the agent conversation
5. **React DevTools via CDP** — Investigate whether we can get React DevTools data through CDP without the Chrome extension (this would eliminate the headless vs headed browser tension)

---

## Files

```
prototypes/cloud/
├── package.json
├── tsconfig.json
├── REPORT.md                          ← this file
└── src/
    ├── shared.ts                      ← sandbox utilities, Chrome helpers
    ├── 01-sandbox-devserver.ts        ← Prototype 1: basic sandbox + dev server
    ├── 02-sandbox-chrome.ts           ← Prototype 2: Chrome + screenshot
    ├── 03-multi-turn-agent.ts         ← Prototype 3: multi-turn conversation
    └── 04-full-integration.ts         ← Prototype 4: agent + Chrome + dev server
```

All prototypes can be run with:
```bash
cd prototypes/cloud
npm install
npm run proto:sandbox    # Prototype 1
npm run proto:chrome     # Prototype 2
npm run proto:agent      # Prototype 3
npm run proto:full       # Prototype 4
```

Requires: Vercel project linked (`npx vercel link` + `npx vercel env pull`) for sandbox credentials.
