# @vercel/next-browser

Programmatic access to React DevTools and the Next.js dev server. Everything
you'd click through in a GUI — component trees, props, hooks, PPR shells,
build errors, Suspense boundaries — exposed as shell commands that return
structured text.

Built for agents. An LLM can't read a DevTools panel, but it can run
`next-browser tree`, parse the output, and decide what to inspect next. Each
command is a stateless one-shot against a long-lived browser daemon, so an
agent loop can fire them off without managing browser lifecycle.

## Getting started

You don't install or run this directly. Your agent does.

1. **Add the skill to your project.** From your Next.js repo:

   ```bash
   npx skills add vercel-labs/next-browser
   ```

   Works with Claude Code, Cursor, Cline, and [others](https://skills.sh).

2. **Start your agent** in that project.

3. **Type `/next-browser`** to invoke the skill.

4. The skill checks for the CLI and **installs `@vercel/next-browser`
   globally** if it's missing (plus `playwright install chromium`).

5. It asks for your dev server URL and any cookies it needs, opens the
   browser, and from there it's **pair programming** — tell it what you're
   debugging and it drives the tree, navigates pages, inspects components,
   and reads errors for you.

That's the whole flow. Run `npx skills upgrade` later to pull updates.

The rest of this README documents the raw CLI for the rare case where you're
scripting it yourself.

---

## Manual install

```bash
pnpm add -g @vercel/next-browser
```

Requires Node `>=20`.

## Commands

```
open <url> [--cookies-json <file>]  launch browser and navigate
close              close browser and daemon

goto <url>         full-page navigation (new document load)
push [path]        client-side navigation (interactive picker if no path)
back               go back in history
reload             reload current page
capture-goto [url] capture loading sequence (PPR shell → hydration → data)
restart-server     restart the Next.js dev server (clears fs cache)

ppr lock           enter PPR instant-navigation mode (requires cacheComponents)
ppr unlock         exit PPR mode and show shell analysis

tree               show React component tree
tree <id>          inspect component (props, hooks, state, source)

viewport [WxH]     show or set viewport size (e.g. 1280x720)
screenshot         save full-page screenshot to tmp file
eval <script>      evaluate JS in page context

errors             show build/runtime errors
logs               show recent dev server log output
network [idx]      list network requests, or inspect one
```

## License

MIT
