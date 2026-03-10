/**
 * Prototype 1: Run a Next.js dev server in Vercel Sandbox
 *
 * This is the most basic primitive — can we create a sandbox, scaffold
 * a Next.js app, start `next dev`, and hit it over HTTP?
 *
 * What we test:
 * - Sandbox creation with port exposure
 * - Creating a Next.js app from scratch inside the sandbox
 * - Starting the dev server as a background process
 * - Accessing the dev server via the sandbox's public domain
 */

import { Sandbox } from "@vercel/sandbox";
import { loadEnv, shell, run, runDetached, waitForPort, fixTurbopackRoot, elapsed } from "./shared.js";

loadEnv();

async function main() {
  const t0 = Date.now();

  console.log("=== Prototype 1: Sandbox + Next.js Dev Server ===\n");

  // Step 1: Create sandbox with port 3000 exposed
  console.log(`[1/5] Creating sandbox with port 3000 exposed...`);
  const sandbox = await Sandbox.create({
    resources: { vcpus: 4 },
    timeout: 300_000, // 5 min
    ports: [3000],
    runtime: "node22",
  });
  console.log(`  Sandbox ID: ${sandbox.sandboxId} (${elapsed(t0)})`);

  try {
    // Step 2: Scaffold a minimal Next.js app
    console.log(`\n[2/5] Scaffolding Next.js app...`);
    const scaffoldT = Date.now();

    // Use create-next-app with all defaults
    const scaffold = await shell(
      sandbox,
      `npx -y create-next-app@latest my-app --yes --ts --app --tailwind --no-eslint --no-src-dir --import-alias "@/*" --turbopack 2>&1`,
      { cwd: "/vercel/sandbox" }
    );
    if (scaffold.exitCode !== 0) {
      console.error("create-next-app failed:", scaffold.stderr);
      throw new Error("Scaffold failed");
    }
    await fixTurbopackRoot(sandbox, "/vercel/sandbox/my-app");
    console.log(`  App created (${elapsed(scaffoldT)})`);

    // Step 3: Verify the project
    console.log(`\n[3/5] Verifying project structure...`);
    const ls = await shell(sandbox, "ls -la /vercel/sandbox/my-app/");
    console.log(ls.stdout.split("\n").slice(0, 10).join("\n"));

    const pkg = await shell(sandbox, "cat /vercel/sandbox/my-app/package.json");
    const pkgJson = JSON.parse(pkg.stdout);
    console.log(`  Next.js version: ${pkgJson.dependencies?.next || "unknown"}`);

    // Step 4: Start dev server
    console.log(`\n[4/5] Starting dev server on port 3000...`);
    const devT = Date.now();

    await runDetached(sandbox, "bash", [
      "-lc",
      "cd /vercel/sandbox/my-app && npx next dev --port 3000 --turbopack > /tmp/next-dev.log 2>&1",
    ]);

    // Wait for dev server to be ready
    await waitForPort(sandbox, 3000, 120_000);
    console.log(`  Dev server ready (${elapsed(devT)})`);

    // Step 5: Access the dev server
    console.log(`\n[5/5] Testing dev server access...`);

    // Internal access
    const internal = await shell(
      sandbox,
      `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/`
    );
    console.log(`  Internal HTTP status: ${internal.stdout.trim()}`);

    // Get the public domain
    const devUrl = sandbox.domain(3000);
    console.log(`  Public URL: ${devUrl}`);

    // Fetch from outside
    try {
      const resp = await fetch(devUrl);
      console.log(`  External HTTP status: ${resp.status}`);
      const html = await resp.text();
      console.log(`  Response size: ${html.length} bytes`);
      console.log(
        `  Contains "Next.js": ${html.includes("Next") || html.includes("next")}`
      );
    } catch (e) {
      console.log(`  External fetch failed: ${e}`);
    }

    // Show dev server logs
    console.log(`\n--- Dev server logs (last 20 lines) ---`);
    const logs = await shell(sandbox, "tail -20 /tmp/next-dev.log");
    console.log(logs.stdout);

    console.log(`\n=== Prototype 1 Complete (total: ${elapsed(t0)}) ===`);
    console.log(`\nSummary:`);
    console.log(`  Sandbox ID: ${sandbox.sandboxId}`);
    console.log(`  Dev URL: ${devUrl}`);
    console.log(`  Status: SUCCESS`);
  } catch (error) {
    console.error("\n=== FAILED ===");
    console.error(error);

    // Dump logs for debugging
    try {
      const logs = await shell(sandbox, "cat /tmp/next-dev.log 2>/dev/null || echo 'no logs'");
      console.error("\n--- Dev server logs ---");
      console.error(logs.stdout);
    } catch {}
  } finally {
    console.log("\nStopping sandbox...");
    await sandbox.stop();
    console.log("Done.");
  }
}

main().catch(console.error);
