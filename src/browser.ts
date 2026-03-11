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
import { chromium, type BrowserContext, type Page } from "playwright";
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

// ── Browser lifecycle ────────────────────────────────────────────────────────

/**
 * Launch the browser (if not already open) and optionally navigate to a URL.
 * The first call spawns Chromium with the DevTools extension; subsequent calls
 * reuse the existing context.
 */
export async function open(url: string | undefined) {
  if (!context) {
    context = await launch();
    page = context.pages()[0] ?? (await context.newPage());
    net.attach(page);
  }
  if (url) {
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
  await context?.close();
  context = null;
  page = null;
  release = null;
  settled = null;
  // Clean up temp profile directory.
  if (profileDirPath) {
    const { rmSync } = await import("node:fs");
    rmSync(profileDirPath, { recursive: true, force: true });
    profileDirPath = null;
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
  if (release) throw new Error("already locked");

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
  let locked = await suspenseTree.snapshot(page).catch(() => [] as suspenseTree.Boundary[]);

  // For initial-load (goto) under lock, DevTools may not be connected —
  // the shell uses a production-like renderer. Fall back to counting
  // <template id="B:..."> elements in the DOM (PPR's Suspense placeholders).
  const hasDevToolsData = locked.some((b) => b.parentID !== 0);
  if (!hasDevToolsData) {
    locked = await suspenseTree.snapshotFromDom(page);
  }

  // Release the lock. instant() clears the cookie.
  // - push case: dynamic content streams in immediately (no reload)
  // - goto case: cookieStore change → auto-reload → full page load
  release();
  release = null;
  await settled;
  settled = null;

  // Wait for all boundaries to resolve after unlock.
  // Polls the DevTools suspense tree (works for both push and goto cases).
  await waitForSuspenseToSettle(page);

  // Capture the fully-resolved state with rich suspendedBy data.
  const unlocked = await suspenseTree.snapshot(page).catch(() => [] as suspenseTree.Boundary[]);

  if (locked.length === 0 && unlocked.length === 0) return null;
  return suspenseTree.formatAnalysis(unlocked, locked, origin);
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

// ── Navigation ───────────────────────────────────────────────────────────────

/** Hard reload the current page. Returns the URL after reload. */
export async function reload() {
  if (!page) throw new Error("browser not open");
  await page.reload({ waitUntil: "domcontentloaded" });
  return page.url();
}

/**
 * Reload the page while capturing screenshots every ~150ms.
 * Stops when: load has fired AND no new layout-shift entries for 2s.
 * Hard timeout at 30s. Returns the list of screenshot paths plus any
 * LayoutShift entries observed during the reload.
 */
/**
 * Lock PPR → goto → screenshot the shell → unlock → screenshot frames
 * until the page settles. Just PNGs in a directory — the AI reads them.
 *
 * Frame 0 is always the PPR shell. Remaining frames capture the transition
 * through hydration and data loading. Stops after 3s of no visual change.
 */
export async function captureGoto(url?: string) {
  if (!page) throw new Error("browser not open");
  const targetUrl = url || page.url();
  const dir = join(tmpdir(), `next-browser-capture-goto-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  let frameIdx = 0;

  async function snap() {
    const path = join(dir, `frame-${String(frameIdx).padStart(4, "0")}.png`);
    const buf = await page!.screenshot({ path }).catch(() => null);
    frameIdx++;
    return buf;
  }

  // PPR shell: lock suppresses hydration.
  await lock();
  await page.goto(targetUrl, { waitUntil: "load" }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  await snap();

  // Unlock → page reloads, hydrates, loads data.
  const unlockDone = unlock();
  await new Promise((r) => setTimeout(r, 200));

  let lastChangeTime = Date.now();
  let prevHash = "";
  const SETTLE_MS = 3_000;
  const HARD_TIMEOUT = 30_000;
  const start = Date.now();

  while (true) {
    const buf = await snap();

    let hash = "";
    if (buf) {
      let h = 0;
      for (let i = 0; i < buf.length; i += 200) h = ((h << 5) - h + buf[i]) | 0;
      hash = String(h);
    }
    if (hash !== prevHash) { lastChangeTime = Date.now(); prevHash = hash; }

    if (Date.now() - start > HARD_TIMEOUT) break;
    if (lastChangeTime > 0 && Date.now() - lastChangeTime > SETTLE_MS) break;

    await new Promise((r) => setTimeout(r, 150));
  }

  await unlockDone.catch(() => {});
  return { dir, frames: frameIdx };
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
  if (!page) throw new Error("browser not open");
  const target = new URL(url, page.url()).href;
  await page.goto(target, { waitUntil: "domcontentloaded" });
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

/** Full-page screenshot saved to a temp file. Returns the file path. */
export async function screenshot() {
  if (!page) throw new Error("browser not open");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const path = join(tmpdir(), `next-browser-${Date.now()}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

/** Evaluate arbitrary JavaScript in the page context. */
export async function evaluate(script: string) {
  if (!page) throw new Error("browser not open");
  return page.evaluate(script);
}

/** Call a Next.js dev server MCP tool (JSON-RPC over SSE at /_next/mcp). */
export async function mcp(tool: string, args?: Record<string, unknown>) {
  if (!page) throw new Error("browser not open");
  const origin = new URL(page.url()).origin;
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
 * Create a temporary Chrome profile directory with DevTools set to "undocked"
 * so it opens in a separate window instead of docked inside the browser.
 * This keeps the main browser viewport at full desktop size.
 */
function createProfileDir() {
  const dir = join(tmpdir(), `next-browser-profile-${process.pid}`);
  mkdirSync(join(dir, "Default"), { recursive: true });
  writeFileSync(
    join(dir, "Default", "Preferences"),
    JSON.stringify({
      devtools: {
        preferences: {
          currentDockState: '"undocked"',
        },
      },
    }),
  );
  return dir;
}

/**
 * Launch Chromium with React DevTools extension.
 *
 * - launchPersistentContext with a pre-configured profile that sets DevTools
 *   to undocked mode — DevTools opens in a separate window, not docked
 * - --load-extension loads the vendored React DevTools Chrome extension
 * - --auto-open-devtools-for-tabs makes the extension activate its backend
 *   on every tab (same as a developer manually opening DevTools)
 * - waitForEvent("serviceworker") ensures the extension's background script
 *   is running before we navigate
 * - addInitScript(installHook) injects the DevTools hook before any page JS,
 *   winning the race against the extension's content script
 */
async function launch() {
  const profileDir = createProfileDir();
  profileDirPath = profileDir;
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null, // let viewport follow the physical window size
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--auto-open-devtools-for-tabs",
      "--window-size=1440,900",
    ],
  });
  await ctx.waitForEvent("serviceworker");
  await ctx.addInitScript(installHook);
  return ctx;
}
