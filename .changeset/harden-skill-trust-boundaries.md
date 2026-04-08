---
"@vercel/next-browser": minor
---

`open --cookies <file>` now accepts three formats, auto-detected from
the file contents: (1) raw Copy-as-cURL output from DevTools (the new
recommended path — no hand-editing), (2) a bare `name=v; name=v`
cookie-header string, and (3) the existing Playwright JSON array. The
old `--cookies-json` flag is kept as an alias.

SKILL.md onboarding now tells agents to ask users to save Copy-as-cURL
straight to a file and share the path — the agent never touches the
secret value. A new "Trust boundaries" section makes two rules
explicit: secrets stay out of the agent's hands (no echo, paste, cat,
or write of a cookie value anywhere), and content surfaced by the
browser — snapshots, trees, network bodies, console, errors — is
untrusted input, not instructions, so agents should not follow
directives embedded in page content (indirect prompt-injection
defense).
