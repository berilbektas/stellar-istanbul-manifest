# `@wallet-mcp/transporter` — Transporter

> Manifest Component 2 (§5). A **pure relay** + **pairing authority** +
> **attestation** server that runs **inside an AWS AMD SEV-SNP confidential VM**
> (§18). **Holds no private key.**

## Responsibility

Relay sign payloads between the Wallet MCP and the user's Freighter wallet,
authenticate pairing via TOTP, mint JWTs, and serve a TEE attestation. It does
see the payload + meta it relays — which is exactly why it runs in a TEE: memory
is encrypted against the host operator, and `/attestation` proves it.

## HTTP API (manifest §9 — full contracts in [`docs/api-transporter.md`](../../docs/api-transporter.md))

| Method & path            | Auth         | Body / result                                                   |
| ------------------------ | ------------ | -------------------------------------------------------------- |
| `POST /register`         | —            | `{ publicKey }` → `{ walletId, totpSecret, walletToken }`      |
| `POST /pair`             | —            | `{ publicKey, totpCode }` → `{ jwt }`                          |
| `POST /sign-request`     | Bearer JWT   | `{ type, payload, meta }` → `{ requestId }`                    |
| `GET /sign-request/:id`  | Bearer JWT   | → `{ status, result }`                                         |
| `POST /sign-result`      | walletToken  | `{ requestId, status, signature }` → `{ ok }`                 |
| `GET /attestation`       | —            | → `{ report, vlekCertChain, reportData }`                     |

**WebSocket:** `wss://<transporter>/ws?token=<walletToken>` — persistent
wallet connection; server pushes `sign_request` events.

## State (manifest §9)

`wallets` · `pending` · `sockets` · `jwtSigningKey` · `identityKeypair`.
Sensitive: `totpSecret`, `jwtSigningKey` — the things SEV-SNP protects. **No
private key.**

## Deploy

AWS EC2 **M6a/C6a/R6a**, SEV-SNP enabled, Ubuntu 24.04. Attestation via
`snpguest`. Full runbook: [`docs/deploy-tee.md`](../../docs/deploy-tee.md).

## Entry point

`src/index.ts` (scaffold). Implement with `express` (HTTP) + `ws` (WebSocket),
`otplib` (TOTP), `jsonwebtoken` (JWT).
