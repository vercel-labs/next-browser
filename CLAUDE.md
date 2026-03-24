# next-browser

## Gotchas

### Daemon caches the old build

The daemon process keeps running the old `dist/` in memory. After `npm run build`, you must restart the daemon (`next-browser close` then reopen) for changes to take effect. Without this, you'll be testing stale code and wondering why your fix isn't working.

## Philosophy

### Agent-first CLI — expose raw data, not conclusions

This is a CLI for AI agents, not humans. Design every command around this principle: **output rich, structured raw data and let the agent reason about what it means.**

Don't bake heuristics, thresholds, or classifications into the CLI output (e.g. "unnecessary render", "slow component", "warning: too many re-renders"). The agent has the reasoning capability to interpret raw data — selfTime, render counts, DOM mutation flags, change reasons — and draw its own conclusions in context. Pre-classified output limits the agent to our heuristics instead of letting it apply its own judgement.

What the CLI should do:
- **Collect** — gather data the agent can't easily get on its own (fiber internals, performance timing, network details)
- **Structure** — return it as clean, parseable output (JSON for programmatic use, tables for readable summaries)
- **Document** — SKILL.md teaches the agent what the fields mean, not what to conclude from them

What the CLI should NOT do:
- Decide what's "good" or "bad"
- Filter out data it thinks is unimportant
- Reduce rich data into a summary score or rating
- Add warnings, suggestions, or recommendations in the output

The SKILL.md Scenarios section is where we teach agents the general approach and common patterns — but the actual diagnosis and fix is the agent's job.

## Patterns

### Spill long CLI output to a temp file

When a CLI command may produce output that exceeds ~4 000 chars, write it to a temp file and print the path instead of dumping it inline. See `network.ts` `spillIfLong()` and the `browser-logs` handler in `cli.ts` for examples. Use `join(tmpdir(), \`next-browser-…\`)` for the path.

### Test-driven with headless agents

Every new feature must be validated end-to-end with a headless Claude Code agent using the skill file. The pattern:

1. **Create a test app** in `prototypes/` with a realistic scenario that exercises the new capability.
2. **Implement the feature** (browser.ts → daemon.ts → cli.ts).
3. **Update SKILL.md** — both the command docs and a Scenario section that teaches agents when/how to use it.
4. **Run a headless Claude Code session** (`NEXT_BROWSER_HEADLESS=1`) against the test app with a prompt that requires the agent to discover and use the new command via SKILL.md alone.
5. **Iterate on SKILL.md** until the agent succeeds — if it fails, the skill docs are the bug, not the agent.

This is always the workflow for tasks on this repo. Shipping a command without agent validation means it doesn't work.
