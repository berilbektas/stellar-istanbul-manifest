# Example — connect both MCPs to Claude Desktop

This is the demo wiring from manifest §12: Claude has **two** MCPs connected —
the **Wallet MCP** (pays) and the **Twitter MCP** (the paid service).

1. Build the Wallet MCP: `bun build --filter @wallet-mcp/mcp` (or `cd apps/wallet-mcp && bun run build`).
2. Start the transporter and the Twitter backend + remote MCP (see each app's README).
3. Copy [`claude_desktop_config.example.json`](./claude_desktop_config.example.json)
   into your Claude Desktop config, fixing the absolute path and ports.
   - The **wallet** MCP is local (stdio) — launched by Claude via `command`/`args`.
   - The **twitter** MCP is remote (Streamable HTTP) — Claude connects to its `url`.
4. In Claude: run `setup_wallet` (pair with your wallet's public key + TOTP code),
   then ask the agent to `post_tweet` — approve the payment in your Freighter.

> Config keys may vary by Claude Desktop version; adjust to your build. The MCP
> config holds only `TRANSPORTER_URL` (+ network/RPC) — never a private key.
