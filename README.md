# @vercel/next-browser

React DevTools and the Next.js dev overlay as shell commands — component
trees, props, hooks, PPR shells, errors, network, accessibility snapshots —
structured text that agents can parse and act on.

An LLM can't click through a DevTools panel, but it can run
`next-browser snapshot`, read the output, `click e3`, and keep going. Each
command is a stateless one-shot against a long-lived browser daemon, so an
agent loop can fire them off without managing browser lifecycle.

## Getting started

**As a skill** (recommended) — from your Next.js repo:

```bash
npx skills add vercel-labs/next-browser
```

Works with Claude Code, Cursor, Cline, and [others](https://skills.sh).
Start your agent in the project and type `/next-browser` to invoke the
skill. It installs the CLI and Chromium if needed, asks for your dev server
URL, and from there it's pair programming — tell it what you're debugging
and it drives the browser for you.

**Manual install:**

```bash
pnpm add -g @vercel/next-browser   # or npm, yarn
playwright install chromium
```

Requires Node >= 20.

## Commands

### Browser lifecycle

| Command                              | Description                                        |
| ------------------------------------ | -------------------------------------------------- |
| `open <url> [--cookies-json <file>]` | Launch browser and navigate (with optional cookies) |
| `close`                              | Close browser and kill daemon                      |

### Navigation

| Command            | Description                                               |
| ------------------ | --------------------------------------------------------- |
| `goto <url>`       | Full-page navigation (new document load)                  |
| `ssr-goto <url>`   | Navigate blocking external scripts (inspect SSR shell)    |
| `push [path]`      | Client-side navigation (interactive picker if no path)    |
| `back`             | Go back in history                                        |
| `reload`           | Reload current page                                       |
| `restart-server`   | Restart the Next.js dev server (clears caches)            |

### Inspection

| Command           | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `tree`            | Full React component tree (hierarchy, IDs, keys)              |
| `tree <id>`       | Inspect one component (props, hooks, state, source location)  |
| `snapshot`        | Accessibility tree with `[ref=eN]` markers on interactive elements |
| `errors`          | Build and runtime errors for the current page                 |
| `logs`            | Recent dev server log output                                  |
| `network [idx]`   | List network requests, or inspect one (headers, body)         |
| `screenshot`      | Full-page PNG to a temp file                                  |

### Interaction

| Command                      | Description                                                |
| ---------------------------- | ---------------------------------------------------------- |
| `click <ref\|text\|selector>` | Click via real pointer events (works with Radix, Headless UI) |
| `fill <ref\|selector> <value>` | Fill a text input or textarea                            |
| `eval [ref] <script>`       | Run JS in page context (supports `--file` and stdin)       |
| `viewport [WxH]`            | Show or set viewport size                                  |

### Performance & PPR

| Command        | Description                                                  |
| -------------- | ------------------------------------------------------------ |
| `perf [url]`   | Core Web Vitals + React hydration timing in one pass         |
| `ppr lock`     | Freeze dynamic content to inspect the static shell           |
| `ppr unlock`   | Resume dynamic content and print shell analysis              |

### Next.js MCP

| Command        | Description                                     |
| -------------- | ----------------------------------------------- |
| `page`         | Route segments for the current URL              |
| `project`      | Project root and dev server URL                 |
| `routes`       | All app router routes                           |
| `action <id>`  | Inspect a server action by ID                   |

## Examples

**Inspect what's on the page and interact with it:**

```
$ next-browser open http://localhost:3000
$ next-browser snapshot
- navigation "Main"
  - link "Home" [ref=e0]
  - link "Dashboard" [ref=e1]
- main
  - heading "Settings"
  - tablist
    - tab "General" [ref=e2] (selected)
    - tab "Security" [ref=e3]

$ next-browser click e3
clicked

$ next-browser snapshot
- tablist
  - tab "General" [ref=e0]
  - tab "Security" [ref=e1] (selected)
```

**Profile page load performance:**

```
$ next-browser perf http://localhost:3000/dashboard
# Page Load Profile — http://localhost:3000/dashboard

## Core Web Vitals
  TTFB                   42ms
  LCP               1205.3ms (img: /_next/image?url=...)
  CLS                    0.03

## React Hydration — 65.5ms (466.2ms → 531.7ms)
  Hydrated                         65.5ms  (466.2 → 531.7)
  Commit                            2.0ms  (531.7 → 533.7)
  ...
```

**Debug the PPR shell:**

```
$ next-browser ppr lock
locked
$ next-browser goto http://localhost:3000/dashboard
$ next-browser screenshot
/var/folders/.../next-browser-screenshot.png
$ next-browser ppr unlock
# PPR Shell Analysis — 131 boundaries: 3 dynamic holes, 128 static

## Quick Reference
| Boundary              | Type      | Primary blocker           | Source              |
| ---                   | ---       | ---                       | ---                 |
| TrackedSuspense       | component | usePathname (client-hook) | tracked-suspense.js |
```

**Inspect a React component:**

```
$ next-browser tree
0 38167 - Root
1 38168 38167 HeadManagerContext.Provider
2 38169 38168 Root
...
224 46375 46374 DeploymentsProvider

$ next-browser tree 46375
path: Root > ... > DeploymentsProvider
DeploymentsProvider #46375
props:
  children: [<Lazy />, <Lazy />, <span />, <Lazy />, <Lazy />]
hooks:
  IsMobile: undefined (1 sub)
  Router: undefined (2 sub)
source: app/.../deployments/_parts/context.tsx:180:10
```

## How it works

A daemon process launches Chromium with the React DevTools extension
pre-loaded and listens on a Unix domain socket (named pipe on Windows).
CLI commands send JSON-RPC messages to the daemon and print the response.
The browser stays open across commands — no per-command startup cost.

## License

MIT
