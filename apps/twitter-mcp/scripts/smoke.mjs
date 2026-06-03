/**
 * twitter-mcp smoke test — gerçek bir MCP client ile Streamable HTTP üzerinden
 * bağlanır, tool'ları listeler ve birkaç tool çağırır.
 *
 * Kullanım (twitter-mcp ÇALIŞIYORKEN):
 *   bun apps/twitter-mcp/scripts/smoke.mjs
 *   MCP_URL=http://localhost:4022/mcp bun apps/twitter-mcp/scripts/smoke.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:4022/mcp";

const c = new Client({ name: "smoke", version: "0.0.0" });
await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));

const { tools } = await c.listTools();
console.log(`\n✅ ${tools.length} tool listelendi:`);
console.log(`   ${tools.map((t) => t.name).join(", ")}`);

for (const call of [
  { name: "search_recent", arguments: { query: "stellar" } },
  { name: "create_tweet", arguments: { text: "gm https://stellar.org" } },
]) {
  const r = await c.callTool(call);
  const out = JSON.parse(r.content[0].text);
  console.log(`\n── ${call.name} ──`);
  if (out.status === "payment_required") {
    const a = out.payment_required?.accepts?.[0];
    console.log(`   status: payment_required`);
    console.log(`   pay_with: ${out.pay_with.method} ${out.pay_with.url}`);
    console.log(
      `   price: amount=${a?.amount} asset=${a?.asset?.slice(0, 8)}… net=${a?.network}`
    );
  } else {
    console.log(
      `   status: ${out.status}`,
      JSON.stringify(out.result ?? out).slice(0, 200)
    );
  }
}

await c.close();
console.log("\n✅ smoke bitti.\n");
