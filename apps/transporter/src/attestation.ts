/**
 * TEE attestation (manifest §18). Best-effort.
 *
 * On boot the transporter generates an ephemeral `identityKeypair`; the SEV-SNP
 * `REPORT_DATA` is `sha-512(identity public key)`, binding the attestation to
 * this transporter identity. `GET /attestation` runs `snpguest` to fetch a
 * report + VLEK cert chain.
 *
 * Outside a SEV-SNP VM (local dev) `snpguest` is absent, so we return
 * `available: false` with the report/chain null but the `reportData` still
 * present. Attestation is Phase 3 (manifest §13) — the system works without it,
 * the trust story is just weaker. So failures here never crash the server.
 */

import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AttestationResponse } from "./types.js";

const execFileAsync = promisify(execFile);

export class Attestation {
  private readonly publicKey: KeyObject;
  /** hex sha-512 of the identity public key (64 bytes → SEV-SNP REPORT_DATA). */
  readonly reportData: string;

  constructor(private readonly snpguestBin: string) {
    const { publicKey } = generateKeyPairSync("ed25519");
    this.publicKey = publicKey;
    const der = publicKey.export({ type: "spki", format: "der" });
    this.reportData = createHash("sha512").update(der).digest("hex");
  }

  /** PEM of the identity public key, for a verifier to recompute reportData. */
  identityPublicKeyPem(): string {
    return this.publicKey.export({ type: "spki", format: "pem" }).toString();
  }

  /**
   * Produce an attestation. Tries `snpguest`; on any failure returns a
   * non-available response carrying just `reportData`.
   */
  async produce(): Promise<AttestationResponse> {
    let dir: string | undefined;
    try {
      dir = await mkdtemp(join(tmpdir(), "snp-"));
      const reportPath = join(dir, "report.bin");
      const requestPath = join(dir, "request.txt");

      // request-file carries our 64-byte REPORT_DATA (manifest §18 step 2).
      await writeFile(requestPath, Buffer.from(this.reportData, "hex"));
      await execFileAsync(this.snpguestBin, [
        "report",
        reportPath,
        requestPath,
      ]);
      await execFileAsync(this.snpguestBin, ["certificates", "pem", dir]);

      const report = await readFile(reportPath);
      const vlekCertChain = await readFile(join(dir, "vlek.pem"), "utf8").catch(
        () => null
      );

      return {
        report: report.toString("base64"),
        vlekCertChain,
        reportData: this.reportData,
        available: true,
      };
    } catch {
      return {
        report: null,
        vlekCertChain: null,
        reportData: this.reportData,
        available: false,
      };
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
