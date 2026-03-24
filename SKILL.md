---
name: next-browser
description: >-
  CLI that gives agents what humans get from React DevTools and the Next.js
  dev overlay — component trees, props, hooks, PPR shells, errors, network —
  as shell commands that return structured text.
---

# next-browser

If `next-browser` is not already on PATH, install `@vercel/next-browser`
globally with the user's package manager, then `playwright install chromium`.

If `next-browser` is already installed, it may be outdated. Run
`next-browser --version` and compare against the latest on npm
(`npm view @vercel/next-browser version`). If the installed version is
behind, upgrade it (`npm install -g @vercel/next-browser@latest` or the
equivalent for the user's package manager) before proceeding.

---

## Next.js docs awareness

If the project's Next.js version is **v16.2.0-canary.37 or later**, bundled
docs live at `node_modules/next/dist/docs/`. Before doing PPR work, Cache
Components work, or any non-trivial Next.js task, read the relevant doc there
— your training data may be outdated. The bundled docs are the source of truth.

See https://nextjs.org/docs/app/guides/ai-agents for background.

---

## When this skill loads

Your first message introduces the tool and asks setup questions. Don't say
"ready, what would you like to do?" and don't run speculative commands or
auto-discover (port scans, `project`, config reads).

If the user already provided a URL, cookies, and task in their message,
skip the questions — go straight to `open` and start working. Only ask
what's missing.

Otherwise say something like:

> This opens a headed browser against your Next.js dev server so I can
> read the React component tree, see the PPR shell, and check errors the
> way you would in DevTools. To start:
>
> - What's your dev server URL? (And is it running?)
> - Are the pages you're debugging behind a login? If so I'll need your
>   session cookies — easiest is to copy them from your browser's
>   DevTools → Application → Cookies into a JSON file like
>   `[{"name":"session","value":"..."}]`. If the pages are public, skip
>   this.

Wait for answers. Then `open <url> [--cookies-json <file>]`. Every other
command errors without an open session.

---

## Headless mode

By default the browser opens headed (visible window). For CI or cloud
environments with no display, set `NEXT_BROWSER_HEADLESS=1` to run
headless.

---

## Keep the user in the loop visually

During debug sessions, use `preview` liberally so the user can see what
you see. Good moments to preview:

- Right after opening a page or navigating, so the user confirms you're
  on the right page.
- After making a code change and reloading — show the before/after.
- When inspecting the PPR shell (locked state) — the user can judge
  shell quality faster than reading a tree dump.
- When something looks wrong — show it, don't just describe it.

Use captions to annotate what the screenshot represents (e.g.
`preview "PPR shell — locked"`, `preview "After fix"`). This makes
the preview window self-documenting as you iterate.

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

Only `name` and `value` are required per cookie — omit `domain`, `path`,
`expires`, etc. To create the file, use Bash (`echo '[...]' > /tmp/cookies.json`)
since the Write tool requires a prior Read.

### `close`

Close browser and kill daemon.

---

### `goto <url>`

Navigate to a URL with a fresh server render. The browser loads a new
document — equivalent to typing a URL in the address bar.

```
$ next-browser goto http://localhost:3024/vercel/~/deployments
→ http://localhost:3024/vercel/~/deployments
```

### `push [path]`

Client-side navigation — the page transitions without a full reload, the
way a user clicks a link in the app. Without a path, shows an interactive
picker of all links on the current page.

```
$ next-browser push /vercel/~/deployments
→ http://localhost:3024/vercel/~/deployments
```

If push fails silently (URL unchanged), the route wasn't prefetched.

### `back`

Go back one page in browser history.

### `reload`

Reload the current page from the server.

### `ssr lock`

Block external scripts on all subsequent navigations. While locked, every
`goto`, `push`, `back`, and `reload` shows the raw server-rendered HTML
without React hydration or client-side JavaScript — what search engines
and social crawlers see.

```
$ next-browser ssr lock
ssr locked — external scripts blocked on all navigations
```

### `ssr unlock`

Re-enable external scripts. The next navigation will load normally with
full hydration.

```
$ next-browser ssr unlock
ssr unlocked — external scripts re-enabled
```


### `perf [url]`

Profile a full page load — reloads the current page (or navigates to a
URL) and collects Core Web Vitals and React hydration timing in one pass.

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
  Waiting for Paint                 3.0ms  (533.7 → 536.7)
  Remaining Effects                 4.1ms  (536.7 → 540.8)

## Hydrated components (42 total, sorted by duration)
  DeploymentsProvider                       8.3ms
  NavigationProvider                        5.1ms
  ...
```

**TTFB** — server response time (Navigation Timing API).
**LCP** — when the largest visible element painted, plus what it was.
**CLS** — cumulative layout shift score (lower is better).
**Hydration** — React reconciler phases and per-component cost (requires
React profiling build / `next dev`; production strips `console.timeStamp`).

Without a URL, reloads the current page. With a URL, navigates there first.

### `renders start`

Begin recording React re-renders. Hooks into `onCommitFiberRoot` to
collect raw per-component data: render count, totalTime, selfTime,
DOM mutations, change reasons, and FPS.

Survives full-page navigations (`goto`/`reload`) and captures mount
and hydration renders — no need to start before or after navigation.

```
$ next-browser renders start
recording renders — interact with the page, then run `renders stop`
```

### `renders stop [--json]`

Stop recording and print a per-component render profile. Raw data —
the agent decides what's actionable.

```
$ next-browser renders stop
# Render Profile — 3.05s recording
# 426 renders across 38 components
# FPS: avg 120, min 106, max 137, drops (<30fps): 0

## Components by total render time
| Component              | Renders | Total    | Self     | DOM   | Top change reason          |
| ---------------------- | ------- | -------- | -------- | ----- | -------------------------- |
| Parent                 |      10 |   5.8ms  |   3.4ms  | 10/10 | state (hook #0)            |
| MemoChild              |      30 |     2ms  |   1.9ms  | 30/30 | props.data                 |
| Router                 |      10 |   6.3ms  |       —  |  0/10 | parent (ErrorBoundaryHandler) |

## Change details (prev → next)
  Parent
    state (hook #0): 0 → 1
  MemoChild
    props.data: {value} → {value}
```

The **Change details** section shows the actual prev→next values for
each change. This makes the data self-contained — you can see that
`MemoChild` gets `props.data: {value} → {value}` (same shape, new
reference — memo defeated) without needing to inspect the component.

**With `--json`**, outputs raw structured JSON with full change arrays
per component (type, name, prev, next for each render event).

**Columns:**
- `Renders` — how many times the component rendered
- `Total` — inclusive render time (component + children)
- `Self` — exclusive render time (component only, excludes children)
- `DOM` — how many renders actually mutated the DOM vs total renders
- `Top change reason` — most frequent trigger for this component

**Timing data** (`Total`, `Self`) requires a React profiling build
(`next dev`). In production builds these columns show `—` but render
counts, DOM mutations, and change reasons are still reported.

**Change reasons** — what triggered each re-render:
- `props.<name>` — a prop changed by reference, with prev→next values
- `state (hook #N)` — a useState/useReducer hook changed, with prev→next values
- `context (<name>)` — a specific context changed, with prev→next values
- `parent (<name>)` — parent component re-rendered, names the parent
- `mount` — first render

**FPS** — frames per second during recording. `drops` counts frames
below 30fps.

Up to 200 components are tracked. If output exceeds 4 000 chars it is
written to a temp file.

### `restart-server`

Restart the Next.js dev server and clear its caches. Forces a clean
recompile from scratch.

Last resort. HMR picks up code changes on its own — reach for this only
when you have evidence the dev server is wedged (stale output after edits,
builds that never finish, errors that don't clear).

Often exits with `net::ERR_ABORTED` — this is expected (the page detaches
during restart). Follow up with `goto <url>` to re-navigate after the
server is back. Don't treat this error as a failure.

---

### `ppr lock`

**Prerequisite:** PPR requires `cacheComponents` to be enabled in
`next.config`. Without it the shell won't have pre-rendered content to show.

Freeze dynamic content so you can inspect the static shell — the part of
the page that's instantly available before any data loads. After locking:
- `goto` — shows the server-rendered shell with holes where dynamic
  content would appear.
- `push` — shows what the client already has from prefetching. Requires
  the current page to already be hydrated (prefetch is client-side),
  so lock *after* you've landed on the origin, not before.

```
$ next-browser ppr lock
locked
```

### `ppr unlock`

Resume dynamic content and print a shell analysis — which Suspense
boundaries were holes in the shell, what blocked them, and which were
static. The output can be very large (hundreds of boundaries). Pipe
through `| head -20` if you only need the summary and dynamic holes.

```
$ next-browser ppr unlock
unlocked

# PPR Shell Analysis
# 131 boundaries: 3 dynamic holes, 128 static

## Summary
- Top actionable hole: TrackedSuspense — usePathname (client-hook)
- Suggested next step: This route segment is suspending on client hooks. Check loading.tsx first...
- Most common root cause: usePathname (client-hook) affecting 1 boundary

## Quick Reference
| Boundary                   | Type              | Fallback source | Primary blocker           | Source                        | Suggested next step       |
| ---                        | ---               | ---             | ---                       | ---                           | ---                       |
| TrackedSuspense            | component         | unknown         | usePathname (client-hook) | tracked-suspense.js:6         | Push the hook-using cl... |
| TeamDeploymentsLayout      | route-segment     | unknown         | unknown                   | layout.tsx:37                 | Inspect the nearest us... |
| Next.Metadata              | component         | unknown         | unknown                   | unknown                       | No primary blocker was... |

## Detail
  TrackedSuspense
    rendered by: TrackedSuspense > RootLayout > AppLayout
    environments: SSR
  TeamDeploymentsLayout
    suspenders unknown: thrown Promise (library using throw instead of use())

## Static (pre-rendered in shell)
  GeistProvider at .../geist-provider.tsx:80:9
  TrackedSuspense at ...
  ...
```

The **Quick Reference** table is the main overview — boundary, blocker,
source, and suggested fix at a glance. The **Detail** section only appears
for holes that have extra info (owner chains, environments, secondary
blockers) not already in the table.

**`errors` doesn't report while locked.** If the shell looks wrong (empty,
bailed to CSR), unlock and `goto` the page normally, then run `errors`.
Don't debug blind under the lock.

**Full bailout (scrollHeight = 0).** When PPR bails out completely, `unlock`
returns just "unlocked" with no shell analysis — there are no boundaries to
report. In this case, unlock, `goto` the page normally, then use `errors`
and `logs` to find the root cause.

---

### `tree`

Full React component tree — every component on the page with its
hierarchy, like the Components panel in React DevTools.

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

### `viewport [WxH]`

Show or set the browser viewport size. Useful for testing responsive layouts.

```
$ next-browser viewport
1440x900

$ next-browser viewport 375x812
viewport set to 375x812
```

Once set, the viewport stays fixed across navigations.
`window.resizeTo()` via `eval` is a no-op in Playwright — always use this
command to change dimensions.

---

### `preview [caption] [--clear]`

Take a screenshot and pop it open in a separate headed Chromium window.
**Images accumulate** — each call appends a new captioned screenshot
below the previous ones, separated by a divider. Use `--clear` to reset
and start fresh. The preview window is closed automatically when you run
`close`.

```
$ next-browser preview "Before fix"
preview → /var/folders/.../next-browser-1772770369495.png

$ next-browser preview "After fix"
preview → /var/folders/.../next-browser-1772770369496.png
# Window now shows both images stacked vertically

$ next-browser preview --clear "Fresh start"
preview → /var/folders/.../next-browser-1772770369497.png
# Window reset — only shows this image
```

### `screenshot`

Viewport PNG to a temp file. Returns the path. Read with the Read tool.
Use `--full-page` to capture the entire scrollable page.

```
$ next-browser screenshot
/var/folders/.../next-browser-1772770369495.png

$ next-browser screenshot --full-page
/var/folders/.../next-browser-1772770369496.png
```

**Always follow `screenshot` with `preview` + a caption** so the user
can see what you see. `screenshot` alone only saves a file — the user
has no visibility into what you captured unless you `preview` it.

**For before/after comparison**, call `preview "Before"` on the original
state, then make changes and call `preview "After"`. Both images stay
visible in the preview window. Use `--clear` when starting a new
comparison to reset accumulated images.

Don't narrate what the screenshot shows — the user can see the browser.
State your conclusion or next action, not a description of the page.

**Prefer `snapshot` over `screenshot`** when you need to understand
what's on the page or decide what to interact with. `snapshot`
returns structured, semantic data (roles, names, state) that you can act
on directly — screenshots are pixels you have to interpret. Use
`screenshot` only when visual layout matters (CSS issues, verifying
appearance, PPR shell inspection).

### `snapshot`

Snapshot the page's accessibility tree — the semantic structure a screen
reader sees — with `[ref=eN]` markers on every interactive element. Use
this to discover what's on the page before clicking.

```
$ next-browser snapshot
- navigation "Main"
  - link "Home" [ref=e0]
  - link "Dashboard" [ref=e1]
- main
  - heading "Settings"
  - tablist
    - tab "General" [ref=e2] (selected)
    - tab "Security" [ref=e3]
  - region "Profile"
    - textbox "Username" [ref=e4]
    - button "Save" [ref=e5]
```

The tree shows headings, landmarks (`navigation`, `main`, `region`), and
state (`selected`, `checked`, `expanded`, `disabled`) so you understand
page layout, not just a flat element list.

Refs are ephemeral — they reset on every `snapshot` call and are
invalid after navigation. Re-run `snapshot` after `goto`/`push`.

### `click <ref|text|selector>`

Click an element using real pointer events (`pointerdown → mousedown →
pointerup → mouseup → click`). This works with libraries that ignore
synthetic `.click()` (Radix UI, Headless UI, etc.).

Three ways to target:

| Input            | Example                | How it resolves                       |
| ---              | ---                    | ---                                   |
| Ref from tree    | `click e3`             | Looks up role+name from last snapshot |
| Plain text       | `click "Security"`     | Playwright `text=Security` selector   |
| Playwright selector | `click "#submit-btn"` | Used as-is (CSS, `role=`, etc.)    |

**Recommended workflow:** run `snapshot` first, then `click eN`.
Refs are the most reliable — they resolve via ARIA role+name, so they
work even when elements have no stable CSS selector.

**Clicking navigation links can timeout.** `click` on a Next.js `<Link>`
waits for the navigation to settle, which can exceed the command timeout.
If `click` hangs on a nav link, cancel it and use `goto <url>` instead.

```
$ next-browser snapshot
- tablist
  - tab "General" [ref=e0] (selected)
  - tab "Security" [ref=e1]
$ next-browser click e1
clicked
$ next-browser snapshot
- tablist
  - tab "General" [ref=e0]
  - tab "Security" [ref=e1] (selected)
```

### `fill <ref|selector> <value>`

Fill a text input or textarea. Clears existing content, then types the
new value — dispatches all the events React and other frameworks expect.

```
$ next-browser snapshot
- textbox "Username" [ref=e4]
$ next-browser fill e4 "judegao"
filled
```

### `eval [ref] <script>` · `eval [ref] --file <path>` · `eval -`

Run JS in page context. Returns the result as JSON.

**With a ref**, the script receives the DOM element as its argument —
useful for inspecting a snapshot node or bridging to React internals:

```
$ next-browser eval e0 'el => el.tagName'
"BUTTON"

$ next-browser eval e0 'el => {
  const key = Object.keys(el).find(k => k.startsWith("__reactFiber$"));
  if (!key) return null;
  let fiber = el[key];
  while (fiber && typeof fiber.type !== "function") fiber = fiber.return;
  return fiber?.type?.displayName || fiber?.type?.name || null;
}'
"LoginButton"
```

**For simple one-liners** (no ref), pass the script inline:

```
$ next-browser eval 'document.title'
"Deployments – Vercel"

$ next-browser eval 'document.querySelectorAll("a[href]").length'
47
```

**For multi-line or quote-heavy scripts**, use `--file` (or `-f`) to avoid
shell quoting issues entirely:

```bash
cat > /tmp/nb-eval.js << 'SCRIPT'
(() => {
  // your JS here — no shell escaping needed
  return someResult;
})()
SCRIPT
next-browser eval --file /tmp/nb-eval.js
```

You can also pipe via stdin: `echo 'document.title' | next-browser eval -`

Use this to read the Next.js error overlay (it's in shadow DOM):
`next-browser eval 'document.querySelector("nextjs-portal")?.shadowRoot?.querySelector("[data-nextjs-dialog]")?.textContent'`

`eval` runs synchronously in page context — top-level `await` is not
supported. Wrap in an async IIFE if you need to await:
`next-browser eval '(async () => { ... })()'`.

---

### `errors`

Build and runtime errors for the current page.

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

Recent dev server log output.

```
$ next-browser logs
{"timestamp":"00:01:55.381","source":"Server","level":"WARN","message":"[browser] navigation-metrics: skeleton visible was already recorded..."}
{"timestamp":"00:01:55.382","source":"Browser","level":"WARN","message":"navigation-metrics: content visible was already recorded..."}
```

### `browser-logs`

Browser-side console output (`console.log`, `console.warn`, `console.error`,
`console.info`). Captured directly from the page — works with both dev and
production builds.

```
$ next-browser browser-logs
[LOG  ] Initializing app
[WARN ] Deprecation: use fetchV2 instead
[ERROR] Failed to load resource: 404
[INFO ] render complete in 42ms
```

Up to 500 entries are kept; oldest are dropped when the buffer is full.
Entries accumulate across navigations within the same browser session.
If output exceeds 4 000 chars it is written to a temp file and the path
is printed instead.

**When to use which:**

| Command        | Source                           | Requires dev server |
|----------------|----------------------------------|---------------------|
| `logs`         | Next.js dev server stdout        | Yes                 |
| `errors`       | Build errors + `console.error`   | Yes                 |
| `browser-logs` | All browser console output       | No                  |

For dev server diagnostics, prefer `logs` and `errors`. Use `browser-logs`
when you need general console output or are running a production build.

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

Route segments for the current URL — which layouts, pages, and
boundaries are active.

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

## Scenarios

### Debugging rendering performance

When the user says "this page is slow after load", "too many re-renders",
"laggy interactions", or "janky" — this is update-phase rendering, not
initial load. Use `renders` to profile it. (For initial load, use `perf`.)

**Workflow:**

1. `renders start` — begin recording.
2. `goto` the page (the hook survives navigation and captures mount).
3. Reproduce the slow interaction: click buttons, type in inputs,
   navigate via `push`, or just wait if the issue is polling/timers.
4. `renders stop` — read the raw data.
5. Use the data to form hypotheses. The columns give you:
   - `Renders` + `Self` — is this component expensive per-render, or
     just called too often?
   - `DOM` — did the renders actually produce visible changes?
     A component with 100 renders and 0 DOM mutations is doing
     purely wasted work.
   - `Total` vs `Self` — is the cost in this component or its children?
   - Change reasons — what's driving the re-renders?
   - FPS — are the re-renders actually causing user-visible jank?
6. `tree` to find the component's ID, then `tree <id>` for its source
   file, props, and hooks.
7. Read the source to understand *why* it re-renders.

**Verify the fix.** After editing the code, HMR picks it up. Re-run
`renders start` / `renders stop` and compare the raw numbers to the
previous profile.

**Test your hypothesis before proposing a fix.** If you suspect a
component is the root cause, find evidence — inspect it with `tree`,
read its source, check what's changing via the change reason column.
Don't propose changes from a single observation.

### Growing the static shell

The shell is what the user sees the instant they land — before any dynamic
data arrives. The measure is the screenshot while locked: does it read as
the page itself? A shell can be non-empty and still bad — one Suspense
fallback wrapping the whole content area renders *something*, but it's a
monolithic loading state, not the page.

A meaningful shell is the real component tree with small, local fallbacks
where data is genuinely pending. Getting there means the composition layer
— the layouts and wrappers between those leaf boundaries — can't itself
suspend. `ppr unlock`'s Quick Reference table names the primary blocker
and source for each hole; the Detail section adds owner chains and
secondary blockers. A suspend high in the tree is what collapses
everything beneath it into one fallback.

Work it top-down. For the component that's suspending: can the dynamic
access move into a child? If yes, move it — this component becomes sync
and rejoins the shell. Follow the access down and ask again.

When you reach a component where it can't move any lower, there are two
exits — both are human calls, bring the question to them:

- Wrap it in a Suspense boundary. The fallback UI should resemble what
  renders inside — design it together, don't assume.
- Cache it so it's available at prerender (Cache Components). Whether
  this data is safe to cache — staleness, who sees it — is their call,
  not yours.

**Test your hypothesis before proposing a fix.** If you suspect a
component is the cause, find evidence — check `errors`, inspect the
component with `tree`, or compare a route where the shell works to
one where it doesn't. Don't commit to a root cause or propose changes
from a single observation.

There are two shells depending on how the user arrives. They're observed
differently and can differ in content — establish which one you're
optimizing before touching the browser. If the ask is "make this page
load faster" without qualification, ask: cold URL hit, or clicking in
from another page (which page)? Don't guess, don't do both.

**Direct load — the PPR shell.** Server HTML for a cold hit on the URL.
Lock first, then `goto` the target — the lock suppresses hydration so you
see exactly what the server sent. Screenshot once the load settles, then
unlock.

**Client navigation — the prefetched shell.** What the router already
holds when a link is clicked. The origin page decides this — it's the one
doing the prefetching — so `goto` the origin *unlocked* and let it fully
hydrate. Then lock, `push` to the target, let the navigation settle,
screenshot, unlock. Locking before the origin hydrates means nothing got
prefetched and `push` has nothing to show.

Between iterations: check `errors` while unlocked.

**After making a code change:** HMR picks it up — just re-lock,
`goto` the page, and re-test. No need to `restart-server`.
