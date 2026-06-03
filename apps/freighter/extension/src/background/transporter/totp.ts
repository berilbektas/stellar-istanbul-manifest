/**
 * Minimal RFC 6238 TOTP (SHA-1, 6 digits, 30s step) using Web Crypto.
 *
 * Used to show the rotating pairing code in the wallet (manifest §7 Flow A.4):
 * the user reads it and types it into the MCP's `setup_wallet`. The transporter
 * verifies it with `otplib` (same algorithm/defaults), so this must match
 * otplib's authenticator: base32 secret, SHA-1, 6 digits, 30s.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** Current 6-digit TOTP code for a base32 secret (manifest §7). */
export async function totpCode(
  secretBase32: string,
  now: number = Date.now(),
  stepSeconds = 30,
  digits = 6,
): Promise<string> {
  const counter = Math.floor(now / 1000 / stepSeconds);

  // 8-byte big-endian counter.
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }

  const keyBytes = base32Decode(secretBase32);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));

  // RFC 4226 dynamic truncation.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** Seconds remaining until the current code rotates. */
export function totpSecondsRemaining(now: number = Date.now(), stepSeconds = 30) {
  return stepSeconds - (Math.floor(now / 1000) % stepSeconds);
}
