# auth-localstorage prototype

Minimal fixture for validating `next-browser open --local-storage <file>`
end-to-end. Reproduces issue #13: a SPA whose data-fetching layer
authenticates with a token in `localStorage`, not a cookie.

## Run

```
node server.mjs
```

Default port is 3457.

## Routes

- `GET /` — SPA shell. Inline JS reads `localStorage.auth_token` and calls
  `/api/scene` with an `Authorization: Bearer <token>` header.
- `GET /api/scene` — requires `Authorization: Bearer dev-token-xyz`.
  Returns the scene JSON with it, 401 without.

## Test localStorage file

`localstorage.json` is the object form — exactly what
`copy(JSON.stringify(localStorage))` produces in DevTools — containing the
expected `auth_token`. The CLI seeds it via `addInitScript` before the first
navigation, so the token is present when the SPA's `fetch` runs.

## Validation run

```
# terminal 1
node server.mjs

# terminal 2 — WITHOUT the token: shows "We couldn't open this scene"
NEXT_BROWSER_HEADLESS=1 next-browser open http://localhost:3457/
next-browser snapshot

# WITH the token: shows "My secret diagram (loaded!)"
NEXT_BROWSER_HEADLESS=1 next-browser open http://localhost:3457/ \
  --local-storage prototypes/auth-localstorage/localstorage.json
next-browser snapshot
```
