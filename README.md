# Wallet MCP — Remote Signer for Agentic Payments

> **1Password for agent payments: agents ask, you approve, and your keys never
> leave your wallet.**

AI agents make on-chain x402 payments and general Stellar transactions **without
ever holding your private key**. When an agent hits a paywall, the signing
request lands in your own wallet (a forked Freighter); you approve it by hand;
the agent continues. The key never touches the agent, the MCP, the transporter,
or the resource server.

Built for the Stellar hackathon. Full spec: [`docs/manifest.md`](docs/manifest.md).

## Monorepo layout

Bun workspaces + Turborepo. **Apps-only, each self-contained** (no shared
`workspace:*` packages — keeps every service independently deployable).

```
apps/
  wallet-mcp/        # Component 1 — stdio MCP on the agent host (NO key)
  transporter/       # Component 2 — relay + pairing + attestation (AWS AMD SEV-SNP VM)
  freighter/         # Component 3 — FORKED Freighter extension (PRIVATE KEY + approval UI)
  twitter-backend/   # Component 4a — mock x402 merchant (Express + @x402/express)
  twitter-mcp/       # Component 4b — mock remote MCP server (Streamable HTTP)
docs/                # manifest, architecture, flows, API contract, TEE deploy
examples/            # Claude Desktop wiring for the demo
```

`apps/freighter` is a fork of [stellar/freighter](https://github.com/stellar/freighter)
with its **own Yarn toolchain**; it is intentionally outside the Bun workspaces
and Biome scope. See [`apps/freighter/FORK_NOTES.md`](apps/freighter/FORK_NOTES.md).

## Prerequisites

- [Bun](https://bun.sh) `1.3.8` (root) · Node `>=20`
- For the wallet fork: Yarn 4 (via Corepack) — Freighter's own toolchain
- Stellar **testnet** account with a **USDC trustline**, a facilitator, and
  Soroban RPC `https://soroban-testnet.stellar.org` (see [`docs/manifest.md`](docs/manifest.md) §12)

## Quickstart

```bash
bun install                 # installs all apps (NOT the freighter fork)

# run an app
cd apps/transporter && cp .env.example .env && bun run dev
cd apps/twitter-backend && cp .env.example .env && bun run dev
cd apps/twitter-mcp && cp .env.example .env && bun run dev
cd apps/wallet-mcp && bun run build      # then wire into Claude Desktop (see examples/)

# the forked wallet (separate toolchain)
bun run freighter:install   # cd apps/freighter && yarn install
bun run freighter:build     # production extension build
```

## Root scripts (Turborepo)

| Script            | Does                                  |
| ----------------- | ------------------------------------- |
| `bun dev`         | `turbo dev` across apps               |
| `bun build`       | `turbo build` across apps             |
| `bun lint`        | `turbo lint` (Biome)                  |
| `bun typecheck`   | `turbo typecheck`                     |
| `bun format`      | Biome write                           |
| `bun run freighter:install` / `freighter:build` | drive the wallet fork |

## Build plan (manifest §13)

- **Phase 0** — run the official x402 Stellar quickstart end-to-end with a local
  keypair (de-risk auth-entry + facilitator settle).
- **Phase 1** — swap the local signer for the **remote signer**; wire
  `MCP → transporter → signature → back` (stub key, no Freighter yet) + TOTP/JWT.
- **Phase 2** — the **Freighter fork**: register + WebSocket + approval UI +
  `signAuthEntry`/`signTransaction`. Real approvals → demo ready.
- **Phase 3** — AWS AMD SEV-SNP deploy + `/attestation`; polish + rehearse.

## Security

The whole project removes an anti-pattern (private keys in agent configs). The
private key lives **only** in Freighter; the transporter runs in a TEE; every
signature needs explicit human approval. See [`SECURITY.md`](SECURITY.md) and
[`docs/manifest.md`](docs/manifest.md) §11.

## Docs

[Architecture](docs/architecture.md) · [Flows](docs/flows.md) ·
[Transporter API](docs/api-transporter.md) · [TEE deploy](docs/deploy-tee.md)
