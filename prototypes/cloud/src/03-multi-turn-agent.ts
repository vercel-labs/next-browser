/**
 * Prototype 3: Multi-Turn Agent via Anthropic SDK
 *
 * This prototype tests multi-turn conversation with an AI agent that has
 * tools to interact with a Vercel Sandbox. The agent can:
 * - Run shell commands in the sandbox
 * - Read/write files
 * - Take screenshots (if Chrome is available)
 *
 * This validates the core architecture question: can we have a stateful
 * multi-turn conversation where each turn triggers sandbox actions?
 *
 * Architecture: Agent runs OUTSIDE, sandbox is a tool environment.
 * (We test this first because it's simpler, then Prototype 4 tests
 * running the agent inside the sandbox.)
 */

import Anthropic from "@anthropic-ai/sdk";
import { Sandbox } from "@vercel/sandbox";
import {
  loadEnv,
  shell,
  run,
  runDetached,
  waitForPort,
  fixTurbopackRoot,
  elapsed,
} from "./shared.js";

loadEnv();

// Tool definitions for the agent
const TOOLS: Anthropic.Tool[] = [
  {
    name: "run_shell",
    description:
      "Run a shell command in the cloud sandbox. The sandbox has a Next.js dev server running on port 3000. Use this to inspect files, run commands, check logs, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a file from the sandbox filesystem.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the sandbox filesystem.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file",
        },
        content: {
          type: "string",
          description: "File content to write",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "curl_page",
    description:
      "Fetch the HTML content of a page from the dev server. Useful for inspecting what the server renders.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: 'URL path, e.g. "/" or "/about"',
        },
      },
      required: ["path"],
    },
  },
];

/**
 * Handle a tool call by executing it against the sandbox.
 */
async function handleToolCall(
  sandbox: Sandbox,
  toolName: string,
  toolInput: Record<string, string>
): Promise<string> {
  switch (toolName) {
    case "run_shell": {
      const result = await shell(sandbox, toolInput.command, {
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
      if (result.exitCode !== 0) {
        return `Error: ${result.stderr}`;
      }
      return result.stdout.slice(0, 8000);
    }
    case "write_file": {
      await sandbox.writeFiles([
        {
          path: toolInput.path,
          content: Buffer.from(toolInput.content),
        },
      ]);
      return `File written to ${toolInput.path}`;
    }
    case "curl_page": {
      const result = await shell(
        sandbox,
        `curl -s http://localhost:3000${toolInput.path}`
      );
      return result.stdout.slice(0, 6000);
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}

/**
 * Run a multi-turn conversation with the agent.
 */
async function runConversation(
  client: Anthropic,
  sandbox: Sandbox,
  userMessages: string[]
) {
  const messages: Anthropic.MessageParam[] = [];

  const systemPrompt = `You are a Next.js development assistant. You have access to a cloud sandbox running a Next.js dev server on port 3000. The project is at /vercel/sandbox/my-app.

You can run shell commands, read/write files, and fetch pages from the dev server. Help the user with their Next.js development tasks.

Be concise and action-oriented. When making changes, verify they work by checking the dev server output.`;

  for (const userMessage of userMessages) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`USER: ${userMessage}`);
    console.log(`${"=".repeat(60)}`);

    messages.push({ role: "user", content: userMessage });

    // Agent loop - keep going until we get a non-tool-use response
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

      console.log(`\n[Turn ${turnCount}] (${elapsed(t)}) stop_reason=${response.stop_reason}`);

      // Collect assistant text and tool uses
      const assistantContent: Anthropic.ContentBlock[] = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      // Print any text blocks
      for (const block of assistantContent) {
        if (block.type === "text") {
          console.log(`\nASSISTANT: ${block.text}`);
        }
      }

      // If no tool use, conversation turn is done
      if (response.stop_reason !== "tool_use") {
        break;
      }

      // Handle tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of assistantContent) {
        if (block.type === "tool_use") {
          console.log(`  [tool] ${block.name}(${JSON.stringify(block.input).slice(0, 100)}...)`);
          const result = await handleToolCall(
            sandbox,
            block.name,
            block.input as Record<string, string>
          );
          console.log(`  [result] ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`);
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

async function main() {
  const t0 = Date.now();

  console.log("=== Prototype 3: Multi-Turn Agent via Anthropic SDK ===\n");

  // Initialize Anthropic client
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Create sandbox
  console.log(`[setup] Creating sandbox...`);
  const sandbox = await Sandbox.create({
    resources: { vcpus: 4 },
    timeout: 600_000,
    ports: [3000],
    runtime: "node22",
  });
  console.log(`  Sandbox ID: ${sandbox.sandboxId} (${elapsed(t0)})`);

  try {
    // Scaffold app
    console.log(`\n[setup] Scaffolding Next.js app...`);
    await shell(
      sandbox,
      `npx -y create-next-app@latest my-app --yes --ts --app --tailwind --no-eslint --no-src-dir --import-alias "@/*" --turbopack 2>&1`,
      { cwd: "/vercel/sandbox" }
    );
    await fixTurbopackRoot(sandbox, "/vercel/sandbox/my-app");

    // Start dev server
    console.log(`[setup] Starting dev server...`);
    await runDetached(sandbox, "bash", [
      "-lc",
      "cd /vercel/sandbox/my-app && npx next dev --port 3000 --turbopack > /tmp/next-dev.log 2>&1",
    ]);
    await waitForPort(sandbox, 3000, 120_000);
    console.log(`[setup] Ready! (${elapsed(t0)})\n`);

    // Run a multi-turn conversation
    const conversation = await runConversation(client, sandbox, [
      // Turn 1: Explore the project
      "What pages does this Next.js app have? Look at the file structure.",

      // Turn 2: Make a change
      "Add a new page at /about that shows 'About Us' as an h1 and a paragraph saying 'This is a cloud-hosted Next.js app running in a Vercel Sandbox.' Use server components.",

      // Turn 3: Verify the change
      "Now verify the /about page works by fetching it from the dev server. Show me the HTML output.",
    ]);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`=== Prototype 3 Complete (total: ${elapsed(t0)}) ===`);
    console.log(`\nSummary:`);
    console.log(`  Total messages: ${conversation.length}`);
    console.log(`  Sandbox ID: ${sandbox.sandboxId}`);
    console.log(`  Dev URL: ${sandbox.domain(3000)}`);
    console.log(`  Status: SUCCESS`);
  } catch (error) {
    console.error("\n=== FAILED ===");
    console.error(error);
  } finally {
    console.log("\nStopping sandbox...");
    await sandbox.stop();
    console.log("Done.");
  }
}

main().catch(console.error);
