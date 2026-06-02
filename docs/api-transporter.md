# Transporter API contract

> Manifest §9. **This file is the source of truth** for the transporter HTTP +
> WebSocket interface. Because the apps are self-contained (no shared package),
> each app that speaks to the transporter keeps its own local copy of these
> types — keep them in sync with this file.
>
> All bodies are JSON. On error: `{ error }` + an appropriate HTTP code.

## `POST /register`

- Request: `{ "publicKey": "G..." }`
- Response: `{ "walletId": "uuid", "totpSecret": "base32", "walletToken": "opaque-long-secret" }`

## `WS wss://<transporter>/ws`

- Auth: `walletToken` (e.g. `?token=...`). Transporter maps the socket to `walletId`.
- Server → wallet push:
  ```json
  {
    "type": "sign_request",
    "requestId": "...",
    "payloadType": "auth_entry | xdr",
    "payload": "<xdr>",
    "meta": { "amount": "...", "asset": "USDC", "destination": "...", "description": "..." }
  }
  ```

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

- Auth: `walletToken`.
- Request: `{ "requestId": "...", "status": "signed | rejected", "signature": "<...> | null" }`

## `GET /attestation` (TEE proof, §18)

- Response: `{ "report": "<base64 SEV-SNP report>", "vlekCertChain": "<pem>", "reportData": "<hex; transporter identity pubkey hash>" }`
- Verifier: checks VLEK → AMD root chain and `reportData`.

## State model

- `wallets: { walletId, publicKey, totpSecret, walletToken }`
- `pending: { requestId, walletId, type, payload, meta, status, result, createdAt, expiresAt }`
- `sockets: walletId -> WebSocket`
- `jwtSigningKey`, `identityKeypair` (bound into attestation `reportData`)
- **No private key in this model.** Sensitive: `totpSecret`, `jwtSigningKey` —
  what SEV-SNP protects.
