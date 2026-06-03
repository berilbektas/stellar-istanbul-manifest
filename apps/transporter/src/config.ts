/**
 * Transporter configuration (manifest §5, §9, §18).
 *
 * Reads from the environment (see `.env.example`). The JWT signing key is
 * sensitive (manifest §6): in production it is generated at boot INSIDE the
 * SEV-SNP VM. For local dev a static value may be supplied via `JWT_SIGNING_KEY`
 * — if absent we generate an ephemeral key and warn (JWTs won't survive a
 * restart).
 */

import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import webpush from "web-push";

dotenv.config();

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveJwtKey(): { key: string; ephemeral: boolean } {
  const fromEnv = process.env.JWT_SIGNING_KEY;
  if (fromEnv && fromEnv.length > 0) {
    return { key: fromEnv, ephemeral: false };
  }
  // No key supplied: generate one at boot (production TEE behaviour, §6).
  return { key: randomBytes(48).toString("base64url"), ephemeral: true };
}

function resolveVapidKeys(): {
  publicKey: string;
  privateKey: string;
  ephemeral: boolean;
} {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) {
    return { publicKey, privateKey, ephemeral: false };
  }
  // No keys supplied: generate a pair at boot. NOTE: the public key is baked
  // into each wallet's push subscription, so rotating it (a restart) makes
  // existing subscriptions fail with 403 — set VAPID_* in prod (manifest §6).
  const generated = webpush.generateVAPIDKeys();
  return { ...generated, ephemeral: true };
}

const jwt = resolveJwtKey();
const vapid = resolveVapidKeys();

export const config = {
  /** HTTP + WebSocket port. */
  port: int("PORT", 8787),

  /** Symmetric HS256 key for pairing JWTs (manifest §6). */
  jwtSigningKey: jwt.key,
  /** True when the key was generated at boot (won't survive restart). */
  jwtKeyEphemeral: jwt.ephemeral,
  /** JWT lifetime. The token lives in `~/.wallet-mcp/creds.json` (manifest §5). */
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "30d",

  /** TOTP tolerance in 30s steps either side (manifest §7 Flow B). */
  totpWindow: int("TOTP_WINDOW", 1),

  /** Pending sign-request TTL (ms) — must cover human approval (§7, §15). */
  signRequestTtlMs: int("SIGN_REQUEST_TTL_MS", 90_000),

  /** WebSocket keepalive ping interval (ms) — counters dead sockets (§15.3). */
  wsPingIntervalMs: int("WS_PING_INTERVAL_MS", 25_000),

  /** Path to the `snpguest` binary on the VM (manifest §18). */
  snpguestBin: process.env.SNPGUEST_BIN ?? "/usr/local/bin/snpguest",

  /** VAPID keys for Web Push (offline notification). Private key is sensitive. */
  vapidPublicKey: vapid.publicKey,
  vapidPrivateKey: vapid.privateKey,
  vapidKeyEphemeral: vapid.ephemeral,
  /** VAPID `sub` claim — a mailto:/URL contact for the push service. */
  vapidSubject:
    process.env.VAPID_SUBJECT ?? "mailto:transporter@wallet-mcp.invalid",

  /**
   * DEV ONLY: when set, push a canned test `sign_request` to each wallet a few
   * seconds after it connects, so the wallet approval UI can be exercised
   * without the full MCP + x402 flow. Off in production.
   */
  devTestSign:
    process.env.DEV_TEST_SIGN === "1" ||
    process.env.DEV_TEST_SIGN?.toLowerCase() === "true",
  devTestSignDelayMs: int("DEV_TEST_SIGN_DELAY_MS", 10_000),
} as const;

export type Config = typeof config;
