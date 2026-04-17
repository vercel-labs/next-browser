---
"@vercel/next-browser": minor
---

Add `--insecure` flag to `open` command. When set, launches the browser with TLS certificate validation disabled (`ignoreHTTPSErrors` + `--ignore-certificate-errors`), so dev servers with self-signed or CN-mismatched certs — e.g. Next.js `--experimental-https` on a custom hostname — can be loaded without a cert interstitial.
