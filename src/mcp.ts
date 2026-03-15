/**
 * Next.js dev-server MCP client. POSTs JSON-RPC to /_next/mcp
 * (StreamableHTTP transport, SSE response).
 */

export async function call(
  origin: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(`${origin}/_next/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`MCP ${res.status} ${res.statusText}`);

  const body = await res.text();
  const data = body.match(/^data: (.+)$/m)?.[1];
  if (!data) throw new Error("no data frame in MCP response");

  const parsed = JSON.parse(data);
  if (parsed.error) throw new Error(parsed.error.message);

  const text = parsed.result?.content?.[0]?.text;
  if (!text) return parsed.result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
