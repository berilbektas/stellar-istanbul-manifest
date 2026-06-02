# Security Policy

Wallet MCP exists to *remove* a security anti-pattern: pasting a blockchain
private key into an agent's / MCP's config. The whole architecture is a threat
model. See [`docs/manifest.md`](docs/manifest.md) §11 for the full treatment.

## Trust boundaries (where secrets live)

| Component        | Private key | TOTP secret | JWT                       | Runs in                |
| ---------------- | ----------- | ----------- | ------------------------- | ---------------------- |
| Wallet MCP       | No          | No          | JWT **token** in creds    | Agent host             |
| Transporter      | **No**      | Yes         | JWT **signing key**       | AWS AMD SEV-SNP VM     |
| Freighter (fork) | **Yes**     | Yes         | No                        | Browser extension      |
| Mock Twitter MCP | No          | No          | No                        | Local process          |

- **The private key never leaves Freighter.** Not the agent, not the MCP, not
  the transporter, not the resource server ever touch it.
- **The transporter is a pure relay**, but it does see the payload + meta it
  relays. That is why it runs inside an **AMD SEV-SNP** confidential VM: memory
  is encrypted against the host operator, and `GET /attestation` proves the
  measured code is running in a genuine TEE (§18).
- **Pairing requires a live TOTP code**, not just a public key — proof of
  current wallet access. The resulting JWT is signed by the transporter.
- **Every signature requires explicit human approval** in the wallet. An agent
  can never produce a signature on its own.

## Reporting a vulnerability

This is a hackathon project. Open a private security advisory or email the
maintainers; do not file a public issue for anything exploitable.

## Never commit

- Secret keys (`S...`), `creds.json`, `.env` files, TOTP secrets, JWT signing
  keys, or attestation private material. These are git-ignored — keep it that
  way.
