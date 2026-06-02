# Transporter deploy — AWS AMD SEV-SNP + attestation

> Manifest §18. The transporter runs inside an AMD SEV-SNP confidential VM so its
> relayed payloads and pairing secrets are protected even from the host operator,
> and `GET /attestation` proves it. **This is not AWS Nitro Enclaves** — don't mix
> the two attestation paths.

## Instance

- Types: **M6a / C6a / R6a** (e.g. `c6a.large`), in a supported region (tested
  example: **us-east-2**). AMI: **Ubuntu 24.04 LTS**.
- At launch: Advanced details → CPU options → **AMD SEV-SNP = Enabled**.
- Constraints: **incompatible with Dedicated Hosts**; memory is encrypted with an
  instance-specific key; on host maintenance you must **manually** stop/start to
  move to a new host (14-day notice).

## Attestation (with `snpguest`)

1. Build/install `snpguest` (AMD SEV-guest tools) in the guest.
2. Request a report:
   ```bash
   sudo ./snpguest report report.bin request-file.txt
   ```
   `request-file.txt` carries the 64-byte **REPORT_DATA** — put the
   **hash of the transporter's identity public key** (or a verifier nonce) here so
   the attestation binds to a specific transporter identity. (`--random` would use
   random report_data; we supply our own 64 bytes.)
3. Get certs: `sudo ./snpguest certificates pem ./` (VLEK etc. from host memory).
4. Download the VLEK root-of-trust chain from AMD:
   `https://kdsintf.amd.com/vlek/v1/Milan/cert_chain` ("Milan" = AMD EPYC Milan).
5. Verify (`snpguest` / `openssl`) that the report is signed by the VLEK and the
   VLEK chains to the AMD root. The **launch measurement** + **report_data** must
   match expectations.

## How it binds to our flow

- On boot the transporter generates an `identityKeypair`; `reportData = hash(identity pubkey)`.
- `GET /attestation` returns `{ report, vlekCertChain, reportData }`.
- A verifier checks the VLEK→AMD-root chain, checks the launch measurement against
  the expected value, and confirms `reportData` binds to the identity pubkey the
  transporter presents → concludes "this relay runs measured code, in a genuine
  SEV-SNP VM, under this identity."

## Honest limit (manifest §11)

Launch measurement covers the **initial image**, not running app state. To make it
meaningful: use a minimal/reproducible guest image, record the expected
measurement ahead of time, and bind the transporter identity into `reportData`.
For the demo, at minimum show memory-encryption + genuine-AMD + identity-binding.

## Phasing (manifest §13)

This is **Phase 3** — the last "wow". The architecture works without it (the trust
story is just weaker). If it fights back during the hackathon, cut it.
