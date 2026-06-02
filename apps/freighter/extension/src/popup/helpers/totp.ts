// RFC 6238 TOTP, sıfır bağımlılık (Web Crypto / crypto.subtle).
// Backend (transporter) gelince yalnızca secret'ın kaynağı değişir; bu dosya aynı kalır.
// Transporter /pair çağrısında aynı totp(secret, ...) mantığını server-side doğrular.

const hmacSha1 = async (
  keyBytes: Uint8Array,
  msg: Uint8Array,
): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, msg);
  return new Uint8Array(sig);
};

const counterBytes = (counter: number): Uint8Array => {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 2 ** 32)); // high word (şimdilik 0)
  view.setUint32(4, counter >>> 0); // low word
  return new Uint8Array(buf);
};

interface TotpOptions {
  step?: number;
  digits?: number;
  now?: number;
}

export const totp = async (
  secret: Uint8Array,
  opts: TotpOptions = {},
): Promise<string> => {
  const step = opts.step ?? 30;
  const digits = opts.digits ?? 6;
  const now = opts.now ?? Date.now();

  const counter = Math.floor(now / 1000 / step);
  const hmac = await hmacSha1(secret, counterBytes(counter));

  // dynamic truncation (RFC 4226)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (bin % 10 ** digits).toString().padStart(digits, "0");
};

export const secondsRemaining = (step = 30, now = Date.now()): number =>
  step - (Math.floor(now / 1000) % step);

// Standart authenticator secret'ları Base32'dir. Backend Base32 dönerse kullan:
export const base32ToBytes = (b32: string): Uint8Array => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = b32
    .replace(/=+$/, "")
    .toUpperCase()
    .replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = alphabet.indexOf(c);
    if (idx === -1) {
      continue;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
};
