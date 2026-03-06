---
name: next-browser
description: >-
  Next.js browser debugger for PPR shell optimization. Launches headed Chromium
  with React DevTools. Use when analyzing PPR (Partial Prerendering), finding
  Suspense boundary blockers, debugging React component trees, or optimizing
  initial page load / client navigation. Triggers: "optimize PPR", "analyze shell",
  "find dynamic holes", "what's blocking suspense", "PPR analysis", "next-browser"
---

# next-browser

`npm install -g @vercel/next-browser` then `npx playwright install chromium`.

Daemon at `~/.next-browser/default.sock`. One browser, one page.

---

## Commands

### `open <url> [--cookies-json <file>]`

Launch browser, navigate to URL. With `--cookies-json`, sets auth cookies
before navigating (domain derived from URL hostname).

```
$ next-browser open http://localhost:3024/vercel --cookies-json cookies.json
opened → http://localhost:3024/vercel (11 cookies for localhost)
```

Cookie file format: `[{"name":"authorization","value":"Bearer ..."}, ...]`

### `close`

Close browser and kill daemon.

---

### `goto <url>`

Full-page navigation (new document load). Server renders fresh.

```
$ next-browser goto http://localhost:3024/vercel/~/deployments
→ http://localhost:3024/vercel/~/deployments
```

### `push [path]`

Client-side navigation via `next.router.push()`. Needs the route to be
prefetched — a `<Link>` to the target must exist on the current page.
Without a path, shows an interactive picker of all links (↑/↓, enter).

```
$ next-browser push /vercel/~/deployments
→ http://localhost:3024/vercel/~/deployments
```

If push fails silently (URL unchanged), the route wasn't prefetched.

### `back`

Browser back button.

### `reload`

Hard reload current page.

### `restart-server`

Restart the Next.js dev server (POSTs to `/__nextjs_restart_dev`).
Clears filesystem cache, forces clean recompile. Polls until the server
has a new execution ID, then reloads the page.

---

### `ppr lock`

Enter PPR instant-navigation mode. Sets the `next-instant-navigation-testing`
cookie. After this:
- `goto` — server sends raw PPR shell (static HTML with `<template>` holes)
- `push` — Next.js router blocks dynamic data writes, shows prefetched shell

```
$ next-browser ppr lock
locked
```

### `ppr unlock`

Exit PPR mode and print the shell analysis. Captures:
1. Locked snapshot — which boundaries are suspended = holes in the shell
2. Releases the lock, waits for boundaries to settle
3. Unlocked snapshot — what blocked each boundary (suspendedBy)
4. Matches them, prints Dynamic holes / Static

```
$ next-browser ppr unlock
unlocked

# PPR Shell Analysis
# 131 boundaries: 3 dynamic holes, 128 static

## Dynamic holes (suspended in shell)
  Next.Metadata
    rendered by: MetadataWrapper
  TeamDeploymentsLayout at app/(dashboard)/[teamSlug]/.../layout.tsx:37:9
    suspenders unknown: thrown Promise (library using throw instead of use())
  TrackedSuspense at ../../packages/navigation-metrics/.../tracked-suspense.js:6:20
    rendered by: TrackedSuspense > RootLayout > AppLayout
    blocked by:
      - usePathname (SSR): /vercel/~/deployments awaited in <FacePopover>

## Static (pre-rendered in shell)
  GeistProvider at .../geist-provider.tsx:80:9
  TrackedSuspense at ...
  ...
```

Each hole shows: boundary name + source, `rendered by:` ownership chain,
`blocked by:` the dynamic calls (hooks, server APIs, scripts, cache, etc.)

**After making code changes, ALWAYS check errors before PPR analysis.**
Build errors produce empty/misleading output.

---

### `tree`

Full React component tree (via DevTools `flushInitialOperations`).

```
$ next-browser tree
# React component tree
# Columns: depth id parent name [key=...]
# Use `tree <id>` for props/hooks/state. IDs valid until next navigation.

0 38167 - Root
1 38168 38167 HeadManagerContext.Provider
2 38169 38168 Root
...
224 46375 46374 DeploymentsProvider
226 46506 46376 DeploymentsTable
```

### `tree <id>`

Inspect one component: ancestor path, props, hooks, state, source location
(source-mapped to original file).

```
$ next-browser tree 46375
path: Root > ... > Prerender(TeamDeploymentsPage) > Prerender(FullHeading) > Prerender(TrackedSuspense) > Suspense > DeploymentsProvider
DeploymentsProvider #46375
props:
  children: [<Lazy />, <Lazy />, <span />, <Lazy />, <Lazy />]
hooks:
  IsMobile: undefined (1 sub)
  Router: undefined (2 sub)
  DeploymentListScope: undefined (1 sub)
  User: undefined (4 sub)
  Team: undefined (4 sub)
  ...
  DeploymentsInfinite: undefined (12 sub)
source: app/(dashboard)/[teamSlug]/(team)/~/deployments/_parts/context.tsx:180:10
```

IDs are valid until navigation. Re-run `tree` after `goto`/`push`.

---

### `screenshot`

Full-page PNG to a temp file. Returns the path. Read with the Read tool.

```
$ next-browser screenshot
/var/folders/.../next-browser-1772770369495.png
```

### `eval <script>`

Run JS in page context. Returns the result as JSON.

```
$ next-browser eval 'document.title'
"Deployments – Vercel"

$ next-browser eval 'document.querySelectorAll("a[href]").length'
47

$ next-browser eval 'document.querySelector("nextjs-portal")?.shadowRoot?.querySelector("[data-nextjs-dialog]")?.textContent'
"Runtime ErrorCall Stack 6..."
```

Use this to read the Next.js error overlay (it's in shadow DOM).

---

### `errors`

Build and runtime errors from the Next.js dev server MCP.

```
$ next-browser errors
{
  "configErrors": [],
  "sessionErrors": [
    {
      "url": "/vercel/~/deployments",
      "buildError": null,
      "runtimeErrors": [
        {
          "type": "console",
          "errorName": "Error",
          "message": "Route \"/[teamSlug]/~/deployments\": Uncached data or `connection()` was accessed outside of `<Suspense>`...",
          "stack": [
            {"file": "app/(dashboard)/.../deployments.tsx", "methodName": "Deployments", "line": 105, "column": 27}
          ]
        }
      ]
    }
  ]
}
```

`buildError` is a compile failure. `runtimeErrors` has `type: "runtime"`
(React errors) and `type: "console"` (console.error calls).

### `logs`

Recent dev server log output (NDJSON from `.next/dev/logs/`).

```
$ next-browser logs
{"timestamp":"00:01:55.381","source":"Server","level":"WARN","message":"[browser] navigation-metrics: skeleton visible was already recorded..."}
{"timestamp":"00:01:55.382","source":"Browser","level":"WARN","message":"navigation-metrics: content visible was already recorded..."}
```

---

### `network`

List all network requests since last navigation.

```
$ next-browser network
# Network requests since last navigation
# Columns: idx status method type ms url [next-action=...]
# Use `network <idx>` for headers and body.

0 200 GET document 508ms http://localhost:3024/vercel
1 200 GET font 0ms http://localhost:3024/_next/static/media/797e433ab948586e.p.d2077940.woff2
2 200 GET stylesheet 6ms http://localhost:3024/_next/static/chunks/_a17e2099._.css
3 200 GET fetch 102ms http://localhost:3024/api/v9/projects next-action=abc123def
```

Server actions show `next-action=<id>` suffix.

### `network <idx>`

Full request/response for one entry. Long bodies spill to temp files.

```
$ next-browser network 0
GET http://localhost:3024/vercel
type: document  508ms

request headers:
  accept: text/html,...
  cookie: authorization=Bearer...; isLoggedIn=1; ...
  user-agent: Mozilla/5.0 ...

response: 200 OK
response headers:
  cache-control: no-cache, must-revalidate
  content-encoding: gzip
  ...

response body:
(8234 bytes written to /tmp/next-browser-12345-0.html)
```

---

### `page`

Route segments for the current URL (via Next.js MCP).

```
$ next-browser page
{
  "sessions": [
    {
      "url": "/vercel/~/deployments",
      "routerType": "app",
      "segments": [
        {"path": "app/(dashboard)/[teamSlug]/(team)/~/deployments/layout.tsx", "type": "layout", ...},
        {"path": "app/(dashboard)/[teamSlug]/(team)/~/deployments/page.tsx", "type": "page", ...},
        {"path": "app/(dashboard)/[teamSlug]/layout.tsx", "type": "layout", ...},
        {"path": "app/(dashboard)/layout.tsx", "type": "layout", ...},
        {"path": "app/layout.tsx", "type": "layout", ...}
      ]
    }
  ]
}
```

### `project`

Project root and dev server URL.

```
$ next-browser project
{
  "projectPath": "/Users/judegao/workspace/repo/front/apps/vercel-site",
  "devServerUrl": "http://localhost:3331"
}
```

### `routes`

All app router routes.

```
$ next-browser routes
{
  "appRouter": [
    "/[teamSlug]",
    "/[teamSlug]/~/deployments",
    "/[teamSlug]/[project]",
    "/[teamSlug]/[project]/[id]/logs",
    ...
  ]
}
```

### `action <id>`

Inspect a server action by its ID (from `next-action` header in network list).

---

## Initial PPR Shell Optimization

**Scope: initial page load only** — the server-rendered static HTML sent
on first request. Uses `goto` (full document load) under `ppr lock`.
Not the client-nav (`push`) shell — that's a separate concern.

Goal: every dynamic region in the initial shell either renders `null` or
has a `fallback`. `scrollHeight > 0` with heading/logo visible = done.

### Baseline

```
nb open <url>
nb errors                              # must be clean first
nb ppr lock && nb goto <url>           # goto = initial load shell
nb screenshot                          # the "before"
nb eval 'document.body.scrollHeight'   # 0 = empty shell
nb ppr unlock                          # prints hole analysis
```

### Reading `ppr unlock` output

For each entry under `## Dynamic holes`:

| Hole pattern | Action |
|---|---|
| Wraps a component that returns `null` (telemetry, analytics, hooks-only provider) | Skip — zero visual cost |
| Already has a `fallback` in the code | Skip — working |
| Wraps visible UI, no fallback | Wrap it |
| `blocked by: ... awaited in <Page>` or `<Layout>` (the segment export itself) | The `await` runs before JSX exists — push it down (see fix B) |

### The two fixes

**A. Unwrapped dynamic component** — add a boundary:
```tsx
<Suspense fallback={<StaticThing />}>
  <DynamicThing />
</Suspense>
```

**B. `await` before `return` in an async page/layout** — the boundary
doesn't exist yet when the await suspends. Push the await into a child:
```tsx
// before: suspends at line 2, <Suspense> on line 3 never mounts
export default async function Page({ searchParams }) {
  const sp = await searchParams;
  return <Suspense fallback={<Skeleton />}>...</Suspense>;
}

// after: sync wrapper, await inside the boundary
export default function Page({ searchParams }) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Inner searchParams={searchParams} />
    </Suspense>
  );
}
async function Inner({ searchParams }) {
  const sp = await searchParams;
  ...
}
```

### Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| Bailout, stack is all framework frames | An `await` runs before any `<Suspense>` is returned | Fix B above |
| `await params` bails even with `generateStaticParams` | `generateStaticParams` controls build-time route gen, not the runtime prerender — `params` is still a Promise | Fix B — push `await params` into a child inside Suspense |
| Fix looks correct, still bails | Stale dev module cache | `nb restart-server` before debugging further |
| Removed a no-fallback blanket Suspense, now everything bails | It was silently catching every unwrapped dynamic call below it | Add inner boundaries *first*, remove the blanket *last* |
| Fallback itself doesn't render in shell | Fallback is a client component that suspends on chunk loads or router hooks | Use pure server JSX (static SVGs, divs) in fallbacks |
| Dynamic API flagged, but you wrapped the call site | A `cache()`/deduped wrapper started the promise at an earlier unwrapped call site | Find and wrap the *first* caller |

### Bisecting `NEXT_STATIC_GEN_BAILOUT`

The bailout stack has no user frames. Locate it manually.

**First:** check normal-mode errors — they have real stacks:
```
nb goto <url> && nb errors
```

**Then** wrap progressively larger subtrees in
`<Suspense fallback={<div>MARKER</div>}>` and probe under lock:
```
nb ppr lock && nb goto <url>
nb eval 'document.getElementById("__NEXT_DATA__") ? "BAILOUT" : document.body.innerText.slice(0,100)'
```

- Still `BAILOUT` → culprit is outside/above (check `await` before `return`)
- `MARKER` renders → culprit is inside → narrow further

Work outermost → innermost. The culprit is almost always an `await` at
the top of an async layout/page body.

### Static shell fallback

When a layout branches on dynamic data, mirror the common-path structure
in the fallback. Reuse the same structural components and classes so
there's no layout shift on hydration:

```tsx
function Shell() {
  return (
    <div className="same-wrapper">
      <Header logo={<StaticSvg />} actions={<Skeleton />} />
      <Main className="same-classes">
        <PageSkeleton />
        <Footer />
      </Main>
    </div>
  );
}

export default function Layout(props) {
  return (
    <Suspense fallback={<Shell />}>
      <LayoutInner {...props} />
    </Suspense>
  );
}

async function LayoutInner({ params, children }) {
  const p = await params;  // suspends here → Shell renders
  ...
}
```

### Verify

```
nb goto <url> && nb errors             # clean
nb ppr lock && nb goto <url>           # initial load shell
nb screenshot                          # visible shell
nb ppr unlock                          # every visual hole has a fallback
```
