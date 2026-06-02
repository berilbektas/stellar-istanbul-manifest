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

| Method & path                | Auth         | Body / result                                                                |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `POST /register`             | —            | `{ publicKey }` → `{ walletId, totpSecret, walletToken, vapidPublicKey }`     |
| `POST /pair`                 | —            | `{ publicKey, totpCode }` → `{ jwt }`                                         |
| `POST /sign-request`         | Bearer JWT   | `{ type, payload, meta }` → `{ requestId }`                                   |
| `GET /sign-request/:id`      | Bearer JWT   | → `{ status, result }`                                                        |
| `POST /sign-result`          | walletToken  | `{ requestId, status, signature }` → `{ ok }`                                |
| `POST /push-subscription`    | walletToken  | `{ subscription }` → `{ ok }`                                                 |
| `GET /push/vapid-public-key` | —            | → `{ vapidPublicKey }`                                                        |
| `GET /attestation`           | —            | → `{ report, vlekCertChain, reportData }`                                    |

**WebSocket:** `wss://<transporter>/ws?token=<walletToken>` — persistent
wallet connection; server pushes `sign_request` events (now including `address`,
the G-account that must sign).

## Offline delivery (manifest §15.3)

An MV3 service worker drops its WebSocket when idle and is fully gone when the
extension is closed. So when `/sign-request` finds **no live socket**, the
transporter sends a **Web Push (VAPID)** to the wallet's stored subscription
(`POST /push-subscription`). The wallet's SW wakes on the push, shows an OS
notification, and on open reconnects the WebSocket — the transporter then
flushes the full pending request. The push body carries `{ requestId, address,
payloadType, meta }` only — **never the XDR**.

## State (manifest §9)

`wallets` (incl. `pushSubscription`) · `pending` · `sockets` · `jwtSigningKey` ·
`identityKeypair` · `vapidKeys`. Sensitive: `totpSecret`, `jwtSigningKey`,
`vapidPrivateKey` — the things SEV-SNP protects. **No private key.**

## Deploy

AWS EC2 **M6a/C6a/R6a**, SEV-SNP enabled, Ubuntu 24.04. Attestation via
`snpguest`. Full runbook: [`docs/deploy-tee.md`](../../docs/deploy-tee.md).

## Source layout

`src/index.ts` wires the pieces; logic lives in `config`, `store`, `auth`
(TOTP + JWT), `attestation` (snpguest), `http` (`express` routes), `ws`
(`ws` gateway + keepalive), `push` (`web-push` offline delivery).
