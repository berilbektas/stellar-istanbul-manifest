# CLAUDE.md

Wallet MCP — a remote signer for agentic payments. Read [`docs/manifest.md`](docs/manifest.md)
first; it is the source of truth for every term, contract, and decision.

## Monorepo

- Bun workspaces + Turborepo + Biome. **Apps-only; each app is self-contained.**
- **Do not introduce shared `workspace:*` packages.** They broke deploys; every
  app must stay independently deployable. If two apps need the same type, copy it
  — the canonical contract is [`docs/api-transporter.md`](docs/api-transporter.md).
- `apps/freighter` is a **fork** with its own Yarn toolchain; it is outside the
  Bun workspaces and Biome. Work on it via `bun run freighter:*` or
  `cd apps/freighter && yarn …`. See `apps/freighter/FORK_NOTES.md`.

## Invariants (never violate)

- The **private key lives only in Freighter**. Never route it through the agent,
  MCP, transporter, or resource server.
- The MCP config holds only `TRANSPORTER_URL`; the JWT goes to
  `~/.wallet-mcp/creds.json`.
- The transporter holds **no private key** — only `totpSecret` + `jwtSigningKey`
  (SEV-SNP-protected).
- Every signature requires explicit human approval in the wallet.
- Never commit secrets (`S...` keys, `creds.json`, `.env`, TOTP/JWT secrets).

## Code

- Match the existing formatter/linter (Biome). Run `bun lint` before finishing.
- Keep changes minimal and atomic. No new deps without good reason.
- When touching `apps/freighter`, the `freighter-best-practices` skill applies.

## Testnet (manifest §12, §15)

Stellar testnet · USDC trustline required · fee fixed to **1 stroop** · Soroban
RPC (not Horizon) · auth-entry expiration ~60 ledgers (~5 min) to cover human
approval.
