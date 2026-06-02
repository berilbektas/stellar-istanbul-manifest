# `@wallet-mcp/twitter-mcp` — Twitter remote MCP server (part 2/2)

> Manifest Component 4 (§5, §12), **split part 2**: the agent-facing **remote
> MCP server**. Paired with [`twitter-backend`](../twitter-backend) (the x402
> merchant, part 1/2).

## Remote (not stdio), keyless

Unlike the Wallet MCP (local, stdio), this MCP is **remote**: it speaks the MCP
**Streamable HTTP** transport (`@modelcontextprotocol/sdk`
`StreamableHTTPServerTransport`, stateful sessions) over Express, so it can be
deployed and connected to over the network. It holds **no keys** and **never
pays**.

## Tools (21)

Exposes one tool per twitter-backend endpoint (`create_tweet`, `delete_tweet`,
`get_tweet`, `search_recent`, `user_timeline`, `home_timeline`, `mentions`,
`get_user`, `get_user_by_username`, `me`, `like`, `unlike`, `retweet`,
`unretweet`, `reply`, `bookmark`, `remove_bookmark`, `follow`, `unfollow`,
`followers`, `following`).

Each tool does a plain `fetch` to the backend (no key, no payment). Since every
backend endpoint is paid, the backend returns `402 + PAYMENT-REQUIRED`; the MCP
**relays it** to the agent, decoded and readable:

```json
{
  "status": "payment_required",
  "instruction": "… Wallet MCP'nin pay_x402 tool'unu pay_with bilgisiyle çağır …",
  "pay_with": { "tool": "pay_x402", "url": "…/tweets", "method": "POST", "body": { "text": "…" } },
  "payment_required": { "accepts": [{ "amount": "…", "asset": "USDC", "network": "stellar:testnet", … }] }
}
```

The agent then pays via the **Wallet MCP** `pay_x402(url, method, body)` (remote
signer → Freighter approval, §4/§8); on the paid retry the backend executes the
Twitter call and returns the result in `pay_x402`'s response.

## Demo wiring (manifest §12)

Claude has **two** MCPs connected: the **Wallet MCP** (pays) and this **Twitter
MCP** (the paid service). Agent calls e.g. `create_tweet` → `402` relayed →
Wallet MCP pushes the request to the user's Freighter → user approves → tweet
posted. The key never leaves the wallet.

## Config

See `.env.example`: `PORT` (this server, `:4022`), `MCP_PATH` (`/mcp`),
`TWITTER_BACKEND_URL` (the x402 merchant, `:4021`).

## Run

```bash
bun run dev    # tsx watch, :4022/mcp
bun run typecheck
bun run lint   # biome
```

## Entry point

`src/index.ts` → `src/registry.ts` (keyless tool metadata).
