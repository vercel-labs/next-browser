/**
 * Browser manager — single headed Chromium instance with React DevTools.
 *
 * Launches via Playwright with the React DevTools Chrome extension pre-loaded
 * and --auto-open-devtools-for-tabs so the extension activates naturally.
 * DevTools opens in a separate (undocked) window so the main browser viewport
 * stays at full desktop size.
 * installHook.js is pre-injected via addInitScript to win the race against
 * the extension's content script registration.
 *
 * Module-level state: one browser context, one page, one PPR lock.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { instant } from "@next/playwright";
import * as componentTree from "./tree.ts";
import * as suspenseTree from "./suspense.ts";
import * as sourcemap from "./sourcemap.ts";
import * as nextMcp from "./mcp.ts";
import * as net from "./network.ts";

// React DevTools extension — vendored or overridden via env var.
const extensionPath =
  process.env.REACT_DEVTOOLS_EXTENSION ??
  resolve(import.meta.dirname, "../extensions/react-devtools-chrome");

// Pre-read the hook script so it's ready for addInitScript on launch.
const installHook = readFileSync(
  join(extensionPath, "build", "installHook.js"),
  "utf-8",
);

let context: BrowserContext | null = null;
let page: Page | null = null;
let profileDirPath: string | null = null;
let initialOrigin: string | null = null;
let ssrLocked = false;

let previewBrowser: Browser | BrowserContext | null = null;
let previewPage: Page | null = null;
let previewImages: { caption?: string; imgData: string; timestamp: string }[] = [];

/** Install or remove the script-blocking route handler based on ssrLocked. */
async function syncSsrRoutes() {
  if (!page) return;
  await page.unrouteAll({ behavior: "wait" });
  if (ssrLocked) {
    await page.route("**/*", (route) => {
      if (route.request().resourceType() === "script") return route.abort();
      return route.continue();
    });
  }
}

// ── Browser lifecycle ────────────────────────────────────────────────────────

/**
 * Launch the browser (if not already open) and optionally navigate to a URL.
 * The first call spawns Chromium with the DevTools extension; subsequent calls
 * reuse the existing context.
 */
export async function open(url: string | undefined) {
  if (context) {
    await close();
  }
  context = await launch();
  page = context.pages()[0] ?? (await context.newPage());
  net.attach(page);
  if (url) {
    initialOrigin = new URL(url).origin;
    await page!.goto(url, { waitUntil: "domcontentloaded" });
  }
}

/**
 * Set cookies on the browser context. Must be called after open() but before
 * navigating to the target page, so the cookies are present on the first request.
 * Accepts the same {name, value}[] format as ppr-optimizer's AUTH_COOKIES.
 */
export async function cookies(cookies: { name: string; value: string }[], domain: string) {
  if (!context) throw new Error("browser not open");
  await context.addCookies(
    cookies.map((c) => ({ name: c.name, value: c.value, domain, path: "/" })),
  );
  return cookies.length;
}

/** Close the browser and reset all state. */
export async function close() {
  await previewBrowser?.close().catch(() => {});
  previewBrowser = null;
  previewPage = null;
  previewImages = [];
  await context?.close();
  context = null;
  page = null;
  release = null;
  settled = null;
  ssrLocked = false;
  // Clean up temp profile directory.
  if (profileDirPath) {
    const { rmSync } = await import("node:fs");
    rmSync(profileDirPath, { recursive: true, force: true });
    profileDirPath = null;
    initialOrigin = null;
  }
}

// ── PPR lock/unlock ──────────────────────────────────────────────────────────
//
// The lock uses @next/playwright's `instant()` which sets the
// `next-instant-navigation-testing=1` cookie. While locked:
//   - goto: server sends the raw PPR shell (static HTML + <template> holes)
//   - push: Next.js router blocks dynamic data writes, shows prefetched shell
//
// The lock is held by stashing instant()'s inner promise resolver (`release`).
// Calling unlock() resolves it, which lets instant() finish and clear the cookie.

let release: (() => void) | null = null;
let settled: Promise<void> | null = null;

/** Enter PPR instant-navigation mode. The cookie is set immediately. */
export function lock() {
  if (!page) throw new Error("browser not open");
  if (release) return Promise.resolve();

  return new Promise<void>((locked) => {
    settled = instant(page!, () => {
      locked();
      return new Promise<void>((r) => (release = r));
    });
  });
}

/**
 * Exit PPR mode and produce a shell analysis report.
 *
 * Two-phase capture:
 *   1. LOCKED snapshot — which boundaries are currently suspended (= holes in the shell).
 *      Waits for the suspended count to stabilize first, so fast-resolving boundaries
 *      (e.g. a feature flag guard that completes in <100ms) don't get falsely reported.
 *      Falls back to counting <template id="B:..."> DOM elements for the goto case
 *      where React DevTools can't inspect the production-like shell.
 *
 *   2. Release the lock. For push: dynamic content streams in (no reload).
 *      For goto: cookie cleared → page auto-reloads.
 *
 *   3. UNLOCKED snapshot — all boundaries resolved, with full suspendedBy data
 *      (what blocked each one: hooks, server calls, cache, scripts, etc.)
 *
 *   4. Match locked holes against unlocked data by JSX source location,
 *      producing the final "Dynamic holes / Static" report.
 */
export async function unlock() {
  if (!release) return null;
  if (!page) return null;

  const origin = new URL(page.url()).origin;

  // Wait for the suspended boundary count to stop changing. This filters out
  // boundaries that suspend briefly then resolve (e.g. fast flag checks) —
  // only truly stuck boundaries remain as "holes."
  await stabilizeSuspenseState(page);

  // Capture what's suspended right now under the lock.
  // Under goto + lock, DevTools may not be connected (shell is static HTML).
  // That's fine — we get all the rich data from the unlocked snapshot below.
  const locked = await suspenseTree.snapshot(page).catch(() => [] as suspenseTree.Boundary[]);

  // Release the lock. instant() clears the cookie.
  // - push case: dynamic content streams in immediately (no reload)
  // - goto case: cookieStore change → auto-reload → full page load
  release();
  release = null;
  await settled;
  settled = null;

  // For goto case: the page auto-reloads. Wait for the new page to load
  // and React/DevTools to reconnect before trying to snapshot boundaries.
  await page.waitForLoadState("load").catch(() => {});
  await waitForDevToolsReconnect(page);

  // Wait for all boundaries to resolve after unlock.
  await waitForSuspenseToSettle(page);

  // Capture the fully-resolved state with rich suspendedBy data.
  const unlocked = await suspenseTree.snapshot(page).catch(() => [] as suspenseTree.Boundary[]);

  if (locked.length === 0 && unlocked.length === 0) {
    return { text: "No suspense boundaries detected.", boundaries: unlocked, locked, report: null };
  }

  const report = await suspenseTree.analyzeBoundaries(unlocked, locked, origin);
  const pageMetadata = await nextMcp
    .call(initialOrigin ?? origin, "get_page_metadata")
    .catch(() => null);
  if (pageMetadata) {
    suspenseTree.annotateReportWithPageMetadata(report, pageMetadata);
  }

  const text = suspenseTree.formatReport(report);
  return { text, boundaries: unlocked, locked, report };
}

/**
 * Wait for the suspended boundary count to stop changing.
 *
 * Polls every 300ms. Returns once two consecutive polls show the same
 * suspended count. This lets fast-resolving boundaries (feature flag guards,
 * instant cache hits) settle before we snapshot — preventing false positives
 * where a boundary appears as a "hole" but resolves before the shell paints.
 */
async function stabilizeSuspenseState(p: Page) {
  const deadline = Date.now() + 5_000;
  let lastSuspended = -1;
  await new Promise((r) => setTimeout(r, 300));
  while (Date.now() < deadline) {
    const { suspended } = await suspenseTree.countBoundaries(p);
    if (suspended === lastSuspended) return;
    lastSuspended = suspended;
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * Wait for all Suspense boundaries to resolve after unlock.
 *
 * Used after releasing the PPR lock. For push: dynamic content streams in
 * via JS. For goto: the page auto-reloads after the cookie clears.
 * In both cases, we poll the DevTools suspense tree until no boundaries
 * are suspended (or timeout after 10s).
 *
 * Tracks whether we've ever seen boundaries — if DevTools never reports any
 * (e.g. during a goto reload where it takes time to reconnect), we wait up
 * to 5s for them to appear before giving up.
 */
async function waitForSuspenseToSettle(p: Page) {
  const deadline = Date.now() + 10_000;
  await new Promise((r) => setTimeout(r, 500));
  let sawBoundaries = false;
  while (Date.now() < deadline) {
    const { total, suspended } = await suspenseTree.countBoundaries(p);
    if (total > 0) {
      sawBoundaries = true;
      if (suspended === 0) return;
    } else if (!sawBoundaries && Date.now() > deadline - 5000) {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Wait for React DevTools to reconnect after a page reload.
 *
 * After the goto case unlocks, the page auto-reloads and DevTools loses its
 * renderer connection. Poll until the DevTools hook reports at least one
 * renderer, or bail after 5s. This replaces the old hardcoded 2s sleep.
 */
async function waitForDevToolsReconnect(p: Page) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const connected = await p.evaluate(() => {
      const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      return hook?.rendererInterfaces?.size > 0;
    }).catch(() => false);
    if (connected) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ── SSR lock/unlock ──────────────────────────────────────────────────────────
//
// While SSR-locked, every navigation blocks external script resources so the
// page renders only the server-side HTML shell (no React hydration, no client
// bundles). Useful for inspecting raw SSR output across multiple navigations.

/** Enter SSR-locked mode. All subsequent navigations block external scripts. */
export async function ssrLock() {
  if (!page) throw new Error("browser not open");
  if (ssrLocked) return;
  ssrLocked = true;
  await syncSsrRoutes();
}

/** Exit SSR-locked mode. Re-enables external scripts. */
export async function ssrUnlock() {
  if (!page) throw new Error("browser not open");
  if (!ssrLocked) return;
  ssrLocked = false;
  await syncSsrRoutes();
}

// ── Navigation ───────────────────────────────────────────────────────────────

/** Hard reload the current page. Returns the URL after reload. */
export async function reload() {
  if (!page) throw new Error("browser not open");
  await page.reload({ waitUntil: "domcontentloaded" });
  return page.url();
}

/**
 * Profile a page load: reload (or navigate to a URL) and collect Core Web
 * Vitals (LCP, CLS, TTFB) plus React hydration timing.
 *
 * CWVs come from PerformanceObserver and Navigation Timing API.
 * Hydration timing comes from console.timeStamp entries emitted by React's
 * profiling build (see the addInitScript interceptor in launch()).
 *
 * Returns structured data that the CLI formats into a readable report.
 */
export async function perf(url?: string) {
  if (!page) throw new Error("browser not open");
  const targetUrl = url || page.url();

  // Install CWV observers before navigation so they capture everything.
  await page.evaluate(() => {
    (window as any).__NEXT_BROWSER_REACT_TIMING__ = [];
    const cwv: any = { lcp: null, cls: 0, clsEntries: [] };
    (window as any).__NEXT_BROWSER_CWV__ = cwv;

    // Largest Contentful Paint
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length > 0) {
        const last = entries[entries.length - 1] as any;
        cwv.lcp = {
          startTime: Math.round(last.startTime * 100) / 100,
          size: last.size,
          element: last.element?.tagName?.toLowerCase() ?? null,
          url: last.url || null,
        };
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });

    // Cumulative Layout Shift
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        if (!entry.hadRecentInput) {
          cwv.cls += entry.value;
          cwv.clsEntries.push({
            value: Math.round(entry.value * 10000) / 10000,
            startTime: Math.round(entry.startTime * 100) / 100,
          });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  // Navigate or reload to trigger a full page load.
  if (url) {
    await page.goto(targetUrl, { waitUntil: "load" });
  } else {
    await page.reload({ waitUntil: "load" });
  }

  // Wait for passive effects, late paints, and layout shifts to flush.
  await new Promise((r) => setTimeout(r, 3000));

  // Collect all metrics from the page.
  const metrics = await page.evaluate(() => {
    const cwv = (window as any).__NEXT_BROWSER_CWV__ ?? {};
    const timing = (window as any).__NEXT_BROWSER_REACT_TIMING__ ?? [];

    // TTFB from Navigation Timing API.
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const ttfb = nav
      ? Math.round((nav.responseStart - nav.requestStart) * 100) / 100
      : null;

    return { cwv, timing, ttfb };
  }) as {
    cwv: {
      lcp: { startTime: number; size: number; element: string | null; url: string | null } | null;
      cls: number;
      clsEntries: { value: number; startTime: number }[];
    };
    timing: Array<{
      label: string;
      startTime: number;
      endTime: number;
      track: string;
      trackGroup: string;
      color: string;
    }>;
    ttfb: number | null;
  };

  // Process React hydration timing.
  const phases = metrics.timing.filter((e) => e.trackGroup === "Scheduler ⚛" && e.endTime > e.startTime);
  const components = metrics.timing.filter((e) => e.track === "Components ⚛" && e.endTime > e.startTime);
  const hydrationPhases = phases.filter((e) => e.label === "Hydrated");
  const hydratedComponents = components.filter((e) => e.color?.startsWith("tertiary"));

  let hydrationStart = Infinity;
  let hydrationEnd = 0;
  for (const p of hydrationPhases) {
    if (p.startTime < hydrationStart) hydrationStart = p.startTime;
    if (p.endTime > hydrationEnd) hydrationEnd = p.endTime;
  }

  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    url: targetUrl,
    ttfb: metrics.ttfb,
    lcp: metrics.cwv.lcp,
    cls: {
      score: round(metrics.cwv.cls),
      entries: metrics.cwv.clsEntries,
    },
    hydration: hydrationPhases.length > 0
      ? {
          startTime: round(hydrationStart),
          endTime: round(hydrationEnd),
          duration: round(hydrationEnd - hydrationStart),
        }
      : null,
    phases: phases.map((p) => ({
      label: p.label,
      startTime: round(p.startTime),
      endTime: round(p.endTime),
      duration: round(p.endTime - p.startTime),
    })),
    hydratedComponents: hydratedComponents
      .map((c) => ({
        name: c.label,
        startTime: round(c.startTime),
        endTime: round(c.endTime),
        duration: round(c.endTime - c.startTime),
      }))
      .sort((a, b) => b.duration - a.duration),
  };
}

/**
 * Restart the Next.js dev server via its internal endpoint, then reload.
 * Polls /__nextjs_server_status until the executionId changes (new process).
 */
export async function restart() {
  if (!page) throw new Error("browser not open");
  const origin = new URL(page.url()).origin;

  const before = await executionId(origin);

  const url = `${origin}/__nextjs_restart_dev?invalidateFileSystemCache=1`;
  await fetch(url, { method: "POST" }).catch(() => {});

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_000));
    const after = await executionId(origin).catch(() => null);
    if (after != null && after !== before) break;
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  return page.url();
}

async function executionId(origin: string) {
  const res = await fetch(`${origin}/__nextjs_server_status`);
  const data = (await res.json()) as { executionId: number };
  return data.executionId;
}

/**
 * Collect all same-origin <a> links on the current page.
 * Used by the interactive `push` picker — shows what routes are navigable
 * from the current page (i.e. have <Link> components that trigger prefetch).
 */
export async function links() {
  if (!page) throw new Error("browser not open");
  return page.evaluate(() => {
    const origin = location.origin;
    const seen = new Set<string>();
    const results: { href: string; text: string }[] = [];
    for (const a of document.querySelectorAll("a[href]")) {
      const url = new URL(a.getAttribute("href")!, location.href);
      if (url.origin !== origin) continue;
      const path = url.pathname + url.search + url.hash;
      if (seen.has(path) || path === location.pathname) continue;
      seen.add(path);
      const text = (a.textContent || "").trim().slice(0, 80);
      results.push({ href: path, text });
    }
    return results;
  });
}

/**
 * Client-side navigation via Next.js router.push().
 * Requires the target route to be prefetched (a <Link> must exist on the
 * current page pointing to it). If the route isn't prefetched, push silently
 * fails and returns the current URL unchanged.
 */
export async function push(path: string) {
  if (!page) throw new Error("browser not open");
  const before = page.url();
  await page.evaluate((p) => (window as any).next.router.push(p), path);
  await page.waitForURL((u) => u.href !== before, { timeout: 10_000 }).catch(() => {});
  return page.url();
}

/** Full-page navigation (new document load). Resolves relative URLs against the current page. */
export async function goto(url: string) {
  if (!page) await open(undefined);
  const target = new URL(url, page!.url()).href;
  initialOrigin = new URL(target).origin;
  await page!.goto(target, { waitUntil: "domcontentloaded" });
  return target;
}

/** Go back in browser history. */
export async function back() {
  if (!page) throw new Error("browser not open");
  await page.goBack({ waitUntil: "domcontentloaded" });
}

// ── React component tree ─────────────────────────────────────────────────────

let lastSnapshot: componentTree.Node[] = [];

/**
 * Get the full React component tree via DevTools' flushInitialOperations().
 * Decodes TREE_OPERATION_ADD entries from the operations wire format into
 * a flat node list with depth/id/parent/name columns.
 */
export async function tree() {
  if (!page) throw new Error("browser not open");
  lastSnapshot = await componentTree.snapshot(page);
  return componentTree.format(lastSnapshot);
}

/**
 * Inspect a single component by fiber ID. Returns props, hooks, state,
 * ownership chain, and source-mapped file location. Uses the last tree
 * snapshot to build the ancestor path.
 */
export async function node(id: number) {
  if (!page) throw new Error("browser not open");
  const { text, source } = await componentTree.inspect(page, id);

  const lines: string[] = [];
  const path = componentTree.path(lastSnapshot, id);
  if (path) lines.push(`path: ${path}`);
  lines.push(text);
  if (source) lines.push(await formatSource(source));

  return lines.join("\n");
}

/**
 * Resolve a bundled source location to its original file via source maps.
 * Tries the Next.js dev server endpoint first (resolves user code),
 * then falls back to fetching .map files directly (handles node_modules).
 */
async function formatSource([file, line, col]: [string, number, number]) {
  const origin = new URL(page!.url()).origin;

  const resolved = await sourcemap.resolve(origin, file, line, col);
  if (resolved) return `source: ${resolved.file}:${resolved.line}:${resolved.column}`;

  const viaMap = await sourcemap.resolveViaMap(origin, file, line, col);
  if (viaMap) return `source: ${viaMap.file}:${viaMap.line}:${viaMap.column}`;

  return `source: ${file}:${line}:${col}`;
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Take a screenshot and display it in a separate headed Chromium window.
 *  Images accumulate across calls — use `clear` to reset. */
export async function preview(caption?: string, clear?: boolean) {
  if (!page) throw new Error("browser not open");
  if (clear) previewImages = [];

  const path = await screenshot();
  const imgData = readFileSync(path).toString("base64");
  const timestamp = new Date().toLocaleTimeString();
  previewImages.unshift({ caption, imgData, timestamp });

  const imagesHtml = previewImages
    .map(
      (img) =>
        `<div style="padding:4px 12px;display:flex;align-items:baseline;gap:8px">` +
        (img.caption
          ? `<span style="font-size:14px">${escapeHtml(img.caption)}</span>`
          : "") +
        `<span style="font-size:11px;opacity:0.5">${escapeHtml(img.timestamp)}</span>` +
        `</div>` +
        `<img src="data:image/png;base64,${img.imgData}" style="display:block;max-width:100%">`,
    )
    .join(`<hr style="border:none;border-top:1px solid #333;margin:12px 0">`);

  const html =
    `<html><head><title>next-browser preview</title></head>` +
    `<body style="margin:0;background:#111;color:#fff;font-family:system-ui">` +
    `<div style="padding:8px 12px;font-size:11px;opacity:0.5;text-transform:uppercase;letter-spacing:0.05em">next-browser preview</div>` +
    `${imagesHtml}` +
    `</body></html>`;
  const htmlPath = path.replace(/\.png$/, ".html");
  writeFileSync(htmlPath, html);
  const target = `file://${htmlPath}`;

  // Reuse existing preview window, or launch a new one.
  if (previewPage && !previewPage.isClosed()) {
    try {
      await previewPage.goto(target);
      await previewPage.bringToFront();
      return path;
    } catch {
      // Window was closed by user — fall through to launch a new one.
      await previewBrowser?.close().catch(() => {});
    }
  }

  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const userDataDir = mkdtempSync(join(tmpdir(), "nb-preview-"));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--app=${target}`, "--window-size=820,640"],
    viewport: null,
  });
  previewBrowser = ctx;
  previewPage = ctx.pages()[0] ?? (await ctx.waitForEvent("page"));
  await previewPage.waitForLoadState();
  await previewPage.bringToFront();
  return path;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Screenshot saved to a temp file. Returns the file path. */
export async function screenshot(opts?: { fullPage?: boolean }) {
  if (!page) throw new Error("browser not open");
  await hideDevOverlay();
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const path = join(tmpdir(), `next-browser-${Date.now()}.png`);
  await page.screenshot({ path, fullPage: opts?.fullPage });
  return path;
}

/** Remove Next.js devtools overlay from the page before screenshots. */
async function hideDevOverlay() {
  if (!page) return;
  await page.evaluate(() => {
    document.querySelectorAll("[data-nextjs-dev-overlay]").forEach((el) => el.remove());
  }).catch(() => {});
}

// ── Ref map for interactive elements ──────────────────────────────────

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "checkbox", "radio", "combobox", "listbox",
  "menuitem", "menuitemcheckbox", "menuitemradio", "option", "searchbox",
  "slider", "spinbutton", "switch", "tab", "treeitem",
]);

type Ref = { role: string; name: string; nth?: number };
let refMap: Ref[] = [];

type CDPAXNode = {
  nodeId: string;
  role: { type: string; value: string };
  name?: { type: string; value: string };
  properties?: { name: string; value: { type: string; value: unknown } }[];
  childIds?: string[];
  backendDOMNodeId?: number;
};

/**
 * Snapshot the accessibility tree via CDP and return a text representation
 * with [ref=e0], [ref=e1] … markers on interactive elements.
 * Stores a ref map so that `click("e3")` can resolve back to role+name.
 */
export async function snapshot() {
  if (!page) throw new Error("browser not open");

  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree" as never)) as {
      nodes: CDPAXNode[];
    };

    // Index nodes by ID
    const byId = new Map<string, CDPAXNode>();
    for (const n of nodes) byId.set(n.nodeId, n);

    refMap = [];
    const roleNameCount = new Map<string, number>();
    const lines: string[] = [];

    function walk(node: CDPAXNode, depth: number) {
      const role = node.role?.value || "unknown";
      const name = (node.name?.value || "").trim().slice(0, 80);
      const isInteractive = INTERACTIVE_ROLES.has(role);

      // Read properties into a map
      const propMap = new Map<string, unknown>();
      for (const p of node.properties || []) propMap.set(p.name, p.value.value);

      const ignored = propMap.get("hidden") === true;
      if (ignored) return;

      // Always skip leaf text nodes — parent already carries the text
      if (role === "InlineTextBox" || role === "StaticText" || role === "LineBreak") return;

      // Skip generic/none wrappers with no name — just recurse children
      const SKIP_ROLES = new Set(["none", "generic", "GenericContainer"]);
      if (SKIP_ROLES.has(role) && !name) {
        for (const id of node.childIds || []) {
          const child = byId.get(id);
          if (child) walk(child, depth);
        }
        return;
      }

      // Skip root WebArea — just recurse
      if (role === "WebArea" || role === "RootWebArea") {
        for (const id of node.childIds || []) {
          const child = byId.get(id);
          if (child) walk(child, depth);
        }
        return;
      }

      const indent = "  ".repeat(depth);
      let line = `${indent}- ${role}`;
      if (name) line += ` "${name}"`;

      const disabled = propMap.get("disabled") === true;

      if (isInteractive && !disabled) {
        const key = `${role}::${name}`;
        const count = roleNameCount.get(key) || 0;
        roleNameCount.set(key, count + 1);

        const ref: Ref = { role, name };
        if (count > 0) ref.nth = count;
        const idx = refMap.length;
        refMap.push(ref);
        line += ` [ref=e${idx}]`;
      }

      // Append state properties
      const tags: string[] = [];
      if (propMap.get("checked") === "true" || propMap.get("checked") === true) tags.push("checked");
      if (propMap.get("checked") === "mixed") tags.push("mixed");
      if (disabled) tags.push("disabled");
      if (propMap.get("expanded") === true) tags.push("expanded");
      if (propMap.get("expanded") === false) tags.push("collapsed");
      if (propMap.get("selected") === true) tags.push("selected");
      if (tags.length) line += ` (${tags.join(", ")})`;

      lines.push(line);
      for (const id of node.childIds || []) {
        const child = byId.get(id);
        if (child) walk(child, depth + 1);
      }
    }

    // Start from the root (first node)
    if (nodes.length) walk(nodes[0], 0);
    return lines.join("\n");
  } finally {
    await cdp.detach();
  }
}

/** Resolve a ref (e.g. "e3") or selector string to a Playwright Locator. */
function resolveLocator(selectorOrRef: string) {
  if (!page) throw new Error("browser not open");

  const refMatch = selectorOrRef.match(/^e(\d+)$/);
  if (refMatch) {
    const idx = Number(refMatch[1]);
    const ref = refMap[idx];
    if (!ref) throw new Error(`ref e${idx} not found — run snapshot first`);
    const locator = page.getByRole(ref.role as Parameters<Page["getByRole"]>[0], {
      name: ref.name,
      exact: true,
    });
    return ref.nth != null ? locator.nth(ref.nth) : locator;
  }

  const hasPrefix = /^(css=|text=|role=|#|\[|\.|\w+\s*>)/.test(selectorOrRef);
  return page.locator(hasPrefix ? selectorOrRef : `text=${selectorOrRef}`);
}

/**
 * Click an element using real pointer events.
 * Accepts: "e3" (ref from snapshot), plain text, or Playwright selectors.
 */
export async function click(selectorOrRef: string) {
  if (!page) throw new Error("browser not open");
  await resolveLocator(selectorOrRef).click();
}

/**
 * Fill a text input/textarea. Clears existing value, then types the new one.
 * Accepts: "e3" (ref from snapshot), or a selector.
 */
export async function fill(selectorOrRef: string, value: string) {
  if (!page) throw new Error("browser not open");
  await resolveLocator(selectorOrRef).fill(value);
}

/**
 * Evaluate arbitrary JavaScript in the page context.
 * If ref is provided (e.g. "e3"), the script receives the DOM element as its
 * first argument: `next-browser eval e3 'el => el.textContent'`
 */
export async function evaluate(script: string, ref?: string) {
  if (!page) throw new Error("browser not open");
  if (ref) {
    const locator = resolveLocator(ref);
    const handle = await locator.elementHandle();
    if (!handle) throw new Error(`ref ${ref} not found in DOM`);
    // The script should be an arrow/function that receives the element.
    // We wrap it so page.evaluate can pass the element handle as an arg.
    return page.evaluate(
      ([fn, el]) => {
        // eslint-disable-next-line no-eval
        const f = (0, eval)(fn);
        return f(el);
      },
      [script, handle] as const,
    );
  }
  return page.evaluate(script);
}

/**
 * Call a Next.js dev server MCP tool (JSON-RPC over SSE at /_next/mcp).
 *
 * Uses the initial navigation origin (before any proxy redirects) rather than
 * the current page origin. This handles microfrontends proxies that redirect
 * e.g. localhost:3332 -> localhost:3024 but don't forward /_next/mcp.
 */
export async function mcp(tool: string, args?: Record<string, unknown>) {
  if (!page) throw new Error("browser not open");
  const origin = initialOrigin ?? new URL(page.url()).origin;
  return nextMcp.call(origin, tool, args);
}

/** Get network request log, or detail for a specific request index. */
export function network(idx?: number) {
  return idx == null ? net.format() : net.detail(idx);
}

// ── Viewport ─────────────────────────────────────────────────────────────────

/**
 * Set the browser viewport to the given dimensions.
 * Returns the applied size. Once set, the viewport stays fixed across
 * navigations — use `viewport(null, null)` to restore auto-sizing.
 */
export async function viewport(width: number | null, height: number | null) {
  if (!page) throw new Error("browser not open");
  if (width == null || height == null) {
    // Reset to auto-sizing: match the browser window.
    // Playwright doesn't expose a "reset viewport" API, so we read the
    // current window bounds via CDP and set the viewport to match.
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    const { bounds } = await cdp.send("Browser.getWindowBounds", { windowId });
    await cdp.detach();
    // Account for browser chrome (~roughly 80px for title bar + tabs).
    const w = bounds.width ?? 1280;
    const h = (bounds.height ?? 800) - 80;
    await page.setViewportSize({ width: w, height: h });
    return { width: w, height: h };
  }
  await page.setViewportSize({ width, height });
  // Also resize the physical window to match, so viewport == window.
  try {
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width, height: height + 80 }, // +80 for browser chrome
    });
    await cdp.detach();
  } catch {}
  return { width, height };
}

/** Get the current viewport dimensions. */
export async function viewportSize() {
  if (!page) throw new Error("browser not open");
  const size = page.viewportSize();
  if (size) return size;
  // viewport: null — read actual inner dimensions from the page.
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
}

// ── Browser launch ───────────────────────────────────────────────────────────

/**
 * Launch Chromium with the React DevTools hook pre-injected.
 *
 * addInitScript(installHook) installs the DevTools global hook before any
 * page JS runs. React discovers the hook and registers its renderers,
 * enabling tree inspection and suspense tracking without a browser extension.
 *
 * Set NEXT_BROWSER_HEADLESS=1 for cloud/CI environments (no display).
 */
async function launch() {
  const headless = !!process.env.NEXT_BROWSER_HEADLESS;
  const dir = join(tmpdir(), `next-browser-profile-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  profileDirPath = dir;

  const ctx = await chromium.launchPersistentContext(dir, {
    headless,
    viewport: null,
    // --no-sandbox is required when Chrome runs as root (common in containers/cloud sandboxes)
    args: [
      ...(headless ? ["--no-sandbox"] : []),
      "--window-size=1440,900",
    ],
  });
  await ctx.addInitScript(installHook);

  // Intercept console.timeStamp to capture React's Performance Track entries.
  // React's profiling build calls console.timeStamp(label, startTime, endTime,
  // track, trackGroup, color) for render phases and per-component timing.
  // startTime/endTime are performance.now() values from the reconciler.
  await ctx.addInitScript(() => {
    const entries: Array<{
      label: string;
      startTime: number;
      endTime: number;
      track: string;
      trackGroup?: string;
      color?: string;
    }> = [];
    (window as any).__NEXT_BROWSER_REACT_TIMING__ = entries;
    const orig = console.timeStamp;
    console.timeStamp = function (label?: string, ...args: any[]) {
      if (typeof label === "string" && args.length >= 2 && typeof args[0] === "number") {
        entries.push({
          label,
          startTime: args[0],
          endTime: args[1],
          track: args[2] ?? "",
          trackGroup: args[3] ?? "",
          color: args[4] ?? "",
        });
      }
      return orig.apply(console, [label, ...args] as any);
    };
  });

  // Next.js devtools overlay is removed before each screenshot via hideDevOverlay().

  return ctx;
}
