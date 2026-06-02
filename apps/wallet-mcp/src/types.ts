/**
 * Local copy of the transporter API contract (`docs/api-transporter.md`,
 * manifest §9). The apps are self-contained (no shared workspace packages), so
 * the Wallet MCP keeps its own copy — keep this in sync with that file.
 */

/** What is being signed. `auth_entry` = x402 Soroban auth-entry preimage. */
export type PayloadType = "auth_entry" | "xdr";

/** Lifecycle of a pending sign request, as reported by the transporter. */
export type SignStatus = "pending" | "signed" | "rejected" | "expired";

/** Human-readable context the wallet shows on its approval screen (§7). */
export interface SignMeta {
  amount?: string;
  asset?: string;
  destination?: string;
  description?: string;
  [key: string]: unknown;
}

// --- wire shapes -----------------------------------------------------------

/** `POST /pair` → `{ jwt }`. */
export interface PairResponse {
  jwt: string;
}

/** `POST /sign-request` → `{ requestId }`. */
export interface SignRequestResponse {
  requestId: string;
}

/** `GET /sign-request/:requestId` → `{ status, result }`. */
export interface SignStatusResponse {
  status: SignStatus;
  result: string | null;
}

// --- local creds (manifest §5 — `~/.wallet-mcp/creds.json`) ----------------

/**
 * The pairing JWT lives here, NOT in the MCP config (which holds only
 * `TRANSPORTER_URL`). Reason: the MCP process can't reload the host's client
 * config at runtime, so writing creds here avoids a restart after pairing.
 */
export interface Creds {
  /** Pairing JWT — the Bearer token for `/sign-request`. */
  jwt: string;
  /** The paired G-account (the remote signer's `address`). */
  publicKey: string;
  /** Transporter the JWT was minted by (sanity check across config changes). */
  transporterUrl: string;
  /** ISO timestamp of pairing. */
  pairedAt: string;
}
