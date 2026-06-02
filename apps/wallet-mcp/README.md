# `@wallet-mcp/mcp` — Wallet MCP

> Manifest Component 1 (§5). Runs on the **agent host** (Claude Desktop) as a
> local **stdio** MCP server. **Holds no private key.**

## Responsibility

Expose wallet tools to the agent and route every signature request to the
user's forked Freighter wallet through the transporter. The x402 client's local
signer is replaced with a **remote signer** (manifest §4) — the swap point is
the `signer` argument of `ExactStellarScheme`.

## Tools (manifest §10)

| Tool                                          | Purpose                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `setup_wallet(publicKey, totpCode)`           | Calls `POST /pair`; writes the returned JWT to `~/.wallet-mcp/creds.json`. |
| `wallet_status()`                             | Reports whether creds/JWT exist.                                        |
| `pay_x402(url, method?, body?)`               | Runs the x402 client; on `402` round-trips the auth-entry to the wallet; returns `{ resource, receipt }`. |
| `sign_transaction(xdr, submit?=true)`         | Has the wallet sign an XDR; submits to Soroban RPC or returns `signedXdr`. |

## Layout (self-contained — no shared packages)

To keep deploys simple, this app vendors everything it needs in `src/`:

```
src/
  index.ts             # MCP server (stdio) + tool registration
  remote-signer.ts     # the signer swap (manifest §4) — preimage -> transporter -> Freighter
  transporter-client.ts# HTTP client: /pair, /sign-request, poll GET /sign-request/:id
  types.ts             # local copy of the transporter API contract (source of truth: docs/api-transporter.md)
```

## Secrets

- JWT **token** → `~/.wallet-mcp/creds.json` (NOT the MCP config). Reason: the
  MCP process can't reload host client config at runtime; this avoids a restart.
- MCP config carries only `TRANSPORTER_URL`. See `.env.example`.
- **No private key, ever.**

## Entry point

`src/index.ts` (scaffold). Implement the MCP server with
`@modelcontextprotocol/sdk` (stdio transport) and the four tools above.

## Related

- Transporter API: [`docs/api-transporter.md`](../../docs/api-transporter.md)
- Flows: [`docs/flows.md`](../../docs/flows.md) · x402 flow: [`docs/manifest.md`](../../docs/manifest.md) §8
