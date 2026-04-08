# auth-cookies prototype

Minimal fixture for validating `next-browser open --cookies <file>`
end-to-end with a headless Claude Code agent.

## Run

```
node server.mjs
```

Default port is 3456.

## Routes

- `GET /` — public landing page.
- `GET /private` — requires `session=dev-user-42` cookie. Returns 401
  without it.

## Test cookie file

`cookies.curl` is a hand-crafted "Copy as cURL" output from Chrome
DevTools, containing the expected session cookie. It exercises the
CLI's cURL-parsing path: `next-browser` should strip line
continuations, find the `-H 'cookie: …'` argument, and extract the
three cookies (`session`, `theme`, `csrf`).

## Validation run

```
# terminal 1
node server.mjs

# terminal 2
NEXT_BROWSER_HEADLESS=1 next-browser open http://localhost:3456/private \
  --cookies prototypes/auth-cookies/cookies.curl
next-browser snapshot    # should show "Welcome to the private area"
```
