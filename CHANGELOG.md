# @vercel/next-browser

## 0.6.0

### Minor Changes

- [#32](https://github.com/vercel-labs/next-browser/pull/32) [`4f0b315`](https://github.com/vercel-labs/next-browser/commit/4f0b3155dd0e8e0125175babd98d1bb1577f2d28) Thanks [@gaojude](https://github.com/gaojude)! - Add `instrumentation set/clear` commands for injecting scripts before page scripts

### Patch Changes

- [#30](https://github.com/vercel-labs/next-browser/pull/30) [`ef8e5cc`](https://github.com/vercel-labs/next-browser/commit/ef8e5cc9272b467145856961b5abe1c34e998202) Thanks [@gaojude](https://github.com/gaojude)! - Teach agents to diagnose PPR error overlay in locked screenshots

## 0.5.1

### Patch Changes

- [#28](https://github.com/vercel-labs/next-browser/pull/28) [`64f73bd`](https://github.com/vercel-labs/next-browser/commit/64f73bdcbf8de3e3e855d7e4be8f402ffcbea340) Thanks [@gaojude](https://github.com/gaojude)! - Cap screenshot dimensions to 1280px to stay under multi-image LLM request limits

## 0.5.0

### Minor Changes

- [#26](https://github.com/vercel-labs/next-browser/pull/26) [`81c5fbf`](https://github.com/vercel-labs/next-browser/commit/81c5fbff05250a12b8ae74be1c4cbd62873cf9fc) Thanks [@gaojude](https://github.com/gaojude)! - `open --cookies <file>` now accepts three formats, auto-detected from
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

## 0.4.1

### Patch Changes

- [#24](https://github.com/vercel-labs/next-browser/pull/24) [`cf75416`](https://github.com/vercel-labs/next-browser/commit/cf75416840628330c7a7dc6f6cd43ff701d3394a) Thanks [@gaojude](https://github.com/gaojude)! - Move `SKILL.md` into `skills/next-browser/` so `npx skills add vercel-labs/next-browser` pulls only the skill markdown instead of the entire repo (dist, extensions, src, lockfile, etc.)

## 0.4.0

### Minor Changes

- [#16](https://github.com/vercel-labs/next-browser/pull/16) [`0d1c5f2`](https://github.com/vercel-labs/next-browser/commit/0d1c5f2d009f8ad8b31b68fcd38e5f77b698587c) Thanks [@gaojude](https://github.com/gaojude)! - Add `browser-logs` command to capture browser console output

- [#18](https://github.com/vercel-labs/next-browser/pull/18) [`08d49f5`](https://github.com/vercel-labs/next-browser/commit/08d49f5606482cc9b88a6428db58d737265cdc15) Thanks [@gaojude](https://github.com/gaojude)! - Add `renders start` and `renders stop` commands for React re-render profiling

- [#21](https://github.com/vercel-labs/next-browser/pull/21) [`a5e0759`](https://github.com/vercel-labs/next-browser/commit/a5e0759a5bd4a2d02e968c3249c8420fe34b77f8) Thanks [@gaojude](https://github.com/gaojude)! - Distinguish mounts from re-renders in `renders stop` output with `Insts`, `Mounts`, and `Re-renders` columns

### Patch Changes

- [#19](https://github.com/vercel-labs/next-browser/pull/19) [`18eb8e8`](https://github.com/vercel-labs/next-browser/commit/18eb8e8220b2ff507ccb9fcc0e2164e068dd9fcb) Thanks [@gaojude](https://github.com/gaojude)! - Remove `prototypes/` directory

- [#20](https://github.com/vercel-labs/next-browser/pull/20) [`979339e`](https://github.com/vercel-labs/next-browser/commit/979339ef6f3bdfa5b7c806a8b2d264f75e57dfba) Thanks [@gaojude](https://github.com/gaojude)! - Fold `preview` into `screenshot` — every screenshot now automatically opens a Screenshot Log window in headed mode

## 0.3.0

### Minor Changes

- [#12](https://github.com/vercel-labs/next-browser/pull/12) [`c3afe66`](https://github.com/vercel-labs/next-browser/commit/c3afe66b840def548ca2b1113b955bb54942b404) Thanks [@gaojude](https://github.com/gaojude)! - Add `preview` command for visual feedback and `--full-page` flag for `screenshot`

- [#10](https://github.com/vercel-labs/next-browser/pull/10) [`3e2704b`](https://github.com/vercel-labs/next-browser/commit/3e2704b6ed631a3013f6692072afd8a75e466a05) Thanks [@gaojude](https://github.com/gaojude)! - Replace `ssr-goto` with `ssr lock` / `ssr unlock` for persistent SSR inspection across navigations. Auto-open browser on `goto` when not already open. Make lock commands idempotent.

## 0.2.0

### Minor Changes

- [#4](https://github.com/vercel-labs/next-browser/pull/4) [`0f0aa67`](https://github.com/vercel-labs/next-browser/commit/0f0aa670c2a40e7927ca1dba2f9550d56bb89f81) Thanks [@gaojude](https://github.com/gaojude)! - Add `perf` command that profiles a full page load — collects Core Web Vitals (TTFB, LCP, CLS) and React hydration timing in one pass. Also exposes `hydration` as a standalone command for React-only timing. Restructure PPR analysis output to use a Quick Reference table.

- [#6](https://github.com/vercel-labs/next-browser/pull/6) [`b53f406`](https://github.com/vercel-labs/next-browser/commit/b53f406a66e1142e5e1b0b24233beb14a609ec53) Thanks [@gaojude](https://github.com/gaojude)! - Add `--file` and stdin (`-`) modes to `eval` command to avoid shell quoting failures

- [#8](https://github.com/vercel-labs/next-browser/pull/8) [`9b3dd4c`](https://github.com/vercel-labs/next-browser/commit/9b3dd4ce618e4786d8ff4bba4f4e8a08fff8d153) Thanks [@gaojude](https://github.com/gaojude)! - Add `snapshot`, `click`, and `fill` commands for page interaction via accessibility tree refs

### Patch Changes

- [#7](https://github.com/vercel-labs/next-browser/pull/7) [`4162ca1`](https://github.com/vercel-labs/next-browser/commit/4162ca172776669e9c3e883d1479d21bb5b2ad4a) Thanks [@gaojude](https://github.com/gaojude)! - Use named pipes on Windows instead of Unix domain sockets to fix daemon startup failure
