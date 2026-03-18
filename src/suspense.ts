import type { Page } from "playwright";
import * as sourcemap from "./sourcemap.ts";

/** [functionName, fileName, line, column] */
export type StackFrame = [string, string, number, number];

export type Boundary = {
  id: number;
  parentID: number;
  name: string | null;
  isSuspended: boolean;
  environments: string[];
  suspendedBy: Suspender[];
  unknownSuspenders: string | null;
  owners: Owner[];
  jsxSource: [string, number, number] | null;
};

export type Owner = {
  name: string;
  env: string | null;
  source: [string, number, number] | null;
};

export type Suspender = {
  name: string;
  description: string;
  duration: number;
  env: string | null;
  ownerName: string | null;
  ownerStack: StackFrame[] | null;
  awaiterName: string | null;
  awaiterStack: StackFrame[] | null;
};

export type BoundaryKind =
  | "route-segment"
  | "explicit-suspense"
  | "component";

export type BlockerKind =
  | "client-hook"
  | "request-api"
  | "server-fetch"
  | "stream"
  | "cache"
  | "framework"
  | "unknown";

export type FixKind =
  | "check-loading-fallback"
  | "push-client-hooks-down"
  | "push-request-io-down"
  | "cache-or-runtime-prefetch"
  | "extract-static-shell"
  | "investigate-framework"
  | "investigate-unknown";

export type ActionableBlocker = {
  key: string;
  name: string;
  kind: BlockerKind;
  env: string | null;
  description: string;
  ownerName: string | null;
  awaiterName: string | null;
  sourceFrame: StackFrame | null;
  ownerFrame: StackFrame | null;
  awaiterFrame: StackFrame | null;
  actionability: number;
  suggestion: string;
};

export type BoundaryInsight = {
  id: number;
  name: string | null;
  boundaryKind: BoundaryKind;
  environments: string[];
  source: [string, number, number] | null;
  renderedBy: Owner[];
  fallbackSource: {
    kind: "loading-tsx" | "unknown";
    path: string | null;
    confidence: "high" | "medium" | "low";
  };
  primaryBlocker: ActionableBlocker | null;
  blockers: ActionableBlocker[];
  unknownSuspenders: string | null;
  actionability: number;
  recommendation: string;
  recommendationKind: FixKind;
};

export type RootCauseGroup = {
  key: string;
  kind: BlockerKind;
  name: string;
  sourceFrame: StackFrame | null;
  boundaryIds: number[];
  boundaryNames: string[];
  count: number;
  actionability: number;
  suggestion: string;
};

export type StaticBoundarySummary = {
  id: number;
  name: string | null;
  source: [string, number, number] | null;
  renderedBy: Owner[];
};

export type AnalysisReport = {
  totalBoundaries: number;
  dynamicHoleCount: number;
  staticCount: number;
  holes: BoundaryInsight[];
  statics: StaticBoundarySummary[];
  rootCauses: RootCauseGroup[];
  filesToRead: string[];
};

export async function snapshot(page: Page): Promise<Boundary[]> {
  return page.evaluate(inPageSuspense, true);
}

export async function countBoundaries(page: Page): Promise<{ total: number; suspended: number }> {
  const boundaries = await page.evaluate(inPageSuspense, false).catch(() => [] as Boundary[]);
  const nonRoot = boundaries.filter((b) => b.parentID !== 0);
  return { total: nonRoot.length, suspended: nonRoot.filter((b) => b.isSuspended).length };
}

export async function formatAnalysis(
  unlocked: Boundary[],
  locked: Boundary[],
  origin: string,
): Promise<string> {
  const report = await analyzeBoundaries(unlocked, locked, origin);
  return formatReport(report);
}

export async function analyzeBoundaries(
  unlocked: Boundary[],
  locked: Boundary[],
  origin: string,
): Promise<AnalysisReport> {
  await resolveSources(unlocked, origin);
  await resolveSources(locked, origin);

  const holes: { shell: Boundary; full: Boundary | undefined }[] = [];
  const statics: Boundary[] = [];

  const hasLockedData = locked.some((b) => b.parentID !== 0);

  if (hasLockedData) {
    // DevTools was connected during lock — match locked vs unlocked by key
    const unlockedByKey = new Map<string, Boundary>();
    for (const b of unlocked) unlockedByKey.set(boundaryKey(b), b);
    for (const lb of locked) {
      if (lb.parentID === 0) continue;
      if (lb.isSuspended) {
        holes.push({ shell: lb, full: unlockedByKey.get(boundaryKey(lb)) });
      } else {
        statics.push(lb);
      }
    }
  } else {
    // DevTools wasn't connected during lock (goto case) — derive from unlocked.
    // Boundaries with suspendedBy data were dynamic holes in the shell.
    for (const b of unlocked) {
      if (b.parentID === 0) continue;
      if (b.suspendedBy.length > 0 || b.unknownSuspenders) {
        holes.push({ shell: b, full: b });
      } else {
        statics.push(b);
      }
    }
  }

  const holeInsights = holes
    .map(({ shell, full }) => buildBoundaryInsight(shell, full ?? shell))
    .sort(compareBoundaryInsights);
  const staticSummaries = statics.map((b) => ({
    id: b.id,
    name: b.name,
    source: b.jsxSource,
    renderedBy: b.owners,
  }));
  const rootCauses = buildRootCauseGroups(holeInsights);
  const filesToRead = collectFilesToRead(holeInsights, rootCauses);

  return {
    totalBoundaries: holeInsights.length + staticSummaries.length,
    dynamicHoleCount: holeInsights.length,
    staticCount: staticSummaries.length,
    holes: holeInsights,
    statics: staticSummaries,
    rootCauses,
    filesToRead,
  };
}

export function formatReport(report: AnalysisReport): string {
  const lines = [
    "# PPR Shell Analysis",
    `# ${report.totalBoundaries} boundaries: ${report.dynamicHoleCount} dynamic holes, ${report.staticCount} static`,
    "",
  ];

  if (report.holes.length > 0) {
    lines.push("## Summary");
    const topBoundary = report.holes[0];
    if (topBoundary?.primaryBlocker) {
      lines.push(
        `- Top actionable hole: ${topBoundary.name ?? "(unnamed)"} — ${topBoundary.primaryBlocker.name} ` +
          `(${topBoundary.primaryBlocker.kind})`,
      );
      lines.push(`- Suggested next step: ${topBoundary.recommendation}`);
    }
    const topRootCause = report.rootCauses[0];
    if (topRootCause) {
      lines.push(
        `- Most common root cause: ${topRootCause.name} (${topRootCause.kind}) ` +
          `affecting ${topRootCause.count} boundar${topRootCause.count === 1 ? "y" : "ies"}`,
      );
    }
    lines.push("");

    lines.push("## Quick Reference");
    lines.push("| Boundary | Type | Fallback source | Primary blocker | Source | Suggested next step |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const hole of report.holes) {
      const blocker = hole.primaryBlocker;
      const source = blocker?.sourceFrame
        ? `${blocker.sourceFrame[1]}:${blocker.sourceFrame[2]}`
        : hole.source
          ? `${hole.source[0]}:${hole.source[1]}`
          : "unknown";
      const fallback = hole.fallbackSource.path ?? hole.fallbackSource.kind;
      lines.push(
        `| ${escapeCell(hole.name ?? "(unnamed)")} | ${hole.boundaryKind} | ${escapeCell(fallback)} | ` +
          `${escapeCell(blocker ? `${blocker.name} (${blocker.kind})` : "unknown")} | ` +
          `${escapeCell(source)} | ${escapeCell(hole.recommendation)} |`,
      );
    }
    lines.push("");

    if (report.filesToRead.length > 0) {
      lines.push("## Files to Read");
      for (const file of report.filesToRead) {
        lines.push(`- ${file}`);
      }
      lines.push("");
    }

    if (report.rootCauses.length > 0) {
      lines.push("## Root Causes");
      for (const cause of report.rootCauses) {
        const source = cause.sourceFrame
          ? `${cause.sourceFrame[1]}:${cause.sourceFrame[2]}`
          : "unknown";
        lines.push(
          `- ${cause.name} (${cause.kind}) at ${source} — affects ${cause.count} ` +
            `boundar${cause.count === 1 ? "y" : "ies"}`,
        );
        lines.push(`  next step: ${cause.suggestion}`);
        lines.push(`  boundaries: ${cause.boundaryNames.join(", ")}`);
      }
      lines.push("");
    }

    lines.push("## Dynamic holes (suspended in shell)");
    for (const hole of report.holes) {
      const name = hole.name ?? "(unnamed)";
      const src = hole.source ? `${hole.source[0]}:${hole.source[1]}:${hole.source[2]}` : null;
      lines.push(`  ${name}${src ? ` at ${src}` : ""}`);
      if (hole.renderedBy.length > 0) {
        lines.push(`    rendered by: ${hole.renderedBy.map((o) => {
          const env = o.env ? ` [${o.env}]` : "";
          const src = o.source ? ` at ${o.source[0]}:${o.source[1]}` : "";
          return `${o.name}${env}${src}`;
        }).join(" > ")}`);
      }
      if (hole.environments.length > 0) lines.push(`    environments: ${hole.environments.join(", ")}`);
      if (hole.primaryBlocker) {
        lines.push(
          `    primary blocker: ${hole.primaryBlocker.name} ` +
            `(${hole.primaryBlocker.kind}, actionability ${labelActionability(hole.primaryBlocker.actionability)})`,
        );
        if (hole.fallbackSource.path) {
          lines.push(
            `    fallback source: ${hole.fallbackSource.path} ` +
              `(${hole.fallbackSource.confidence} confidence)`,
          );
        }
        if (hole.primaryBlocker.sourceFrame) {
          lines.push(
            `      source: ${hole.primaryBlocker.sourceFrame[0] || "(anonymous)"} ` +
              `${hole.primaryBlocker.sourceFrame[1]}:${hole.primaryBlocker.sourceFrame[2]}`,
          );
        }
        lines.push(`      next step: ${hole.recommendation}`);
      }
      if (hole.blockers.length > 0) {
        lines.push("    blocked by:");
        for (const blocker of hole.blockers) {
          const dur = hole.primaryBlocker?.name === blocker.name ? " [primary]" : "";
          const env = blocker.env ? ` [${blocker.env}]` : "";
          const owner = blocker.ownerName ? ` initiated by <${blocker.ownerName}>` : "";
          const awaiter = blocker.awaiterName ? ` awaited in <${blocker.awaiterName}>` : "";
          lines.push(`      - ${blocker.name}: ${blocker.description || "(no description)"}${env}${dur}${owner}${awaiter}`);
          if (blocker.ownerFrame) {
            const [fn, file, line] = blocker.ownerFrame;
            lines.push(`          owner: ${fn || "(anonymous)"} ${file}:${line}`);
          }
          if (blocker.awaiterFrame && !blocker.ownerFrame) {
            const [fn, file, line] = blocker.awaiterFrame;
            lines.push(`          awaiter: ${fn || "(anonymous)"} ${file}:${line}`);
          }
          if (blocker.ownerFrame && hole.primaryBlocker?.name === blocker.name) {
            for (const [fn, file, line] of [blocker.ownerFrame].slice(0, 3)) {
              lines.push(`          at ${fn || "(anonymous)"} ${file}:${line}`);
            }
          }
        }
      } else if (hole.unknownSuspenders) {
        lines.push(`    suspenders unknown: ${hole.unknownSuspenders}`);
      }
    }
    lines.push("");
  }

  if (report.statics.length > 0) {
    lines.push("## Static (pre-rendered in shell)");
    for (const b of report.statics) {
      const name = b.name ?? "(unnamed)";
      const src = b.source ? ` at ${b.source[0]}:${b.source[1]}:${b.source[2]}` : "";
      lines.push(`  ${name}${src}`);
    }
  }

  return lines.join("\n");
}

function buildBoundaryInsight(
  shell: Boundary,
  resolved: Boundary,
): BoundaryInsight {
  const boundaryKind = inferBoundaryKind(resolved);
  const blockers = resolved.suspendedBy
    .map((blocker) => buildActionableBlocker(blocker))
    .sort(compareActionableBlockers);
  const primaryBlocker = blockers[0] ?? null;
  const recommendation = recommendBoundaryFix(
    boundaryKind,
    primaryBlocker,
    resolved.unknownSuspenders,
  );

  return {
    id: resolved.id,
    name: resolved.name,
    boundaryKind,
    environments: shell.environments,
    source: resolved.jsxSource,
    renderedBy: resolved.owners,
    fallbackSource: {
      kind: "unknown",
      path: null,
      confidence: boundaryKind === "route-segment" ? "medium" : "low",
    },
    primaryBlocker,
    blockers,
    unknownSuspenders: resolved.unknownSuspenders,
    actionability: Math.max(primaryBlocker?.actionability ?? 0, boundaryKind === "route-segment" ? 55 : 0),
    recommendation: recommendation.text,
    recommendationKind: recommendation.kind,
  };
}

function buildActionableBlocker(suspender: Suspender): ActionableBlocker {
  const ownerFrame = pickPreferredFrame(suspender.ownerStack);
  const awaiterFrame = pickPreferredFrame(suspender.awaiterStack);
  const sourceFrame = ownerFrame ?? awaiterFrame;
  const kind = classifyBlocker(suspender, sourceFrame);
  const suggestion = suggestBlockerFix(kind);
  let actionability = blockerActionability(kind);
  if (sourceFrame && !isFrameworkishPath(sourceFrame[1])) actionability += 8;
  if (suspender.ownerName || suspender.awaiterName) actionability += 4;
  actionability = Math.min(actionability, 100);

  return {
    key: buildBlockerKey(suspender.name, kind, sourceFrame),
    name: suspender.name,
    kind,
    env: suspender.env,
    description: suspender.description,
    ownerName: suspender.ownerName,
    awaiterName: suspender.awaiterName,
    sourceFrame,
    ownerFrame,
    awaiterFrame,
    actionability,
    suggestion,
  };
}

function buildRootCauseGroups(holes: BoundaryInsight[]): RootCauseGroup[] {
  const groups = new Map<string, RootCauseGroup>();

  for (const hole of holes) {
    const blocker = hole.primaryBlocker;
    if (!blocker) continue;

    const existing = groups.get(blocker.key);
    if (existing) {
      existing.boundaryIds.push(hole.id);
      existing.boundaryNames.push(hole.name ?? `boundary-${hole.id}`);
      existing.count++;
      existing.actionability = Math.max(existing.actionability, blocker.actionability);
      continue;
    }

    groups.set(blocker.key, {
      key: blocker.key,
      kind: blocker.kind,
      name: blocker.name,
      sourceFrame: blocker.sourceFrame,
      boundaryIds: [hole.id],
      boundaryNames: [hole.name ?? `boundary-${hole.id}`],
      count: 1,
      actionability: blocker.actionability,
      suggestion: blocker.suggestion,
    });
  }

  return [...groups.values()].sort((a, b) => {
    const scoreA = a.count * a.actionability;
    const scoreB = b.count * b.actionability;
    return scoreB - scoreA || a.name.localeCompare(b.name);
  });
}

function collectFilesToRead(
  holes: BoundaryInsight[],
  rootCauses: RootCauseGroup[],
): string[] {
  const counts = new Map<string, number>();

  const add = (file: string | null | undefined) => {
    if (!file) return;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  };

  for (const hole of holes) {
    add(hole.source?.[0]);
    add(hole.primaryBlocker?.sourceFrame?.[1]);
    for (const owner of hole.renderedBy) add(owner.source?.[0]);
  }

  for (const cause of rootCauses) add(cause.sourceFrame?.[1]);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([file]) => file)
    .slice(0, 12);
}

function compareBoundaryInsights(a: BoundaryInsight, b: BoundaryInsight): number {
  return (
    b.actionability - a.actionability ||
    boundaryKindWeight(b.boundaryKind) - boundaryKindWeight(a.boundaryKind) ||
    (b.blockers.length - a.blockers.length) ||
    (a.name ?? "").localeCompare(b.name ?? "")
  );
}

function compareActionableBlockers(a: ActionableBlocker, b: ActionableBlocker): number {
  return (
    b.actionability - a.actionability ||
    blockerKindWeight(b.kind) - blockerKindWeight(a.kind) ||
    a.name.localeCompare(b.name)
  );
}

function boundaryKindWeight(kind: BoundaryKind): number {
  if (kind === "route-segment") return 3;
  if (kind === "explicit-suspense") return 2;
  return 1;
}

function blockerKindWeight(kind: BlockerKind): number {
  switch (kind) {
    case "client-hook": return 7;
    case "request-api": return 6;
    case "server-fetch": return 5;
    case "cache": return 4;
    case "stream": return 3;
    case "unknown": return 2;
    case "framework": return 1;
  }
}

function blockerActionability(kind: BlockerKind): number {
  switch (kind) {
    case "client-hook": return 90;
    case "request-api": return 88;
    case "server-fetch": return 82;
    case "cache": return 74;
    case "stream": return 60;
    case "unknown": return 35;
    case "framework": return 18;
  }
}

function inferBoundaryKind(boundary: Boundary): BoundaryKind {
  const ownerNames = boundary.owners.map((owner) => owner.name);
  if (
    (boundary.name && boundary.name.endsWith("/")) ||
    ownerNames.includes("LoadingBoundary") ||
    ownerNames.includes("OuterLayoutRouter")
  ) {
    return "route-segment";
  }
  if (
    boundary.name?.includes("Suspense") ||
    ownerNames.some((name) => name.includes("Suspense"))
  ) {
    return "explicit-suspense";
  }
  return "component";
}

function classifyBlocker(
  suspender: Suspender,
  sourceFrame: StackFrame | null,
): BlockerKind {
  const name = suspender.name.toLowerCase();
  if (
    name === "usepathname" ||
    name === "useparams" ||
    name === "usesearchparams" ||
    name === "useselectedlayoutsegments" ||
    name === "useselectedlayoutsegment" ||
    name === "userouter"
  ) {
    return "client-hook";
  }
  if (
    name === "cookies" ||
    name === "headers" ||
    name === "connection" ||
    name === "params" ||
    name === "searchparams" ||
    name === "draftmode"
  ) {
    return "request-api";
  }
  if (name === "rsc stream") return "stream";
  if (name.includes("fetch")) return "server-fetch";
  if (name.includes("cache") || suspender.description.toLowerCase().includes("cache")) {
    return "cache";
  }
  if (name.startsWith("use")) return "client-hook";
  if (sourceFrame && isFrameworkishPath(sourceFrame[1])) return "framework";
  return "unknown";
}

function suggestBlockerFix(kind: BlockerKind): string {
  switch (kind) {
    case "client-hook":
      return "Move route hooks behind a smaller client Suspense or provide a real non-null loading fallback for this segment.";
    case "request-api":
      return "Push request-bound reads to a smaller server leaf, or cache around them so the parent shell can stay static.";
    case "server-fetch":
      return "Split static shell content from data widgets, then push the fetch into smaller Suspense leaves or cache it.";
    case "cache":
      return "This looks cache-related; check whether \"use cache\" or runtime prefetch can eliminate the suspension.";
    case "stream":
      return "A stream is still pending here; extract static siblings outside the boundary and push the stream consumer deeper.";
    case "framework":
      return "This currently looks framework-driven; find the nearest user-owned caller above it before changing code.";
    case "unknown":
      return "Inspect the nearest user-owned owner/awaiter frame and verify whether this suspender really belongs at this boundary.";
  }
}

function recommendBoundaryFix(
  boundaryKind: BoundaryKind,
  primaryBlocker: ActionableBlocker | null,
  unknownSuspenders: string | null,
): { kind: FixKind; text: string } {
  if (boundaryKind === "route-segment" && primaryBlocker?.kind === "client-hook") {
    return {
      kind: "check-loading-fallback",
      text: "This route segment is suspending on client hooks. Check loading.tsx first; if it is null or visually empty, fix the fallback before chasing deeper push-down work.",
    };
  }
  if (primaryBlocker?.kind === "client-hook") {
    return {
      kind: "push-client-hooks-down",
      text: "Push the hook-using client UI behind a smaller local Suspense boundary so the parent shell can prerender.",
    };
  }
  if (primaryBlocker?.kind === "request-api" || primaryBlocker?.kind === "server-fetch") {
    return {
      kind: "push-request-io-down",
      text: "Push the request-bound async work into a smaller leaf or split static siblings out of this boundary.",
    };
  }
  if (primaryBlocker?.kind === "cache") {
    return {
      kind: "cache-or-runtime-prefetch",
      text: "Check whether caching or runtime prefetch can move this personalized content into the shell.",
    };
  }
  if (primaryBlocker?.kind === "stream") {
    return {
      kind: "extract-static-shell",
      text: "Keep the stream behind Suspense, but extract any static shell content outside the boundary.",
    };
  }
  if (primaryBlocker?.kind === "framework") {
    return {
      kind: "investigate-framework",
      text: "The top blocker still looks framework-heavy. Find the nearest user-owned caller before changing boundary placement.",
    };
  }
  if (unknownSuspenders) {
    return {
      kind: "investigate-unknown",
      text: `React could not identify the suspender (${unknownSuspenders}). Investigate the nearest user-owned owner or awaiter frame.`,
    };
  }
  return {
    kind: "investigate-unknown",
    text: "No primary blocker was identified. Inspect the boundary source and owner chain directly.",
  };
}

function pickPreferredFrame(stack: StackFrame[] | null): StackFrame | null {
  if (!stack || stack.length === 0) return null;
  return stack.find((frame) => !isFrameworkishPath(frame[1])) ?? stack[0];
}

function isFrameworkishPath(file: string): boolean {
  return file.includes("/node_modules/");
}

function buildBlockerKey(
  name: string,
  kind: BlockerKind,
  sourceFrame: StackFrame | null,
): string {
  if (!sourceFrame) return `${kind}:${name}:unknown`;
  return `${kind}:${name}:${sourceFrame[1]}:${sourceFrame[2]}`;
}

function labelActionability(value: number): string {
  if (value >= 80) return "high";
  if (value >= 50) return "medium";
  return "low";
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|");
}

export function annotateReportWithPageMetadata(
  report: AnalysisReport,
  pageMetadata: unknown,
): void {
  const sessions = Array.isArray((pageMetadata as { sessions?: unknown[] })?.sessions)
    ? ((pageMetadata as { sessions: { segments?: { path?: string; type?: string }[] }[] }).sessions)
    : [];
  const loadingPaths = sessions.flatMap((session) =>
    (session.segments ?? [])
      .filter((segment) => segment.type === "boundary:loading" && typeof segment.path === "string")
      .map((segment) => segment.path as string),
  );

  for (const hole of report.holes) {
    if (hole.boundaryKind !== "route-segment") continue;
    const segmentName = normalizeBoundarySegmentName(hole.name);
    if (!segmentName) continue;

    const exact = loadingPaths.find((path) => path.split("/").at(-2) === segmentName);
    if (exact) {
      hole.fallbackSource = {
        kind: "loading-tsx",
        path: exact,
        confidence: "high",
      };
    }
  }
}

function normalizeBoundarySegmentName(name: string | null): string | null {
  if (!name) return null;
  return name.endsWith("/") ? name.slice(0, -1) : name;
}

function boundaryKey(b: Boundary): string {
  if (b.jsxSource) return `${b.jsxSource[0]}:${b.jsxSource[1]}:${b.jsxSource[2]}`;
  return b.name ?? `id-${b.id}`;
}

async function resolveSources(boundaries: Boundary[], origin: string) {
  for (const b of boundaries) {
    if (b.jsxSource) {
      b.jsxSource = await resolveOne(b.jsxSource, origin);
    }
    for (const o of b.owners) {
      if (o.source) {
        o.source = await resolveOne(o.source, origin);
      }
    }
    for (const s of b.suspendedBy) {
      if (s.ownerStack) s.ownerStack = await resolveStack(s.ownerStack, origin);
      if (s.awaiterStack) s.awaiterStack = await resolveStack(s.awaiterStack, origin);
    }
  }
}

async function resolveOne(
  src: [string, number, number],
  origin: string,
): Promise<[string, number, number]> {
  const [file, line, col] = src;
  const resolved =
    (await sourcemap.resolve(origin, file, line, col)) ??
    (await sourcemap.resolveViaMap(origin, file, line, col));
  return resolved ? [resolved.file, resolved.line, resolved.column] : src;
}

async function resolveStack(
  stack: StackFrame[],
  origin: string,
): Promise<StackFrame[]> {
  const out: StackFrame[] = [];
  for (const [name, file, line, col] of stack) {
    const resolved =
      (await sourcemap.resolve(origin, file, line, col)) ??
      (await sourcemap.resolveViaMap(origin, file, line, col));
    if (resolved) {
      out.push([name, resolved.file, resolved.line, resolved.column]);
    } else {
      out.push([name, file, line, col]);
    }
  }
  return out;
}

async function inPageSuspense(inspect: boolean): Promise<Boundary[]> {
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) throw new Error("React DevTools hook not installed");
  const ri = hook.rendererInterfaces?.get?.(1);
  if (!ri) throw new Error("no React renderer attached");

  const batches = await collect(ri);

  const boundaryMap = new Map<
    number,
    {
      id: number;
      parentID: number;
      name: string | null;
      isSuspended: boolean;
      environments: string[];
    }
  >();

  for (const ops of batches) decodeSuspenseOps(ops, boundaryMap);

  const results: Boundary[] = [];

  for (const b of boundaryMap.values()) {
    if (b.parentID === 0) continue;

    const boundary: Boundary = {
      id: b.id,
      parentID: b.parentID,
      name: b.name,
      isSuspended: b.isSuspended,
      environments: b.environments,
      suspendedBy: [],
      unknownSuspenders: null,
      owners: [],
      jsxSource: null,
    };

    if (inspect && ri.hasElementWithId(b.id)) {
      const displayName = ri.getDisplayNameForElementID(b.id);
      if (displayName) boundary.name = displayName;
      const result = ri.inspectElement(1, b.id, null, true);
      if (result?.type === "full-data") {
        parseInspection(boundary, result.value);
      }
    }

    results.push(boundary);
  }

  return results;

  function collect(renderer: { flushInitialOperations: () => void }) {
    return new Promise<number[][]>((resolve) => {
      const out: number[][] = [];
      // Operations are emitted via hook.emit("operations", payload),
      // NOT via window.postMessage.
      const origEmit = hook.emit;
      hook.emit = function (event: string, payload: number[]) {
        if (event === "operations") out.push(payload);
        return origEmit.apply(this, arguments as any);
      };
      renderer.flushInitialOperations();
      setTimeout(() => {
        hook.emit = origEmit;
        resolve(out);
      }, 50);
    });
  }

  function decodeSuspenseOps(
    ops: number[],
    map: Map<number, { id: number; parentID: number; name: string | null; isSuspended: boolean; environments: string[] }>,
  ) {
    let i = 2;

    const strings: (string | null)[] = [null];
    const tableEnd = ++i + ops[i - 1];
    while (i < tableEnd) {
      const len = ops[i++];
      strings.push(String.fromCodePoint(...ops.slice(i, i + len)));
      i += len;
    }

    while (i < ops.length) {
      const op = ops[i];

      if (op === 1) {
        const type = ops[i + 2];
        i += 3 + (type === 11 ? 4 : 5);
      } else if (op === 2) {
        i += 2 + ops[i + 1];
      } else if (op === 3) {
        i += 3 + ops[i + 2];
      } else if (op === 4) {
        i += 3;
      } else if (op === 5) {
        i += 4;
      } else if (op === 6) {
        i++;
      } else if (op === 7) {
        i += 3;
      } else if (op === 8) {
        const id = ops[i + 1];
        const parentID = ops[i + 2];
        const nameStrID = ops[i + 3];
        const isSuspended = ops[i + 4] === 1;
        const numRects = ops[i + 5];
        i += 6;
        if (numRects !== -1) i += numRects * 4;

        map.set(id, {
          id,
          parentID,
          name: strings[nameStrID] ?? null,
          isSuspended,
          environments: [],
        });
      } else if (op === 9) {
        i += 2 + ops[i + 1];
      } else if (op === 10) {
        i += 3 + ops[i + 2];
      } else if (op === 11) {
        const numRects = ops[i + 2];
        i += 3;
        if (numRects !== -1) i += numRects * 4;
      } else if (op === 12) {
        i++;
        const changeLen = ops[i++];
        for (let c = 0; c < changeLen; c++) {
          const id = ops[i++];
          i++; // hasUniqueSuspenders
          i++; // endTime
          const isSuspended = ops[i++] === 1;
          const envLen = ops[i++];
          const envs: string[] = [];
          for (let e = 0; e < envLen; e++) {
            const name = strings[ops[i++]];
            if (name != null) envs.push(name);
          }

          const node = map.get(id);
          if (node) {
            node.isSuspended = isSuspended;
            for (const env of envs) {
              if (!node.environments.includes(env)) node.environments.push(env);
            }
          }
        }
      } else if (op === 13) {
        i += 2;
      } else {
        i++;
      }
    }
  }

  function parseInspection(boundary: Boundary, data: any) {
    const rawSuspendedBy = data.suspendedBy;
    const rawSuspenders = Array.isArray(rawSuspendedBy)
      ? rawSuspendedBy
      : Array.isArray(rawSuspendedBy?.data)
        ? rawSuspendedBy.data
        : null;

    if (rawSuspenders) {
      for (const entry of rawSuspenders) {
        const awaited = entry?.awaited;
        if (!awaited) continue;
        const desc = preview(awaited.description) || preview(awaited.value);
        boundary.suspendedBy.push({
          name: awaited.name ?? "unknown",
          description: desc,
          duration: awaited.end && awaited.start ? Math.round(awaited.end - awaited.start) : 0,
          env: awaited.env ?? entry?.env ?? null,
          ownerName: awaited.owner?.displayName ?? null,
          ownerStack: parseStack(awaited.owner?.stack ?? awaited.stack),
          awaiterName: entry?.owner?.displayName ?? null,
          awaiterStack: parseStack(entry?.owner?.stack ?? entry?.stack),
        });
      }
    }

    if (data.unknownSuspenders && data.unknownSuspenders !== 0) {
      const reasons: Record<number, string> = {
        1: "production build (no debug info)",
        2: "old React version (missing tracking)",
        3: "thrown Promise (library using throw instead of use())",
      };
      boundary.unknownSuspenders = reasons[data.unknownSuspenders] ?? "unknown reason";
    }

    if (Array.isArray(data.owners)) {
      for (const o of data.owners) {
        if (o?.displayName) {
          const src = Array.isArray(o.stack) && o.stack.length > 0 && Array.isArray(o.stack[0])
            ? [o.stack[0][1] || "(unknown)", o.stack[0][2], o.stack[0][3]] as [string, number, number]
            : null;
          boundary.owners.push({
            name: o.displayName,
            env: o.env ?? null,
            source: src,
          });
        }
      }
    }

    if (Array.isArray(data.stack) && data.stack.length > 0) {
      const frame = data.stack[0];
      if (Array.isArray(frame) && frame.length >= 4) {
        boundary.jsxSource = [frame[1] || "(unknown)", frame[2], frame[3]];
      }
    }
  }

  function parseStack(raw: any): StackFrame[] | null {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return raw
      .filter((f: any) => Array.isArray(f) && f.length >= 4)
      .map((f: any) => [f[0] ?? "", f[1] ?? "", f[2] ?? 0, f[3] ?? 0] as StackFrame);
  }

  function preview(v: any): string {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v !== "object") return String(v);
    if (typeof v.preview_long === "string") return v.preview_long;
    if (typeof v.preview_short === "string") return v.preview_short;
    if (typeof v.value === "string") return v.value;
    try {
      const s = JSON.stringify(v);
      return s.length > 80 ? s.slice(0, 77) + "..." : s;
    } catch {
      return "";
    }
  }
}
