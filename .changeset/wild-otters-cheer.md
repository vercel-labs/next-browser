---
"@vercel/next-browser": minor
---

Add `open --local-storage <file>` to seed `localStorage` before the first navigation, for SPAs that authenticate their data layer with a token in `localStorage` rather than a cookie. Accepts `{"key":"value", …}` (what `JSON.stringify(localStorage)` produces) or `[{"name","value"}, …]`, is origin-guarded, re-seeds on every navigation, and combines with `--cookies`. Adds a SKILL.md scenario for diagnosing cookie-vs-token SPA auth.
