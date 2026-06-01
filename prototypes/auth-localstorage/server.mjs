// Minimal SPA-with-localStorage-token fixture for next-browser
// --local-storage validation. Reproduces the Excalidraw+ scenario from
// issue #13: the document loads (HTTP 200) but the app's data-fetching
// layer authenticates with a token in localStorage, NOT a cookie — so
// --cookies alone can't unlock the content.
//
// Run:  node server.mjs            (default port 3457)
//       PORT=4000 node server.mjs
//
// Routes:
//   GET /            — SPA shell. Inline JS reads localStorage.auth_token
//                      and calls /api/scene with an Authorization header.
//   GET /api/scene   — requires `Authorization: Bearer dev-token-xyz`.
//                      Returns the scene JSON with it, 401 without.

import { createServer } from "node:http";

const PORT = Number(process.env.PORT) || 3457;
const REQUIRED_TOKEN = "dev-token-xyz";

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
  <head><title>auth-localstorage prototype</title></head>
  <body>
    <h1 data-test="shell-title">Scene viewer</h1>
    <div data-test="scene-status">Loading scene…</div>
    <script>
      (async () => {
        const status = document.querySelector('[data-test="scene-status"]');
        const token = localStorage.getItem('auth_token');
        try {
          const r = await fetch('/api/scene', {
            headers: token ? { authorization: 'Bearer ' + token } : {},
          });
          if (!r.ok) {
            status.textContent = "We couldn't open this scene";
            status.setAttribute('data-test-state', 'error');
            return;
          }
          const scene = await r.json();
          status.textContent = scene.title;
          status.setAttribute('data-test-state', 'ok');
        } catch (e) {
          status.textContent = "We couldn't open this scene";
          status.setAttribute('data-test-state', 'error');
        }
      })();
    </script>
  </body>
</html>`);
    return;
  }

  if (url.pathname === "/api/scene") {
    const auth = req.headers.authorization ?? "";
    const ok = auth === `Bearer ${REQUIRED_TOKEN}`;
    if (!ok) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ title: "My secret diagram (loaded!)" }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`auth-localstorage prototype listening on http://localhost:${PORT}`);
  console.log(`  /           SPA shell (reads localStorage.auth_token)`);
  console.log(`  /api/scene  requires Authorization: Bearer ${REQUIRED_TOKEN}`);
});
