/**
 * @wallet-mcp/twitter-mcp — Mock Twitter remote MCP server (manifest Component 4, part 2/2)
 *
 * The agent-facing MCP. Unlike the Wallet MCP (local, stdio), this is a REMOTE
 * MCP server: it speaks the MCP Streamable HTTP transport over Express so it can
 * be deployed and connected to over the network. It is a thin adapter in front
 * of twitter-backend (the x402 merchant) — it holds no keys and never pays.
 *
 * Tools:
 *   - read_timeline()      -> proxies GET /timeline on twitter-backend (free)
 *   - post_tweet(text)     -> hits POST /tweet; surfaces the backend's 402
 *                             PAYMENT-REQUIRED so the agent pays via the Wallet
 *                             MCP's pay_x402 (the remote signer flow, §4/§8),
 *                             then completes the post.
 *
 * Transport: @modelcontextprotocol/sdk StreamableHTTPServerTransport, served by
 * Express. (Could also be deployed as a Cloudflare Worker, like the router402
 * reference's apps/mcp — kept as a plain Node service here for uniform deploys.)
 *
 * See: README.md, twitter-backend/README.md, docs/manifest.md §5, §8, §12.
 *
 * Scaffold only — no implementation yet.
 */

export {};
