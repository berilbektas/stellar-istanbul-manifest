# Transporter API contract

> Manifest §9. **This file is the source of truth** for the transporter HTTP +
> WebSocket interface. Because the apps are self-contained (no shared package),
> each app that speaks to the transporter keeps its own local copy of these
> types — keep them in sync with this file.
>
> All bodies are JSON. On error: `{ error }` + an appropriate HTTP code.

## `POST /register`

- Request: `{ "publicKey": "G..." }`
- Response: `{ "walletId": "uuid", "totpSecret": "base32", "walletToken": "opaque-long-secret", "vapidPublicKey": "base64url" }`
- `vapidPublicKey` is the application server key the wallet's service worker uses
  to subscribe to Web Push (see `POST /push-subscription`).

## `WS wss://<transporter>/ws`

- Auth: `walletToken` (e.g. `?token=...`). Transporter maps the socket to `walletId`.
- Server → wallet push:
  ```json
  {
    "type": "sign_request",
    "requestId": "...",
    "address": "G...",
    "payloadType": "auth_entry | xdr",
    "payload": "<xdr>",
    "meta": { "amount": "...", "asset": "USDC", "destination": "...", "description": "..." }
  }
  ```
- `address` is the G-account that must sign — a multi-account wallet (or a
  service worker just woken by a push) uses it to pick the right key.

## `GET /push/vapid-public-key`

- Response: `{ "vapidPublicKey": "base64url" }` — same key as in `/register`,
  for a wallet that re-subscribes without re-registering.

## `POST /push-subscription` (from the wallet)

- Auth: `walletToken` (header `X-Wallet-Token`, or `walletToken` in the body).
- Request: `{ "subscription": { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." }, "expirationTime": null } }`
- Response: `{ "ok": true }`
- Stores the wallet's Web Push subscription so the transporter can wake a
  **closed** extension when no live WebSocket exists (manifest §15.3). The push
  body carries `{ type, requestId, address, payloadType, meta }` — **no XDR**;
  the woken SW reconnects the WebSocket and the transporter flushes the full
  pending request.

## `POST /pair`

- Request: `{ "publicKey": "G...", "totpCode": "123456" }`
- Response: `{ "jwt": "..." }`

## `POST /sign-request`

- Header: `Authorization: Bearer <jwt>`
- Request: `{ "type": "auth_entry | xdr", "payload": "<xdr>", "meta": { ... } }`
- Response: `{ "requestId": "..." }`

## `GET /sign-request/:requestId`

- Header: `Authorization: Bearer <jwt>`
- Response: `{ "status": "pending | signed | rejected | expired", "result": "<signature/signedXdr | null>" }`

## `POST /sign-result` (from the wallet)

- Auth: `walletToken` (header `X-Wallet-Token`, or `walletToken` in the body).
- Request: `{ "requestId": "...", "status": "signed | rejected", "signature": "<...> | null" }`

## `GET /attestation` (TEE proof, §18)

- Response: `{ "report": "<base64 SEV-SNP report>", "vlekCertChain": "<pem>", "reportData": "<hex; transporter identity pubkey hash>" }`
- Verifier: checks VLEK → AMD root chain and `reportData`.

## State model

- `wallets: { walletId, publicKey, totpSecret, walletToken, pushSubscription? }`
- `pending: { requestId, walletId, type, payload, meta, status, result, createdAt, expiresAt }`
- `sockets: walletId -> WebSocket`
- `jwtSigningKey`, `identityKeypair` (bound into attestation `reportData`)
- `vapidKeys` (public + private) for Web Push
- **No private key in this model.** Sensitive: `totpSecret`, `jwtSigningKey`,
  `vapidPrivateKey` — what SEV-SNP protects.
