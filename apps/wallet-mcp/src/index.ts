/**
 * @wallet-mcp/mcp — Wallet MCP (manifest Component 1)
 *
 * A stdio MCP server that runs on the agent host (e.g. Claude Desktop).
 * It holds NO private key. When the agent needs a signature it round-trips
 * the payload through the transporter to the user's forked Freighter wallet.
 *
 * See: README.md, docs/manifest.md §5 (Component 1), §10 (tools), §7 (Flows).
 *
 * Tools to implement (manifest §10):
 *   - setup_wallet(publicKey, totpCode) -> { ok }          // calls POST /pair, writes JWT to ~/.wallet-mcp/creds.json
 *   - wallet_status() -> { paired, publicKey? }            // checks creds/JWT
 *   - pay_x402(url, method?, body?) -> { resource, receipt }
 *   - sign_transaction(xdr, submit?) -> { signedXdr?, txHash? }
 *
 * The x402 client's local Ed25519 signer is swapped for a REMOTE signer that
 * asks the wallet (manifest §4). That signer lives in this app's own source
 * (e.g. src/remote-signer.ts) and src/transporter-client.ts — this app is
 * self-contained (no shared workspace packages, to keep deploys simple).
 *
 * Secrets: JWT token lives in ~/.wallet-mcp/creds.json, NOT the MCP config
 * (config holds TRANSPORTER_URL only).
 *
 * Scaffold only — no implementation yet.
 */

export {};
