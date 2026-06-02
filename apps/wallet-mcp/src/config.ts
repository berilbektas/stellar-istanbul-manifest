/**
 * Wallet MCP configuration (manifest §5, §14).
 *
 * The MCP config carries ONLY the transporter URL + network/RPC. The pairing
 * JWT is NOT here — it lives in `~/.wallet-mcp/creds.json` (see `creds.ts`).
 * No private key, ever.
 */

import { getNetworkPassphrase } from "@x402/stellar";
import dotenv from "dotenv";

dotenv.config();

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

const network = process.env.STELLAR_NETWORK ?? "stellar:testnet";

export const config = {
  /** Transporter base URL (manifest §5 — the only thing in MCP config). */
  transporterUrl: process.env.TRANSPORTER_URL ?? "http://localhost:8787",

  /** CAIP-2 network id, e.g. `stellar:testnet` (manifest §14). */
  network,
  /** Network passphrase derived from `network` (for RPC submit). */
  networkPassphrase: getNetworkPassphrase(network as `${string}:${string}`),
  /** Soroban RPC — NOT Horizon (manifest §15.6). */
  sorobanRpcUrl:
    process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",

  /** Sign-request poll timeout (ms) — must cover human approval (§7, §15). */
  signPollTimeoutMs: int("SIGN_POLL_TIMEOUT_MS", 90_000),
  /** Poll interval (ms). */
  signPollIntervalMs: int("SIGN_POLL_INTERVAL_MS", 1_500),

  /**
   * Testnet fee fix (manifest §8.7/§15.5): rebuild the payment tx with a
   * 1-stroop inclusion fee. OFF by default — this facilitator sponsors fees
   * (areFeesSponsored, 50k stroops), so it's usually unnecessary, and lowering
   * the total fee below the Soroban resource fee can invalidate the tx. Enable
   * + verify against the live facilitator in Phase 0 if fees are rejected.
   */
  testnetFeeFix: bool("X402_TESTNET_FEE_FIX", false),
} as const;

export type Config = typeof config;
