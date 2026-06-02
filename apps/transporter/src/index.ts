/**
 * @wallet-mcp/transporter — Transporter (manifest Component 2)
 *
 * A pure relay + pairing authority + attestation server that runs INSIDE an
 * AWS AMD SEV-SNP confidential VM. It relays sign payloads between the Wallet
 * MCP and the user's Freighter wallet. It holds NO private key — only pairing
 * secrets (TOTP secret, JWT signing key), which SEV-SNP protects even from the
 * host operator.
 *
 * See: README.md, docs/api-transporter.md, docs/manifest.md §5 (Component 2),
 * §9 (API), §18 (TEE/attestation).
 *
 * HTTP endpoints to implement (manifest §9):
 *   POST   /register            { publicKey }            -> { walletId, totpSecret, walletToken }
 *   POST   /pair                { publicKey, totpCode }  -> { jwt }
 *   POST   /sign-request        (Bearer JWT)             -> { requestId }
 *   GET    /sign-request/:id    (Bearer JWT)             -> { status, result }
 *   POST   /sign-result         (walletToken)            -> { ok }
 *   GET    /attestation                                  -> { report, vlekCertChain, reportData }
 *
 * WebSocket: wss://<transporter>/ws?token=<walletToken>  (server -> wallet push)
 *
 * State model (manifest §9): wallets, pending, sockets, jwtSigningKey,
 * identityKeypair. NO private key in this model.
 *
 * Scaffold only — no implementation yet.
 */

export {};
