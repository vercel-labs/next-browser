/**
 * Prototype 4: Full Integration — Agent + Chrome + Dev Server
 *
 * This is the complete vision: a multi-turn agent that has both
 * file/shell access AND browser automation (via puppeteer-core + CDP)
 * against a Next.js dev server, all running in a Vercel Sandbox.
 *
 * The agent can:
 * - Run shell commands
 * - Read/write files
 * - Navigate the browser to any page
 * - Take screenshots
 * - Read the page's visible text (accessibility snapshot)
 * - Check for console errors
 *
 * This validates the full "Option A" architecture from the brain dump:
 * everything in the sandbox, agent drives it from outside via tools.
 */

import Anthropic from "@anthropic-ai/sdk";
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

// ============================================================
// BROWSER TOOL HELPERS
// ============================================================

/**
 * Execute a puppeteer script inside the sandbox against the running Chrome.
 * Returns the script's stdout.
 */
async function puppeteerExec(
  sandbox: Sandbox,
  cdpUrl: string,
  scriptBody: string
): Promise<string> {
  const fullScript = `
const puppeteer = require('puppeteer-core');

async function main() {
  const browser = await puppeteer.connect({
    browserWSEndpoint: '${cdpUrl}',
    defaultViewport: { width: 1280, height: 720 }
  });

  // Reuse existing page or create new one
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();

  ${scriptBody}

  await browser.disconnect();
}

main().catch(e => { console.error(JSON.stringify({ error: e.message })); process.exit(1); });
`;

  await sandbox.writeFiles([
    { path: "/vercel/sandbox/my-app/puppet-exec.js", content: Buffer.from(fullScript) },
  ]);

  const result = await run(sandbox, "node", ["/vercel/sandbox/my-app/puppet-exec.js"], {
    cwd: "/vercel/sandbox/my-app",
  });

  if (result.exitCode !== 0) {
    return `Error: ${result.stderr || result.stdout}`;
  }
  return result.stdout;
}

// ============================================================
// TOOL DEFINITIONS
// ============================================================

const TOOLS: Anthropic.Tool[] = [
  {
    name: "run_shell",
    description:
      "Run a shell command in the sandbox. Project is at /vercel/sandbox/my-app. Dev server runs on port 3000.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "Bash command to execute" },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a file from the sandbox.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute file path" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the sandbox.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute file path" },
        content: { type: "string", description: "File content" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "browser_navigate",
    description:
      "Navigate the browser to a URL. Use http://localhost:3000/path for the dev server.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "URL to navigate to" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_screenshot",
    description:
      "Take a screenshot of the current browser page. Returns the file path where the screenshot was saved.",
    input_schema: {
      type: "object" as const,
      properties: {
        full_page: {
          type: "boolean",
          description: "Whether to capture the full scrollable page",
        },
      },
      required: [],
    },
  },
  {
    name: "browser_get_text",
    description:
      "Get the visible text content of the current page. Useful for verifying what the page shows.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "browser_console_errors",
    description:
      "Get any console errors from the current page. Useful for debugging runtime issues.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// ============================================================
// TOOL HANDLER
// ============================================================

let screenshotCounter = 0;

async function handleToolCall(
  sandbox: Sandbox,
  cdpUrl: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    case "run_shell": {
      const result = await shell(sandbox, toolInput.command as string, {
        cwd: "/vercel/sandbox/my-app",
      });
      return [
        `exit_code: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout.slice(0, 4000)}` : "",
        result.stderr ? `stderr:\n${result.stderr.slice(0, 2000)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "read_file": {
      const result = await shell(sandbox, `cat "${toolInput.path}"`);
      return result.exitCode === 0
        ? result.stdout.slice(0, 8000)
        : `Error: ${result.stderr}`;
    }

    case "write_file": {
      await sandbox.writeFiles([
        {
          path: toolInput.path as string,
          content: Buffer.from(toolInput.content as string),
        },
      ]);
      return `File written to ${toolInput.path}`;
    }

    case "browser_navigate": {
      return puppeteerExec(
        sandbox,
        cdpUrl,
        `
        await page.goto('${toolInput.url}', { waitUntil: 'networkidle2', timeout: 15000 });
        console.log(JSON.stringify({
          url: page.url(),
          title: await page.title(),
          status: 'navigated'
        }));
        `
      );
    }

    case "browser_screenshot": {
      screenshotCounter++;
      const filename = `/tmp/screenshot-${screenshotCounter}.png`;
      const fullPage = toolInput.full_page ?? false;

      await puppeteerExec(
        sandbox,
        cdpUrl,
        `
        await page.screenshot({ path: '${filename}', fullPage: ${fullPage} });
        console.log('Screenshot saved to ${filename}');
        `
      );

      // Download locally
      const data = await sandbox.readFileToBuffer({ path: filename });
      if (data) {
        const localPath = `/tmp/cloud-proto-screenshot-${screenshotCounter}.png`;
        writeFileSync(localPath, data);
        return `Screenshot saved: ${localPath} (${data.length} bytes). Also available in sandbox at ${filename}`;
      }
      return `Screenshot saved in sandbox at ${filename} (could not download locally)`;
    }

    case "browser_get_text": {
      return puppeteerExec(
        sandbox,
        cdpUrl,
        `
        const text = await page.evaluate(() => {
          return document.body?.innerText || 'empty page';
        });
        console.log(text);
        `
      );
    }

    case "browser_console_errors": {
      return puppeteerExec(
        sandbox,
        cdpUrl,
        `
        // Set up error listener
        const errors = [];
        page.on('console', msg => {
          if (msg.type() === 'error') errors.push(msg.text());
        });
        page.on('pageerror', err => errors.push(err.message));

        // Reload to capture errors
        await page.reload({ waitUntil: 'networkidle2', timeout: 10000 });

        // Wait a moment for any async errors
        await new Promise(r => setTimeout(r, 1000));

        if (errors.length === 0) {
          console.log('No console errors detected.');
        } else {
          console.log('Console errors:\\n' + errors.join('\\n'));
        }
        `
      );
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ============================================================
// CONVERSATION RUNNER
// ============================================================

async function runConversation(
  client: Anthropic,
  sandbox: Sandbox,
  cdpUrl: string,
  userMessages: string[]
) {
  const messages: Anthropic.MessageParam[] = [];

  const systemPrompt = `You are a Next.js development assistant with browser automation capabilities. You have access to a cloud sandbox with:
- A Next.js app at /vercel/sandbox/my-app
- A dev server running on http://localhost:3000
- A headless Chrome browser you can navigate and screenshot

You can run shell commands, read/write files, navigate the browser, take screenshots, read page text, and check for console errors.

When making code changes:
1. Edit the relevant files
2. Navigate the browser to the affected page
3. Verify the change works (check text output or take a screenshot)
4. Report back to the user

Be concise and action-oriented.`;

  for (const userMessage of userMessages) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`USER: ${userMessage}`);
    console.log(`${"=".repeat(60)}`);

    messages.push({ role: "user", content: userMessage });

    let turnCount = 0;
    while (true) {
      turnCount++;
      const t = Date.now();

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });

      console.log(
        `\n[Turn ${turnCount}] (${elapsed(t)}) stop=${response.stop_reason}`
      );

      messages.push({ role: "assistant", content: response.content });

      for (const block of response.content) {
        if (block.type === "text") {
          console.log(`\nASSISTANT: ${block.text}`);
        }
      }

      if (response.stop_reason !== "tool_use") break;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          console.log(
            `  [tool] ${block.name}(${JSON.stringify(block.input).slice(0, 120)})`
          );
          const result = await handleToolCall(
            sandbox,
            cdpUrl,
            block.name,
            block.input as Record<string, unknown>
          );
          console.log(
            `  [result] ${result.slice(0, 300)}${result.length > 300 ? "..." : ""}`
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  return messages;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const t0 = Date.now();

  console.log("=== Prototype 4: Full Integration (Agent + Chrome + Dev Server) ===\n");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Create sandbox
  console.log(`[setup] Creating sandbox (8 vCPUs, ports: 3000)...`);
  const sandbox = await Sandbox.create({
    resources: { vcpus: 8 },
    timeout: 600_000,
    ports: [3000],
    runtime: "node22",
  });
  console.log(`  Sandbox ID: ${sandbox.sandboxId} (${elapsed(t0)})`);

  try {
    // Scaffold app
    console.log(`\n[setup] Scaffolding Next.js app...`);
    const scaffoldT = Date.now();
    await shell(
      sandbox,
      `npx -y create-next-app@latest my-app --yes --ts --app --tailwind --no-eslint --no-src-dir --import-alias "@/*" --turbopack 2>&1`,
      { cwd: "/vercel/sandbox" }
    );
    await fixTurbopackRoot(sandbox, "/vercel/sandbox/my-app");
    console.log(`  Done (${elapsed(scaffoldT)})`);

    // Install Chrome BEFORE dev server
    console.log(`\n[setup] Installing Chrome...`);
    const chromeT = Date.now();
    const chromePath = await installChrome(sandbox, "/vercel/sandbox/my-app");
    console.log(`  Chrome installed (${elapsed(chromeT)})`);

    // Start dev server after Chrome install (pnpm add would kill running server)
    console.log(`\n[setup] Starting dev server...`);
    const devT = Date.now();
    await runDetached(sandbox, "bash", [
      "-lc",
      "cd /vercel/sandbox/my-app && npx next dev --port 3000 > /tmp/next-dev.log 2>&1",
    ]);
    await waitForPort(sandbox, 3000, 120_000);
    console.log(`  Dev server ready (${elapsed(devT)})`);

    console.log(`\n[setup] Launching Chrome...`);
    const launchT = Date.now();
    const cdpUrl = await launchChrome(sandbox, chromePath);
    console.log(`  Chrome ready (${elapsed(launchT)})`);

    console.log(`\n[setup] Total setup: ${elapsed(t0)}`);
    console.log(`${"=".repeat(60)}\n`);

    // Run the conversation
    const conversation = await runConversation(client, sandbox, cdpUrl, [
      // Turn 1: Explore and understand the current state
      "Take a screenshot of the homepage and tell me what you see. Also list the app's file structure.",

      // Turn 2: Make a meaningful change with visual verification
      "Create a new /dashboard page with a card layout showing 3 stat cards (Total Users: 1,234, Revenue: $45,678, Active Now: 42). Use Tailwind for styling. Then navigate to it and take a screenshot to verify.",

      // Turn 3: Debug something
      "Check if there are any console errors on the dashboard page. Also read the page's text content to make sure all the stats are rendering correctly.",
    ]);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`=== Prototype 4 Complete (total: ${elapsed(t0)}) ===`);
    console.log(`\nSummary:`);
    console.log(`  Total messages: ${conversation.length}`);
    console.log(`  Sandbox ID: ${sandbox.sandboxId}`);
    console.log(`  Dev URL: ${sandbox.domain(3000)}`);
    console.log(`  Chrome CDP: ${cdpUrl}`);
    console.log(`  Screenshots: ${screenshotCounter}`);
    console.log(`  Status: SUCCESS`);
  } catch (error) {
    console.error("\n=== FAILED ===");
    console.error(error);
    try {
      const logs = await shell(
        sandbox,
        "cat /tmp/next-dev.log 2>/dev/null | tail -30 || echo 'no logs'"
      );
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
