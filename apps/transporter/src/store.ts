/**
 * In-memory transporter state (manifest §9 "State model").
 *
 *   wallets   — registered wallets, indexed by id / publicKey / walletToken
 *   pending   — sign requests awaiting human approval
 *   sockets   — live wallet WebSocket connections, by walletId
 *
 * NO private key lives here. Sensitive values are `totpSecret` and the JWT
 * signing key (held in `config`, not this store) — what SEV-SNP protects.
 *
 * All state is process-local and ephemeral: a restart clears every
 * registration and pairing. That is acceptable for the hackathon demo and
 * keeps the TEE image minimal (manifest §11, §18).
 */

import { randomBytes, randomUUID } from "node:crypto";
import { authenticator } from "otplib";
import type { WebSocket } from "ws";
import type {
  PayloadType,
  PendingRequest,
  PushSubscriptionJSON,
  SignMeta,
  WalletRecord,
} from "./types.js";

export class TransporterStore {
  private readonly walletsById = new Map<string, WalletRecord>();
  private readonly walletIdByPublicKey = new Map<string, string>();
  private readonly walletIdByToken = new Map<string, string>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly sockets = new Map<string, WebSocket>();

  // --- Wallets (Flow A: registration) --------------------------------------

  /**
   * Register a wallet. Re-registering the same publicKey rotates its secrets
   * (a fresh `totpSecret` + `walletToken`) and supersedes the old record for
   * pairing lookups — we never return an existing secret to a caller, so a
   * stranger who knows your public G-address cannot read your TOTP secret.
   */
  register(publicKey: string): WalletRecord {
    const record: WalletRecord = {
      walletId: randomUUID(),
      publicKey,
      totpSecret: authenticator.generateSecret(),
      walletToken: randomBytes(32).toString("base64url"),
    };
    this.walletsById.set(record.walletId, record);
    this.walletIdByPublicKey.set(publicKey, record.walletId);
    this.walletIdByToken.set(record.walletToken, record.walletId);
    return record;
  }

  getByPublicKey(publicKey: string): WalletRecord | undefined {
    const id = this.walletIdByPublicKey.get(publicKey);
    return id ? this.walletsById.get(id) : undefined;
  }

  getById(walletId: string): WalletRecord | undefined {
    return this.walletsById.get(walletId);
  }

  walletIdForToken(walletToken: string): string | undefined {
    return this.walletIdByToken.get(walletToken);
  }

  /** Attach a Web Push subscription to a wallet (for offline delivery). */
  setPushSubscription(walletId: string, sub: PushSubscriptionJSON): boolean {
    const wallet = this.walletsById.get(walletId);
    if (!wallet) return false;
    wallet.pushSubscription = sub;
    return true;
  }

  /** Drop a wallet's push subscription (e.g. the endpoint returned 410 Gone). */
  clearPushSubscription(walletId: string): void {
    const wallet = this.walletsById.get(walletId);
    if (wallet) wallet.pushSubscription = undefined;
  }

  // --- Pending sign requests (Flow C) --------------------------------------

  createPending(args: {
    walletId: string;
    type: PayloadType;
    payload: string;
    meta: SignMeta;
    ttlMs: number;
    now: number;
  }): PendingRequest {
    const record: PendingRequest = {
      requestId: randomUUID(),
      walletId: args.walletId,
      type: args.type,
      payload: args.payload,
      meta: args.meta,
      status: "pending",
      result: null,
      createdAt: args.now,
      expiresAt: args.now + args.ttlMs,
    };
    this.pending.set(record.requestId, record);
    return record;
  }

  /**
   * Read a pending request, lazily flipping it to `expired` if its TTL has
   * passed while still pending.
   */
  getPending(requestId: string, now: number): PendingRequest | undefined {
    const record = this.pending.get(requestId);
    if (record && record.status === "pending" && now > record.expiresAt) {
      record.status = "expired";
    }
    return record;
  }

  /** Pending (not yet resolved, not expired) requests for one wallet. */
  livePendingForWallet(walletId: string, now: number): PendingRequest[] {
    const out: PendingRequest[] = [];
    for (const record of this.pending.values()) {
      if (
        record.walletId === walletId &&
        record.status === "pending" &&
        now <= record.expiresAt
      ) {
        out.push(record);
      }
    }
    return out;
  }

  /** Drop resolved/expired requests older than `maxAgeMs` to bound memory. */
  sweepPending(now: number, maxAgeMs: number): void {
    for (const [id, record] of this.pending) {
      if (record.status === "pending" && now > record.expiresAt) {
        record.status = "expired";
      }
      if (record.status !== "pending" && now - record.createdAt > maxAgeMs) {
        this.pending.delete(id);
      }
    }
  }

  // --- Sockets -------------------------------------------------------------

  setSocket(walletId: string, socket: WebSocket): void {
    this.sockets.set(walletId, socket);
  }

  getSocket(walletId: string): WebSocket | undefined {
    return this.sockets.get(walletId);
  }

  /** Remove a socket only if it is still the one mapped (avoids races). */
  clearSocket(walletId: string, socket: WebSocket): void {
    if (this.sockets.get(walletId) === socket) {
      this.sockets.delete(walletId);
    }
  }
}
