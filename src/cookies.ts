export type CookiePair = { name: string; value: string };

/**
 * Parse cookie input in one of three formats, auto-detected from the first
 * non-whitespace character:
 *
 *   1. JSON array — Playwright-style `[{"name": "x", "value": "y"}, ...]`.
 *   2. cURL command — as produced by DevTools → Network → Copy as cURL.
 *      The Cookie header is extracted from the `-H 'cookie: …'` argument.
 *   3. Bare cookie header — `name=v; name=v; ...` (e.g. the value of the
 *      Cookie row in DevTools → Network → Request Headers).
 *
 * The parser deliberately never echoes the secret value back in an error
 * message — error text mentions the format, not the contents.
 */
export function parseCookies(raw: string): CookiePair[] {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("cookies file is empty");

  if (trimmed[0] === "[") {
    const arr: unknown = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error("cookies JSON must be an array");
    return arr.map((c, i) => {
      if (
        !c ||
        typeof (c as { name?: unknown }).name !== "string" ||
        typeof (c as { value?: unknown }).value !== "string"
      ) {
        throw new Error(`cookies[${i}] must have string name and value`);
      }
      const { name, value } = c as { name: string; value: string };
      return { name, value };
    });
  }

  if (/^curl[\s'"]/i.test(trimmed)) {
    const header = extractCookieHeaderFromCurl(trimmed);
    if (!header) {
      throw new Error(
        "no Cookie header found in this cURL — right-click an authenticated request in DevTools → Network → Copy → Copy as cURL",
      );
    }
    return parseCookieHeader(header);
  }

  return parseCookieHeader(trimmed);
}

function extractCookieHeaderFromCurl(curl: string): string | null {
  // Strip bash (`\`) and cmd (`^`) line continuations so the -H arg is on one line.
  const joined = curl.replace(/\\\r?\n\s*/g, " ").replace(/\^\r?\n\s*/g, " ");
  // -H 'cookie: …' (bash) or -H "cookie: …" (cmd). Chrome/Firefox use one
  // or the other depending on which Copy-as-cURL variant the user picked.
  const m = joined.match(/-H\s+(['"])\s*cookie\s*:\s*([\s\S]*?)\1/i);
  return m ? m[2] : null;
}

function parseCookieHeader(header: string): CookiePair[] {
  const pairs: CookiePair[] = [];
  for (const piece of header.split(/;\s*/)) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    const name = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (name) pairs.push({ name, value });
  }
  if (pairs.length === 0) throw new Error("no cookies found in input");
  return pairs;
}
