# `@wallet-mcp/twitter-mcp` — Mock Twitter remote MCP server (demo, part 2/2)

> Manifest Component 4 (§5, §12), **split part 2**: the agent-facing **remote
> MCP server**. Paired with [`twitter-backend`](../twitter-backend) (the x402
> merchant, part 1/2).

## Remote (not stdio)

Unlike the Wallet MCP (local, stdio), this MCP is **remote**: it speaks the MCP
**Streamable HTTP** transport (`@modelcontextprotocol/sdk`
`StreamableHTTPServerTransport`) over Express, so it can be deployed and
connected to over the network. It holds **no keys** and **never pays**.

> Alternative: deploy as a Cloudflare Worker (like the router402 reference's
> `apps/mcp`). Kept as a plain Node service here so every app deploys the same way.

## Tools

| Tool                 | Behavior                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `read_timeline()`    | Proxies `GET /timeline` on the backend (free).                                |
| `post_tweet(text)`   | Hits `POST /tweet`; surfaces the backend's `402 PAYMENT-REQUIRED`. The agent then pays via the **Wallet MCP** `pay_x402` (remote signer, §4/§8) and the post completes. |

## Demo wiring (manifest §12)

Claude has **two** MCPs connected: the **Wallet MCP** (pays) and this **Twitter
MCP** (the paid service). Agent calls `post_tweet` → `402` → Wallet MCP pushes
the request to the user's Freighter → user approves → tweet posted.

## Config

See `.env.example` (`PORT`, `TWITTER_BACKEND_URL`).

## Entry point

`src/index.ts` (scaffold).
