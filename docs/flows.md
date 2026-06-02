# Flows

> Manifest §7 & §8, verbatim intent. Three flows: register, pair, sign.

## A — Registration (once per wallet)

1. User opens the forked Freighter, creates/selects a G-account.
2. Wallet calls `POST /register { publicKey }`.
3. Transporter generates `totpSecret`, `walletId`, `walletToken`; stores; returns.
4. Wallet stores `totpSecret`, starts showing a 6-digit code rotating every 30s.
5. Wallet opens a persistent WebSocket with `walletToken`:
   `wss://<transporter>/ws?token=…`. Transporter maps the socket to the wallet.

## B — Pairing (once per agent)

1. User triggers `setup_wallet` in Claude.
2. MCP asks for the **public key** + the wallet's **6-digit TOTP code**.
3. MCP calls `POST /pair { publicKey, totpCode }`.
4. Transporter finds the wallet by `publicKey`, verifies the code against the
   stored secret.
5. On success it mints a **JWT** (walletId/publicKey, signed with the transporter
   key) and returns it.
6. MCP writes the JWT to `~/.wallet-mcp/creds.json`. No restart needed.

## C — Signing (every transaction)

1. Agent calls `pay_x402(...)` or `sign_transaction(...)`.
2. MCP `POST /sign-request` (Bearer JWT) with the payload + human-readable meta.
3. Transporter verifies the JWT → resolves walletId → pushes to the live WS →
   creates a pending record. Returns `{ requestId }`.
4. MCP polls `GET /sign-request/:requestId` (60–90s timeout).
5. User reviews in the wallet (who / how much / which tx), approves/rejects. On
   approve, Freighter signs with the real key.
6. Wallet returns `POST /sign-result { requestId, status, signature }`.
7. Transporter updates the pending record; the MCP's poll picks up the result.
8. MCP returns the signed payload to the agent (x402: retry; general tx: submit).

## x402 end-to-end (manifest §8)

`pay_x402(url)`:

1. x402 client requests `url`.
2. Server returns **402 + `PAYMENT-REQUIRED`** (price, network, facilitator URL).
3. x402 client builds the payload via `createPaymentPayload`; for the signature it
   calls the **remote signer** → MCP `POST /sign-request`
   (`type=auth_entry`, `payload=preimage XDR`, `meta={amount, asset, destination, description}`).
4. Transporter → Freighter WS push.
5. User approves → Freighter `signAuthEntry(preimageXdr)` → `POST /sign-result`.
6. Signature flows transporter → MCP → x402 client.
7. **Testnet fee fix:** rebuild the payload tx with `fee="1"`. Client retries with
   the **`PAYMENT-SIGNATURE`** header.
8. Server verifies + settles via the **facilitator** (fee sponsored).
9. Facilitator settles **USDC** on Stellar testnet.
10. Server returns the resource + **`PAYMENT-RESPONSE`** → MCP returns to the agent.

### General transaction (`sign_transaction`)

Steps 1–2 and 7–10 drop out. The MCP builds the XDR itself, has Freighter sign it
via `signTransaction(xdr)` (Flow C 3–6), then submits the signed XDR to Soroban
RPC (or returns it), per the `submit` flag. Same signing channel, different end.
