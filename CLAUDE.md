# next-browser

## Gotchas

### Daemon caches the old build

The daemon process keeps running the old `dist/` in memory. After `npm run build`, you must restart the daemon (`next-browser close` then reopen) for changes to take effect. Without this, you'll be testing stale code and wondering why your fix isn't working.
