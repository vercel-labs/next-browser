/**
 * Resolve a bundle location to its original source file via Next.js's
 * dev-server endpoint. Returns null if it didn't resolve (Next internals,
 * prod build, non-Next app).
 */
export async function resolve(
  origin: string,
  file: string,
  line: number,
  column: number,
): Promise<{ file: string; line: number; column: number } | null> {
  const { path, isServer } = normalize(file, origin);

  const res = await fetch(`${origin}/__nextjs_original-stack-frames`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      frames: [{ file: path, methodName: "", arguments: [], line1: line, column1: column }],
      isServer,
      isEdgeServer: false,
      isAppDirectory: true,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);

  if (!res?.ok) return null;

  const [result] = await res.json();
  const frame = result?.status === "fulfilled" ? result.value.originalStackFrame : null;
  if (!frame || frame.file === path) return null;

  return { file: frame.file, line: frame.line1, column: frame.column1 };
}

import { resolve as resolvePath } from "node:path";
import * as mcp from "./mcp.ts";

const projectRoots = new Map<string, string | null>();

async function projectRoot(origin: string) {
  if (projectRoots.has(origin)) return projectRoots.get(origin)!;
  const meta = await mcp.call(origin, "get_project_metadata").catch(() => null) as any;
  const root = typeof meta?.projectPath === "string" ? meta.projectPath : null;
  projectRoots.set(origin, root);
  return root;
}

async function absolutize(origin: string, path: string) {
  if (path.startsWith("/") || path.startsWith("node_modules/")) return path;
  const root = await projectRoot(origin);
  return root ? resolvePath(root, path) : path;
}

function normalize(file: string, origin: string): { path: string; isServer: boolean } {
  const stripped = file.replace(/^about:\/\/React\/[^/]+\//, "");
  const isServer = file !== stripped;

  if (stripped.startsWith("file://")) return { path: stripped, isServer };
  if (stripped.startsWith(origin)) return { path: stripped.slice(origin.length), isServer };
  if (stripped.startsWith("http")) return { path: new URL(stripped).pathname, isServer };
  return { path: stripped, isServer };
}

import { SourceMapConsumer } from "source-map-js";

const consumers = new Map<string, SourceMapConsumer | null>();

/**
 * Fallback for locations the Next API won't resolve (node_modules).
 * Fetches the .map directly and decodes the mappings.
 */
export async function resolveViaMap(
  origin: string,
  file: string,
  line: number,
  column: number,
): Promise<{ file: string; line: number; column: number } | null> {
  const consumer = await load(origin, normalize(file, origin).path);
  if (!consumer) return null;

  const pos = consumer.originalPositionFor({ line, column });
  if (!pos.source) return null;

  return { file: await absolutize(origin, cleanPath(pos.source)), line: pos.line, column: pos.column };
}

async function load(origin: string, path: string) {
  if (consumers.has(path)) return consumers.get(path)!;

  const res = await fetch(`${origin}${path}.map`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);

  const consumer = res?.ok ? new SourceMapConsumer(await res.json()) : null;
  consumers.set(path, consumer);
  return consumer;
}

function cleanPath(src: string): string {
  const path = decodeURIComponent(src.replace(/^file:\/\//, ""));
  const nm = path.lastIndexOf("/node_modules/");
  return nm >= 0 ? path.slice(nm + 1) : path;
}
