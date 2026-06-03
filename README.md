![Manifest](./assets/banner.png)

[How It Works](#-how-it-works) • [Architecture](#️-architecture) • [Tech Stack](#️-tech-stack) • [Quick Start](#-quick-start) • [Tracks](#-track-submissions)

---

Manifest is a **remote signer for AI agents** on Stellar. When an agent needs to make an on-chain payment via x402, the request lands in **your own wallet** — not in a `.env` file, not in the MCP config, not in agent memory. You approve in one tap, the agent keeps working, and your private key never leaves Freighter.

---

## 🪪 MANIFEST — 1Password for Agent Payments

### 🔴 The Problem

The current x402 + MCP stack asks you to paste `STELLAR_PRIVATE_KEY=S...` into your agent's config — *the same key that holds all your funds*. The official Stellar x402 quickstart literally ships this pattern with a warning: "testnet hot wallets only."

But the moment any agent or MCP holds your key, payments and code execution share the same trust domain. A compromised extension, a leaked `.env`, a malicious dependency — and the wallet is drained.

In H1 2025 alone, **$2.1B** was stolen in crypto. **80%** of it came from private-key compromise. Last year, **39M** secrets leaked on GitHub.

The pattern is the product. Every MCP that asks for a private key is one bad extension away.

## 💡 The Solution

Manifest replaces the local signer in the x402 client with a remote signer that lives in your own browser wallet. Agents still pay autonomously — they just no longer need the key.

The agent sees the same x402 interface. The signature comes from a forked Freighter extension, brokered by a relay running inside an AMD SEV-SNP confidential VM. The private key never moves.

---

## ⚡ How It Works

1. 🤖 **Agent hits a paid endpoint** → server responds with `402 + PAYMENT-REQUIRED`
2. 🔌 **Wallet MCP** builds the Soroban auth-entry preimage — no key needed
3. 🛡️ **Transporter** (inside TEE) pushes the request to your browser wallet
4. 🦊 **Freighter** shows you the amount, asset, destination — you tap approve
5. ✅ **USDC settles** on Stellar in ~5 seconds, fee sponsored

### 🔧 Under the Hood (~7 seconds end-to-end)

```
Agent calls pay_x402(url)
  → Wallet MCP receives 402 + PAYMENT-REQUIRED headers
  → Builds Soroban auth-entry preimage (XDR)
  → POST /sign-request to Transporter (JWT-authed)
  → Transporter pushes via WebSocket to Freighter
  → User sees: "$0.05 USDC → post_tweet" → taps approve
  → Freighter calls signAuthEntry(preimage) locally
  → Signature returns through Transporter to MCP
  → MCP retries request with PAYMENT-SIGNATURE header
  → Facilitator verifies + settles on Stellar (fee sponsored)
  → Resource server returns 200 + PAYMENT-RESPONSE
```

> The private key never leaves the browser. The agent never sees it. The relay never sees it.

---

## 🏗️ Architecture

```
┌──────────────────────────┐                  ┌──────────────────────┐
│   Agent Host             │                  │   AWS EC2            │
│   (Claude Desktop)       │                  │   AMD SEV-SNP VM     │
│                          │   POST /sign     │                      │
│   ┌──────────────────┐   │   request        │   ┌──────────────┐   │
│   │  Wallet MCP      │───┼─────────────────►│   │ Transporter  │   │
│   │  (no keys)       │   │   GET /poll      │   │ relay+pair   │   │
│   └──────────────────┘   │                  │   │ +attestation │   │
│                          │                  │   └──────┬───────┘   │
│   ┌──────────────────┐   │                  └──────────┼───────────┘
│   │  Mock Twitter    │   │                             │ WebSocket
│   │  x402 MCP        │   │                             ▼
│   └──────────────────┘   │                  ┌──────────────────────┐
└──────────────────────────┘                  │   Browser            │
              ▲                                │   ┌──────────────┐  │
              │ HTTP 402                       │   │  Forked      │  │
              │ + signatures                   │   │  Freighter   │  │
              │                                │   │  🔑 key here │  │
              ▼                                │   └──────┬───────┘  │
┌──────────────────────────┐                  └──────────┼──────────┘
│   Stellar Testnet        │                             │
│   Facilitator (Coinbase) │                             │ user tap
│   → SEP-41 USDC settle   │                             │ approves
│   → fee sponsored        │                             ▼
│   → ~5s finality         │
└──────────────────────────┘
```

The transporter is **memory-encrypted** (SEV-SNP) and serves an attestation report. Even the AWS operator cannot read the payloads it relays.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| ⛓️ **Blockchain** | Stellar Testnet + Soroban | ~5s finality, fee sponsoring, SEP-41 USDC |
| 💸 **Payment Protocol** | x402 (Coinbase / SDF) | HTTP 402-based agentic payments |
| 📦 **x402 Stack** | `@x402/core` `@x402/fetch` `@x402/stellar` `@x402/express` | Client + server middleware |
| 🌟 **Stellar SDK** | `@stellar/stellar-sdk` | `authorizeEntry`, XDR, RPC submit |
| 🔌 **Agent Protocol** | Model Context Protocol (MCP) | Stdio transport, `@modelcontextprotocol/sdk` |
| 🦊 **Wallet** | Forked Freighter Extension | `signAuthEntry` + `signTransaction` |
| 🛡️ **TEE** | AWS EC2 (M6a/C6a/R6a) + AMD SEV-SNP | Memory-encrypted relay, attestation |
| 🔐 **Identity** | TOTP (`otplib`) + JWT (`jsonwebtoken`) | Pairing + session auth |
| 🔄 **Transport** | Express HTTP + `ws` WebSocket | MCP↔Transporter↔Wallet |
| 💵 **Facilitator** | Coinbase x402 Testnet | `https://www.x402.org/facilitator` |

---

## ✨ Key Features

🔑 **Zero Key Custody for Agents** — The agent host, the MCP server, and the relay never see the private key. It lives in Freighter alone. The `.env` antipattern is gone.

✍️ **Per-Transaction Approval** — Every signature shows the user amount, asset, destination, and description in Freighter. No batch signing, no blanket allowances, no silent transfers.

🛡️ **TEE-Encrypted Relay** — Transporter runs inside an AMD SEV-SNP confidential VM. Memory is encrypted with an instance-bound key. The AWS operator cannot read the payloads it routes.

🪪 **Attestation Endpoint** — `GET /attestation` returns an AMD-signed report binding the transporter's identity to its launch measurement. Clients can verify they're talking to attested code, not a tampered relay.

🔐 **TOTP-Bound Pairing** — Agent only talks to your wallet after you prove ownership with a 6-digit rotating code. Public key alone isn't enough.

⚡ **Native x402 + USDC Settlement** — Built on Stellar's official agentic payments protocol. SEP-41 USDC settles in ~5 seconds. Fee sponsored — user holds zero XLM.

🔄 **Async-Safe Signer** — The remote signer is asynchronous by design (it waits on a human). Drops directly into `ExactStellarScheme`, or falls back to manual `authorizeEntry` for full control.

---

## 🛡️ Security Model

| Layer | Approach |
| --- | --- |
| 🔑 **Private Key** | Lives only in Freighter. Not in `.env`, not in MCP config, not in agent memory, not on the relay. |
| 🛡️ **Relay Operator** | Transporter inside SEV-SNP. Memory-encrypted, attestable. AWS itself cannot read payloads. |
| 🔁 **Replay** | Soroban auth entries carry unique nonces + `expirationLedger` (~60 ledgers ≈ 5min). MCP requests have `expiresAt`. |
| 🪪 **Pairing** | TOTP (30s rotating) proves real-time wallet ownership. JWTs are transporter-signed, bound to `walletId`. |
| 👁️ **Silent Abuse** | Per-transaction approval in Freighter. Amount + asset + destination visible before sign. No blanket approvals. |
| 📏 **TEE Limits** | Launch measurement covers boot image, not running state. We use a minimal reproducible image + bind transporter identity into `REPORT_DATA`. |

---

## 📁 Project Structure

```
manifest/
├── wallet-mcp/              # Agent-side MCP server (stdio)
│   ├── src/
│   │   ├── tools/           # setup_wallet, pay_x402, sign_transaction
│   │   ├── signer.ts        # Remote signer for @x402/stellar
│   │   └── creds.ts         # ~/.wallet-mcp/creds.json reader
│   └── package.json
├── transporter/             # TEE relay (Express + ws)
│   ├── src/
│   │   ├── routes/          # /register /pair /sign-request /attestation
│   │   ├── ws.ts            # Persistent wallet sockets
│   │   ├── attestation.ts   # snpguest wrapper
│   │   └── state.ts         # In-memory state — no key material
│   └── deploy/sev-snp.md    # AWS deploy walkthrough
├── freighter-fork/          # Forked Freighter extension
│   ├── src/
│   │   ├── popup/           # Approval UI
│   │   ├── background/      # WebSocket + MV3 keepalive
│   │   └── pairing/         # /register + TOTP display
│   └── manifest.json
├── mock-twitter-mcp/        # Demo x402 resource server
│   └── src/server.ts        # read_timeline (free), post_tweet (paid)
└── docs/
    ├── architecture.mermaid
    ├── threat-model.md
    └── attestation.md
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js v20+, npm
- Claude Desktop (or any MCP-compatible host)
- Chrome / Brave / Edge (for the wallet extension)
- A Stellar testnet account with USDC trustline

### Stellar Testnet Setup

```bash
# 1. Create a Stellar testnet keypair (Stellar Lab or Freighter)
#    https://laboratory.stellar.org

# 2. Fund with testnet XLM
curl "https://friendbot.stellar.org/?addr=<YOUR_G_ADDRESS>"

# 3. Establish a USDC trustline (Circle's testnet issuer)
#    Issuer: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5

# 4. Get testnet USDC from Circle faucet
#    https://faucet.circle.com → select "Stellar Testnet"
```

### Transporter (TEE Relay)

```bash
cd transporter
cp .env.example .env  # set JWT_SECRET, PORT
npm install
npm run dev
```

For production deployment to AWS SEV-SNP, see `transporter/deploy/sev-snp.md`.

### Wallet MCP

```bash
cd wallet-mcp
npm install
npm run build
```

Then in your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wallet": {
      "command": "node",
      "args": ["/absolute/path/to/manifest/wallet-mcp/dist/index.js"],
      "env": {
        "TRANSPORTER_URL": "https://transporter.manifest.dev"
      }
    },
    "twitter": {
      "command": "node",
      "args": ["/absolute/path/to/manifest/mock-twitter-mcp/dist/index.js"]
    }
  }
}
```

> No `STELLAR_PRIVATE_KEY` anywhere — that's the whole point.

### Freighter Fork

```bash
cd freighter-fork
npm install
npm run build
# Load unpacked extension from dist/ in chrome://extensions
```

### First-Time Pairing

1. Open the forked Freighter extension → create or import a G-account
2. Freighter shows a 6-digit TOTP code that rotates every 30 seconds
3. In Claude, run: `setup_wallet(publicKey, totpCode)`
4. JWT is written to `~/.wallet-mcp/creds.json` — no restart needed

### Make a Payment

```
You:    "Post a tweet that says hello"
Claude: → calls post_tweet (mock Twitter MCP)
        → gets 402 + PAYMENT-REQUIRED
        → calls pay_x402(...)
        → Freighter pops up: "$0.05 USDC → post_tweet — approve?"
You:    [tap approve]
Claude: ← signed, retried, settled
        "Tweet posted ✓"
```

---

## 🔄 Three Flows

### A. Registration (per wallet, once)

1. User opens forked Freighter → creates G-account
2. Wallet calls `POST /register { publicKey }` to transporter
3. Transporter generates `totpSecret`, `walletId`, `walletToken`
4. Wallet stores `totpSecret`, displays rotating 6-digit code
5. Wallet opens persistent WebSocket to `/ws?token=<walletToken>`

### B. Pairing (per agent host, once)

1. User invokes `setup_wallet(publicKey, totpCode)` in Claude
2. MCP calls `POST /pair` with publicKey + TOTP code
3. Transporter verifies code against stored secret
4. Returns JWT, MCP writes it to `~/.wallet-mcp/creds.json`

### C. Signing (every transaction)

1. Agent calls `pay_x402(url)` or `sign_transaction(xdr)`
2. MCP `POST /sign-request` (Bearer JWT) with payload + meta
3. Transporter pushes to wallet via WebSocket
4. MCP polls `GET /sign-request/:id` (60–90s timeout)
5. User reviews payload in Freighter, taps approve
6. Freighter signs with real key, `POST /sign-result`
7. MCP receives signature, returns to agent

---

## ⚠️ Critical Gotchas

These bit us during the build. Documented so they don't bite you.

- **Auth-entry expiration window** — `signatureExpirationLedger` must cover human approval time. We use ~60 ledgers (~5 min). Too short and the signature is stale by tap time.
- **Async signer required** — Remote signing waits on a human. The `@x402/stellar` scheme must accept an async `signer`, or fall back to manual `authorizeEntry`.
- **MV3 service worker WebSockets** — Chrome MV3 kills idle service workers. Keep the wallet's persistent socket in an open extension page or use `chrome.alarms` for ~25s keepalives.
- **USDC trustline required** — Without it, settlement fails. Trustline first, faucet second.
- **Testnet fee = 1 stroop** — Facilitator testnet limits require rebuilding payload tx with `fee: "1"`. The Stellar quickstart does this; copy that.
- **Use Soroban RPC, not Horizon** — And include `sorobanData` on rebuilt operations.
- **SEV-SNP constraints** — M6a/C6a/R6a only, specific regions, incompatible with Dedicated Hosts.

---

## 📡 API Reference

The transporter exposes a minimal HTTP + WebSocket surface:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/register` | POST | Wallet creates account, gets TOTP secret + walletToken |
| `/ws` | WS | Persistent wallet socket (walletToken auth) |
| `/pair` | POST | MCP exchanges publicKey + TOTP code → JWT |
| `/sign-request` | POST | MCP submits sign payload (Bearer JWT) |
| `/sign-request/:id` | GET | MCP polls for signature result |
| `/sign-result` | POST | Wallet submits signed result (walletToken auth) |
| `/attestation` | GET | AMD-signed SEV-SNP attestation report |

Full schemas in `docs/api.md`.

---

## 🦊 MCP Tools

The Wallet MCP exposes four tools to the agent:

| Tool | Signature | Purpose |
| --- | --- | --- |
| `setup_wallet` | `(publicKey, totpCode) → { ok }` | One-time pairing with transporter |
| `wallet_status` | `() → { paired, publicKey? }` | Check creds + JWT |
| `pay_x402` | `(url, method?, body?) → { resource, receipt }` | Drive x402 flow with remote signer |
| `sign_transaction` | `(xdr, submit?) → { signedXdr? \| txHash? }` | Generic Soroban signing |

---

## 👥 Team

Built at **Build on Stellar Hackathon** — Istanbul Blockchain Week 2026, 36 hours.

- **Feyyaz Numan Cavlak** — Wallet MCP, Transporter, x402 integration
- **Beril Bektaş** — Threat model, cryptography review, attestation design
- **Barış Bice** — Forked Freighter, approval UI, MV3 socket plumbing
- **Ömer Furkan Yürük** — Soroban contracts, TEE deployment, infrastructure

---

## 🏆 Track Submissions

### 🌟 Main Track — Build on Stellar

A novel infrastructure piece for Stellar's agentic payments ecosystem. Replaces the unsafe `STELLAR_PRIVATE_KEY=S...` pattern in x402 quickstarts with a wallet-resident signer, using primitives only Stellar offers: Soroban auth-entry signing, fee sponsoring, ~5s finality, and SEP-41 USDC settlement. Ships with a forked Freighter extension and a TEE-deployed relay.

### 🤖 Hack Agentic Track

An autonomous agent that pays for x402-protected resources without ever holding the private key. Agent reads 402 responses, parses `PAYMENT-REQUIRED` headers, builds Soroban auth-entry preimages, calls the async wallet signer, retries with `PAYMENT-SIGNATURE`, and continues end-to-end — the only human moment is the approval tap. Compromised agent ≠ drained wallet, by design.

---

## 📚 References

**Stellar & x402**
- [x402 on Stellar](https://developers.stellar.org/docs/build/agentic-payments/x402)
- [Built on Stellar facilitator (OpenZeppelin)](https://developers.stellar.org/docs/build/agentic-payments/x402/built-on-stellar)
- [x402 Quickstart Guide](https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide)
- [Stellar x402 reference repo](https://github.com/stellar/x402-stellar)
- [Signing Soroban invocations](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations)

**Freighter**
- [Sign auth entries](https://developers.stellar.org/docs/build/guides/freighter/sign-auth-entries)
- [Sign Soroban XDRs](https://developers.stellar.org/docs/build/guides/freighter/sign-soroban-xdrs)

**Confidential Compute**
- [AMD SEV-SNP](https://www.amd.com/en/developer/sev.html)
- [AWS EC2 SEV-SNP user guide](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/sev-snp.html)
- [`snpguest` attestation tool](https://github.com/virtee/snpguest)

**Standards**
- [Model Context Protocol](https://modelcontextprotocol.io)
- [x402 protocol](https://www.x402.org)
- [SEP-41 token interface](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)

---

## 📄 License

MIT © 2026 Manifest team.
