/**
 * Pairing-credential storage (manifest §5).
 *
 * The JWT is written to `~/.wallet-mcp/creds.json` (dir 0700, file 0600), NOT
 * the MCP config — so pairing needs no MCP restart. Contains no private key.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Creds } from "./types.js";

const CREDS_DIR = join(homedir(), ".wallet-mcp");
const CREDS_PATH = join(CREDS_DIR, "creds.json");

export function credsPath(): string {
  return CREDS_PATH;
}

/** Read creds, or null if absent/unreadable/malformed. */
export async function readCreds(): Promise<Creds | null> {
  try {
    const raw = await readFile(CREDS_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Creds).jwt === "string" &&
      typeof (parsed as Creds).publicKey === "string"
    ) {
      return parsed as Creds;
    }
    return null;
  } catch {
    return null;
  }
}

/** Write creds with restrictive permissions (0700 dir, 0600 file). */
export async function writeCreds(creds: Creds): Promise<void> {
  await mkdir(dirname(CREDS_PATH), { recursive: true, mode: 0o700 });
  await writeFile(CREDS_PATH, `${JSON.stringify(creds, null, 2)}\n`, {
    mode: 0o600,
  });
}
