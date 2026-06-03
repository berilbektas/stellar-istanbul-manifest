/**
 * x402 payment flow (manifest §8) — the manual client.js flow, so we can set
 * the wallet approval meta before signing and (optionally) apply the testnet
 * fee fix between signing and the retry.
 *
 *   1. request the URL → 402 + PAYMENT-REQUIRED
 *   2. parse requirements, derive human-readable meta for the wallet
 *   3. createPaymentPayload → signs via the remote signer (wallet round-trip)
 *   4. (optional) testnet fee fix
 *   5. retry with the PAYMENT-SIGNATURE header
 *   6. parse PAYMENT-RESPONSE (settle receipt)
 */

import { xdr } from "@stellar/stellar-sdk";
import type { PaymentPayload, PaymentRequired } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import {
  type ClientStellarSigner,
  ExactStellarScheme,
  USDC_PUBNET_ADDRESS,
  USDC_TESTNET_ADDRESS,
} from "@x402/stellar";
import type { Config } from "./config.js";
import type { MetaRef } from "./remote-signer.js";
import type { SignMeta } from "./types.js";

type SettleResponse = ReturnType<x402HTTPClient["getPaymentSettleResponse"]>;

export interface PayResult {
  /** Whether a payment was actually made (false if the URL wasn't a paywall). */
  paid: boolean;
  /** HTTP status of the final response. */
  status: number;
  /** The resource body returned by the server. */
  resource: unknown;
  /** The settle receipt (PAYMENT-RESPONSE), or null if unavailable. */
  receipt: SettleResponse | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isUsdc(asset: string): boolean {
  return asset === USDC_TESTNET_ADDRESS || asset === USDC_PUBNET_ADDRESS;
}

/** USDC has 7 decimals on Stellar; format atomic units to a decimal string. */
function formatAmount(atomic: string, usdc: boolean): string {
  if (!usdc) return atomic;
  try {
    const v = Number(atomic) / 10 ** 7;
    return Number.isFinite(v) ? v.toString() : atomic;
  } catch {
    return atomic;
  }
}

function describeResource(resource: unknown): string {
  if (typeof resource === "string") return resource;
  if (isRecord(resource)) {
    const url = resource.url ?? resource.resource ?? resource.description;
    if (typeof url === "string") return url;
  }
  return "x402 payment";
}

/** Build the meta shown on the wallet's approval screen from the 402 details. */
function deriveMeta(pr: PaymentRequired): SignMeta {
  const req =
    pr.accepts.find((a) => String(a.network).startsWith("stellar")) ??
    pr.accepts[0];
  if (!req) return { description: describeResource(pr.resource) };
  const usdc = isUsdc(req.asset);
  return {
    amount: formatAmount(req.amount, usdc),
    asset: usdc ? "USDC" : req.asset,
    destination: req.payTo,
    description: describeResource(pr.resource),
  };
}

/**
 * Testnet fee fix (manifest §8.7/§15.5): lower the payment tx inclusion fee to
 * 1 stroop. Guarded + best-effort — restores the original on any error. The
 * auth-entry signature covers the invocation/nonce/expiration, not the tx fee,
 * so changing the fee does not invalidate it.
 */
function applyTestnetFeeFix(payload: PaymentPayload): void {
  const tx = payload.payload.transaction;
  if (typeof tx !== "string") return;
  try {
    const env = xdr.TransactionEnvelope.fromXDR(tx, "base64");
    if (env.switch().name === "envelopeTypeTx") {
      env.v1().tx().fee(1);
      payload.payload.transaction = env.toXDR("base64");
    }
  } catch (err) {
    console.error(
      "[x402] testnet fee fix skipped:",
      err instanceof Error ? err.message : err
    );
  }
}

export async function payX402(opts: {
  url: string;
  method: string;
  body?: unknown;
  signer: ClientStellarSigner;
  metaRef: MetaRef;
  config: Config;
}): Promise<PayResult> {
  const { url, method, body, signer, metaRef, config } = opts;

  const client = new x402Client().register(
    "stellar:*",
    new ExactStellarScheme(signer, { url: config.sorobanRpcUrl })
  );
  const http = new x402HTTPClient(client);

  const headers: Record<string, string> = {};
  let init: RequestInit = { method };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init = { method, headers, body: JSON.stringify(body) };
  }

  const first = await fetch(url, init);
  if (first.status !== 402) {
    // Not a paywall (free resource or an error) — return as-is.
    return {
      paid: false,
      status: first.status,
      resource: await readBody(first),
      receipt: null,
    };
  }

  const firstBody = await readBody(first);
  const paymentRequired = http.getPaymentRequiredResponse(
    (n) => first.headers.get(n),
    firstBody
  );

  // Set the approval meta BEFORE signing so the wallet shows who/how-much.
  metaRef.current = deriveMeta(paymentRequired);

  // This is where the remote signer round-trips to the wallet (§8.3–8.6).
  const payload = await http.createPaymentPayload(paymentRequired);
  if (config.testnetFeeFix) applyTestnetFeeFix(payload);

  const payHeaders = http.encodePaymentSignatureHeader(payload);
  const paid = await fetch(url, {
    ...init,
    headers: { ...headers, ...payHeaders },
  });

  let receipt: SettleResponse | null = null;
  try {
    receipt = http.getPaymentSettleResponse((n) => paid.headers.get(n));
  } catch {
    receipt = null;
  }

  return {
    paid: true,
    status: paid.status,
    resource: await readBody(paid),
    receipt,
  };
}
