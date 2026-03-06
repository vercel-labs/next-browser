# @vercel/next-browser

Programmatic access to React DevTools and the Next.js dev server. Everything
you'd click through in a GUI — component trees, props, hooks, PPR shells,
build errors, Suspense boundaries — exposed as shell commands that return
structured text.

Built for agents. An LLM can't read a DevTools panel, but it can run
`next-browser tree`, parse the output, and decide what to inspect next. Each
command is a stateless one-shot against a long-lived browser daemon, so an
agent loop can fire them off without managing browser lifecycle.

## Install

```bash
pnpm add -g @vercel/next-browser
```

Requires Node `>=20`.

## Usage

```bash
next-browser open http://localhost:3000
next-browser tree
next-browser ppr lock
next-browser push /dashboard
next-browser ppr unlock
next-browser close
```

## Commands

```
open <url> [--cookies-json <file>]  launch browser and navigate
close              close browser and daemon

goto <url>         full-page navigation (new document load)
push [path]        client-side navigation (interactive picker if no path)
back               go back in history
reload             reload current page
restart-server     restart the Next.js dev server (clears fs cache)

ppr lock           enter PPR instant-navigation mode
ppr unlock         exit PPR mode and show shell analysis

tree               show React component tree
tree <id>          inspect component (props, hooks, state, source)

screenshot         save full-page screenshot to tmp file
eval <script>      evaluate JS in page context

errors             show build/runtime errors
logs               show recent dev server log output
network [idx]      list network requests, or inspect one
```

## License

MIT
