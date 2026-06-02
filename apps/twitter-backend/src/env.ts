import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Eksik env değişkeni: ${name}`);
  return v;
}

// x402 bypass: true ise ödeme middleware'i hiç mount EDİLMEZ; tüm endpoint'ler
// ücretsiz çalışır (yalnızca dev/test — prod'da ASLA açma).
const X402_BYPASS =
  (process.env.X402_BYPASS ?? "false").toLowerCase() === "true";

export const env = {
  PORT: Number(process.env.PORT ?? 4021),
  X402_BYPASS,
  // x402 / Stellar
  NETWORK: process.env.STELLAR_NETWORK ?? "stellar:testnet",
  FACILITATOR_URL:
    process.env.FACILITATOR_URL ?? "https://www.x402.org/facilitator",
  // satıcının USDC alacağı Stellar G-adresi (bypass açıkken gerekmez)
  PAY_TO: X402_BYPASS ? (process.env.PAY_TO ?? "") : required("PAY_TO"),
  // Twitter API v2 (OAuth 1.0a user-context)
  TWITTER_APP_KEY: required("TWITTER_APP_KEY"),
  TWITTER_APP_SECRET: required("TWITTER_APP_SECRET"),
  TWITTER_ACCESS_TOKEN: required("TWITTER_ACCESS_TOKEN"),
  TWITTER_ACCESS_SECRET: required("TWITTER_ACCESS_SECRET"),
} as const;
