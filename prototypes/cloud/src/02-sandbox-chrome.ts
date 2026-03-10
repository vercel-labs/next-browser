/**
 * Prototype 2: Chrome + Dev Server in Sandbox
 *
 * Extends Prototype 1 by adding headless Chromium via @sparticuz/chromium.
 * Uses puppeteer-core to connect via CDP and take a screenshot of the
 * Next.js dev server running inside the same sandbox.
 *
 * What we test:
 * - System dependency installation (dnf on Amazon Linux 2023)
 * - @sparticuz/chromium installation and executable extraction
 * - Chrome launch with CDP in headless mode
 * - puppeteer-core connecting to Chrome via CDP
 * - Taking a screenshot of the dev server
 * - Reading the screenshot file back from the sandbox
 */

import { Sandbox } from "@vercel/sandbox";
import { writeFileSync } from "fs";
import {
  loadEnv,
  shell,
  run,
  runDetached,
  waitForPort,
  installChrome,
  launchChrome,
  fixTurbopackRoot,
  elapsed,
} from "./shared.js";

loadEnv();

async function main() {
  const t0 = Date.now();

  console.log("=== Prototype 2: Chrome + Dev Server in Sandbox ===\n");

  console.log(`[1/7] Creating sandbox...`);
  const sandbox = await Sandbox.create({
    resources: { vcpus: 8 },
    timeout: 600_000, // 10 min (Chrome install takes a while)
    ports: [3000],
    runtime: "node22",
  });
  console.log(`  Sandbox ID: ${sandbox.sandboxId} (${elapsed(t0)})`);

  try {
    // Step 2: Scaffold Next.js app
    console.log(`\n[2/7] Scaffolding Next.js app...`);
    const scaffoldT = Date.now();
    await shell(
      sandbox,
      `npx -y create-next-app@latest my-app --yes --ts --app --tailwind --no-eslint --no-src-dir --import-alias "@/*" --turbopack 2>&1`,
      { cwd: "/vercel/sandbox" }
    );
    await fixTurbopackRoot(sandbox, "/vercel/sandbox/my-app");
    console.log(`  Done (${elapsed(scaffoldT)})`);

    // Step 3: Install Chrome BEFORE dev server (pnpm add modifies node_modules)
    console.log(`\n[3/7] Installing Chrome...`);
    const chromeT = Date.now();
    const chromePath = await installChrome(sandbox, "/vercel/sandbox/my-app");
    console.log(`  Chrome installed (${elapsed(chromeT)})`);

    // Step 4: Start dev server
    console.log(`\n[4/7] Starting dev server...`);
    const devT = Date.now();
    await runDetached(sandbox, "bash", [
      "-lc",
      "cd /vercel/sandbox/my-app && npx next dev --port 3000 > /tmp/next-dev.log 2>&1",
    ]);
    await waitForPort(sandbox, 3000, 120_000);
    console.log(`  Dev server ready (${elapsed(devT)})`);

    // Step 5: Launch Chrome with CDP
    console.log(`\n[5/7] Launching Chrome...`);
    const launchT = Date.now();
    const cdpUrl = await launchChrome(sandbox, chromePath);
    console.log(`  Chrome launched (${elapsed(launchT)})`);

    // Step 6: Take screenshot via puppeteer inside the sandbox
    console.log(`\n[6/7] Taking screenshot via puppeteer-core...`);
    const screenshotT = Date.now();

    // Write a puppeteer script into the sandbox and run it
    const puppeteerScript = `
const puppeteer = require('puppeteer-core');

async function main() {
  const browser = await puppeteer.connect({
    browserWSEndpoint: '${cdpUrl}',
    defaultViewport: { width: 1280, height: 720 }
  });

  const page = await browser.newPage();

  console.log('Navigating to dev server...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('Page title:', await page.title());
  console.log('Page URL:', page.url());

  // Take screenshot
  await page.screenshot({ path: '/tmp/screenshot.png', fullPage: true });
  console.log('Screenshot saved to /tmp/screenshot.png');

  // Get page content summary
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || 'empty');
  console.log('Page text preview:', text.slice(0, 200));

  await browser.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
`;

    await sandbox.writeFiles([
      { path: "/vercel/sandbox/my-app/puppet-test.js", content: Buffer.from(puppeteerScript) },
    ]);

    const screenshotResult = await run(
      sandbox,
      "node",
      ["puppet-test.js"],
      { cwd: "/vercel/sandbox/my-app" }
    );
    console.log(screenshotResult.stdout);
    if (screenshotResult.exitCode !== 0) {
      console.error("Screenshot script error:", screenshotResult.stderr);
    }
    console.log(`  Screenshot taken (${elapsed(screenshotT)})`);

    // Step 7: Download the screenshot
    console.log(`\n[7/7] Downloading screenshot...`);
    const screenshotData = await sandbox.readFileToBuffer({ path: "/tmp/screenshot.png" });
    if (screenshotData) {
      const outputPath = "/tmp/next-browser-cloud-screenshot.png";
      writeFileSync(outputPath, screenshotData);
      console.log(`  Saved to ${outputPath} (${screenshotData.length} bytes)`);
    } else {
      console.log("  Could not read screenshot file");
    }

    console.log(`\n=== Prototype 2 Complete (total: ${elapsed(t0)}) ===`);
    console.log(`\nSummary:`);
    console.log(`  Sandbox ID: ${sandbox.sandboxId}`);
    console.log(`  Chrome CDP: ${cdpUrl}`);
    console.log(`  Dev URL: ${sandbox.domain(3000)}`);
    console.log(`  Screenshot: /tmp/next-browser-cloud-screenshot.png`);
    console.log(`  Status: SUCCESS`);
  } catch (error: unknown) {
    console.error("\n=== FAILED ===");
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      if (error.stack) console.error(error.stack);
    } else {
      console.error(String(error));
    }
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
