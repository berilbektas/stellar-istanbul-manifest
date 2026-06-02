/**
 * Transporter API + state types.
 *
 * Local copy of the contract in `docs/api-transporter.md` (manifest §9). The
 * apps are self-contained (no shared workspace packages), so every app that
 * talks to the transporter keeps its own copy — keep this in sync with that
 * file.
 */

/** What is being signed. `auth_entry` = x402 Soroban auth entry preimage. */
export type PayloadType = "auth_entry" | "xdr";

/** Lifecycle of a pending sign request. */
export type SignStatus = "pending" | "signed" | "rejected" | "expired";

/** Human-readable context shown on the wallet's approval screen (manifest §7). */
export interface SignMeta {
  amount?: string;
  asset?: string;
  destination?: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * A Web Push subscription (VAPID), as produced by `pushManager.subscribe` in
 * the wallet's service worker. Lets the transporter wake a CLOSED extension.
 */
export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

/** A registered wallet. `totpSecret` is sensitive — SEV-SNP protects it. */
export interface WalletRecord {
  walletId: string;
  publicKey: string;
  totpSecret: string;
  walletToken: string;
  /** Web Push target for offline delivery; set via `POST /push-subscription`. */
  pushSubscription?: PushSubscriptionJSON;
}

/** A signature request awaiting human approval in the wallet. */
export interface PendingRequest {
  requestId: string;
  walletId: string;
  type: PayloadType;
  payload: string;
  meta: SignMeta;
  status: SignStatus;
  result: string | null;
  createdAt: number;
  expiresAt: number;
}

/** Claims embedded in the pairing JWT (manifest §7 Flow B). */
export interface WalletClaims {
  walletId: string;
  publicKey: string;
}

// --- Wire shapes (request/response bodies, §9) -----------------------------

export interface RegisterResponse {
  walletId: string;
  totpSecret: string;
  walletToken: string;
  /** VAPID public key for the wallet's SW to subscribe to Web Push. */
  vapidPublicKey: string;
}

export interface PairResponse {
  jwt: string;
}

export interface SignRequestResponse {
  requestId: string;
}

export interface SignStatusResponse {
  status: SignStatus;
  result: string | null;
}

/** Server → wallet WebSocket push (`wss://<transporter>/ws`). */
export interface SignRequestPush {
  type: "sign_request";
  requestId: string;
  /** Which G-account must sign — lets a multi-account wallet pick the key. */
  address: string;
  payloadType: PayloadType;
  payload: string;
  meta: SignMeta;
}

/**
 * Web Push notification body for a CLOSED extension. Carries no `payload`
 * (XDR): the woken SW reconnects the WebSocket and the transporter flushes the
 * full pending request. Keeps the push small and off the push-service infra.
 */
export interface SignRequestNotification {
  type: "sign_request";
  requestId: string;
  address: string;
  payloadType: PayloadType;
  meta: SignMeta;
}

export interface AttestationResponse {
  /** base64 SEV-SNP report, or null when running outside a SEV-SNP VM. */
  report: string | null;
  /** PEM VLEK cert chain, or null when unavailable. */
  vlekCertChain: string | null;
  /** hex; sha-512 of the transporter identity public key. Always present. */
  reportData: string;
  /** false when no real attestation could be produced (e.g. local dev). */
  available: boolean;
}
