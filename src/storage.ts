export type StorageEntry = { name: string; value: string };

/**
 * Parse localStorage input in one of two JSON formats, auto-detected from
 * the first non-whitespace character:
 *
 *   1. Object — `{"key": "value", ...}`. This is exactly what
 *      `JSON.stringify(localStorage)` produces, so the easiest way for a
 *      user to capture their tokens is to run `copy(JSON.stringify(localStorage))`
 *      in the page's DevTools console and paste the result into a file.
 *   2. Array — `[{"name": "x", "value": "y"}, ...]` (also accepts `key`
 *      instead of `name`), mirroring the Playwright-style cookies format.
 *
 * localStorage values are always strings, so non-string values are rejected.
 *
 * Like the cookie parser, this never echoes a secret value back in an error
 * message — error text mentions the key or index, not the contents.
 */
export function parseLocalStorage(raw: string): StorageEntry[] {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("local-storage file is empty");

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error(
      'local-storage file must be JSON — either {"key":"value", …} (run copy(JSON.stringify(localStorage)) in the console) or [{"name":"…","value":"…"}, …]',
    );
  }

  if (Array.isArray(data)) {
    return data.map((e, i) => {
      const entry = e as { name?: unknown; key?: unknown; value?: unknown } | null;
      const name = entry && (typeof entry.name === "string" ? entry.name : entry.key);
      const value = entry?.value;
      if (typeof name !== "string" || typeof value !== "string") {
        throw new Error(`local-storage[${i}] must have a string name (or key) and value`);
      }
      return { name, value };
    });
  }

  if (data && typeof data === "object") {
    const entries: StorageEntry[] = [];
    for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value !== "string") {
        throw new Error(`local-storage["${name}"] value must be a string`);
      }
      entries.push({ name, value });
    }
    if (entries.length === 0) throw new Error("no localStorage entries found in input");
    return entries;
  }

  throw new Error("local-storage JSON must be an object or array");
}
