// Minimal auth fixture for next-browser cookie-parsing validation.
// Run:  node server.mjs            (default port 3456)
//       PORT=4000 node server.mjs
//
// Routes:
//   GET /          — public landing page with a link to /private
//   GET /private   — requires `session=dev-user-42` cookie. Without it,
//                    returns 401. With it, returns a success page.
//
// The prototype isn't a "real" login flow — it assumes the user already
// has the session cookie in their browser, the way they would for a
// real authenticated site. That's the scenario next-browser's --cookies
// flag is designed for.

import { createServer } from "node:http";

const PORT = Number(process.env.PORT) || 3456;
const REQUIRED_COOKIE_NAME = "session";
const REQUIRED_COOKIE_VALUE = "dev-user-42";

function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const piece of header.split(/;\s*/)) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    out[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim();
  }
  return out;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const cookies = parseCookieHeader(req.headers.cookie);

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
  <head><title>auth-cookies prototype</title></head>
  <body>
    <h1 data-test="home-title">auth-cookies prototype</h1>
    <p>This is the public landing page. Nothing secret here.</p>
    <p><a href="/private" data-test="private-link">go to /private</a></p>
  </body>
</html>`);
    return;
  }

  if (url.pathname === "/private") {
    const authed = cookies[REQUIRED_COOKIE_NAME] === REQUIRED_COOKIE_VALUE;
    if (!authed) {
      res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
  <head><title>401 Unauthorized</title></head>
  <body>
    <h1 data-test="unauthorized-title">401 Unauthorized</h1>
    <p>You need a valid <code>${REQUIRED_COOKIE_NAME}</code> cookie to see this page.</p>
  </body>
</html>`);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
  <head><title>private area</title></head>
  <body>
    <h1 data-test="private-title">Welcome to the private area</h1>
    <p data-test="private-body">You are logged in as <strong>${REQUIRED_COOKIE_VALUE}</strong>.</p>
  </body>
</html>`);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`auth-cookies prototype listening on http://localhost:${PORT}`);
  console.log(`  /         public`);
  console.log(`  /private  requires cookie: ${REQUIRED_COOKIE_NAME}=${REQUIRED_COOKIE_VALUE}`);
});
