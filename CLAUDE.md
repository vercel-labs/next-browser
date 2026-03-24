# next-browser

## Gotchas

### Daemon caches the old build

The daemon process keeps running the old `dist/` in memory. After `npm run build`, you must restart the daemon (`next-browser close` then reopen) for changes to take effect. Without this, you'll be testing stale code and wondering why your fix isn't working.

## Patterns

### Spill long CLI output to a temp file

When a CLI command may produce output that exceeds ~4 000 chars, write it to a temp file and print the path instead of dumping it inline. See `network.ts` `spillIfLong()` and the `browser-logs` handler in `cli.ts` for examples. Use `join(tmpdir(), \`next-browser-…\`)` for the path.
