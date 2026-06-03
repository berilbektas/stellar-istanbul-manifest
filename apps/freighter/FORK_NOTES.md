# Freighter fork — notes

This directory is a **fork of [stellar/freighter](https://github.com/stellar/freighter)**
(Apache-2.0), vendored into the monorepo. It is manifest **Component 3** (§5): the
browser extension that holds the **private key** and shows the **approval UI**.

## Why forked (not from scratch)

Reuse the existing keypair management, Stellar integration, and **auth-entry
signing** infrastructure (manifest §5).

## Why it sits outside the Bun workspaces

Freighter is its **own Yarn-4 monorepo** (its own `package.json` workspaces,
`yarn.lock`, `.yarnrc.yml`, tsconfig, Webpack/Jest). It is deliberately kept
**out** of the root Bun `workspaces` and out of Biome's scope (see root
`biome.json`) — exactly how the router402 reference treats its forked apps. Work
on it with its own toolchain:

```bash
bun run freighter:install     # cd apps/freighter && yarn install
bun run freighter:build       # cd apps/freighter && yarn build:extension:production
# or directly:
cd apps/freighter && yarn install && yarn start   # dev build of the extension
```

Load the unpacked extension from `apps/freighter/build/` (see Freighter's own
`README.md` / `quick-start-guide.md`).

## What we add to the fork (manifest §5, §7, §15)

The integration lives in **`extension/src/background/transporter/`** (self-contained:
`config.ts`, `totp.ts`, `client.ts`, `storage.ts`, `bridge.ts`) plus three small
wiring edits. It **reuses Freighter's existing signing flow** rather than building a
parallel one: a `sign_request` is pushed onto the same queues a dApp uses and the
same approval popup is opened; on approve, Freighter's own handler signs with the
real key, and our `responseQueue` callback returns the signature to the transporter.

1. **Register** — `connectTransporter()` (on boot) calls `POST /register` for the
   active account, stores `totpSecret` + `walletToken` (per public key), and grants
   the agent origin in the allow-list once (so the approval Confirm button is
   enabled; every signature still needs per-request human approval, §11).
2. **Persistent WebSocket** — `wss://<transporter>/ws?token=…` receives
   `sign_request` pushes. MV3 (§15.3): a `chrome.alarms` (~30s) wakes the SW and
   `connectTransporter()` reconnects. *(Fallback if the SW proves too flaky: also
   hold the socket from an open popup/sidebar page.)*
3. **Approval screen** — reuses the existing `/sign-auth-entry` and
   `/sign-transaction` views (built `EntryToSign` / `TransactionInfo` payloads).
4. **Signing on approve** — the existing handlers sign; our callback formats and
   `POST /sign-result { requestId, status, signature }`.

### Signature format — verified to match `@x402/stellar` (`basicNodeSigner`)

This is the compatibility crux, checked byte-for-byte against the installed SDK:

- **auth_entry** → `signature = Buffer.from(keypair.sign(hash(preimageBytes))).toString("base64")`.
  Freighter's `signAuthEntry` handler already produces that signature `Buffer`; we
  base64 it (same as `freighterApiMessageListener` does for dApps).
- **xdr** → `signedTxXdr = TransactionBuilder.fromXDR(xdr, passphrase).sign(keypair).toXDR()`,
  which the handler already returns.

The transporter relays the string verbatim; the MCP's remote signer returns it as
`{ signedAuthEntry }` / `{ signedTxXdr }`, which `@x402/stellar` and Soroban RPC
submit consume directly.

### Wiring edits

- `export const openSigningWindow` in `messageListener/freighterApiMessageListener.ts`.
- `export { initTransporterBridge }` from `background/index.ts`; call it in
  `public/background.ts` `main()`.
- `manifest/{v3,v2}.json`: add `notifications` + transporter `host_permissions`.

### Build / verify (cannot run inside the Bun workspace)

```bash
bun run freighter:install          # yarn install (Yarn-4 toolchain)
cd apps/freighter && yarn start    # dev build; load unpacked from build/
```
Then: create/select a G-account → it auto-registers → read the rotating TOTP code →
pair via the MCP's `setup_wallet` → trigger `pay_x402` / `sign_transaction` → approve
in the popup. Over **http://localhost** the auth-entry view's SSL gate triggers —
enable "Allow non-SSL" in Freighter settings for local dev, or run the transporter
behind https.

### TOTP pairing code (implemented)

`extension/src/popup/components/TotpCode/` renders the rotating 6-digit code
(RFC 6238, matches the transporter's `otplib`) on the **account-details** screen
(`ViewPublicKey`), derived from the stored `totpSecret`. The user reads it and
types it into the agent's `setup_wallet`. Renders nothing until the account is
registered with a transporter.

### Offline Web Push (implemented — Chrome MV3; manifest §15.3)

Verified against Chrome's docs: a Chrome MV3 extension **service worker** can use
the **standard Web Push API** (`pushManager.subscribe` with the VAPID
`applicationServerKey`) and a top-level `push` listener that **wakes a suspended/
terminated SW** — no `chrome.gcm` needed; only the `notifications` permission
(already present). Our transporter is already a compliant `web-push`/VAPID server.

Flow: on connect (and at SW boot, independent of unlock) the bridge subscribes
and POSTs the subscription to `POST /push-subscription`. When the socket is dead,
the transporter sends a payload-less `sign_request` push (with a TTL = the
request's remaining lifetime). The SW's `push` handler **always** shows a
notification (required by `userVisibleOnly:true`) and reconnects the WebSocket —
the transporter then **flushes the full pending request (with XDR)** over the
socket, which opens the existing approval popup. `notificationclick` reconnects +
focuses a window.

- Code: `src/background/transporter/bridge.ts` (`ensurePushSubscription`,
  `initTransporterPush` with the `push`/`notificationclick` listeners),
  `client.ts` (`SignRequestNotification`, `postPushSubscription`),
  `storage.ts` (`getAllRegistrations`). Wired at top level in
  `public/background.ts` `main()` (before the bridge).
- **Honest limit:** works whenever Chrome is running (windowed OR
  windowless/background). If Chrome is **fully quit**, no SW runs — the push
  service queues per TTL and delivers at next launch (best-effort). Treat the
  notification as best-effort; the MCP/agent re-surfaces a pending request on
  next interaction so an approval is never silently lost.
- **Firefox (v2):** no extension Web Push (the background is a page, not a SW);
  `initTransporterPush()` no-ops there. Firefox relies on the WS path while the
  browser is open.

## License

This fork remains under **Apache-2.0** — see `LICENSE` in this directory. Our own
monorepo code is MIT (root `LICENSE`).
