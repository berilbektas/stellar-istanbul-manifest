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

## What we add to the fork (manifest §5, §7, §15 — TODO, not yet implemented)

1. **Register with the transporter** — on wallet create/select, `POST /register`,
   store `totpSecret` + `walletToken`, show the rotating 6-digit **TOTP** code.
2. **Persistent WebSocket** — connect to `wss://<transporter>/ws?token=…` to
   receive `sign_request` pushes.
   - ⚠️ MV3 service workers die when idle (manifest §15.3). Keep the socket on an
     open extension page (options/popup) or use `chrome.alarms` (~25s) keepalive +
     reconnect. **Test this early.**
3. **Approval screen** — render the incoming request human-readably
   (who / how much / which transaction) based on `payloadType` + `meta`;
   approve/reject.
4. **Signing on approve** — call the existing Freighter APIs:
   - x402 (auth entry): `signAuthEntry(preimageXdr)` → signature `Buffer`.
   - general tx (XDR): `signTransaction(xdr, opts)` → signed XDR.
   Then `POST /sign-result { requestId, status, signature }`.

## License

This fork remains under **Apache-2.0** — see `LICENSE` in this directory. Our own
monorepo code is MIT (root `LICENSE`).
