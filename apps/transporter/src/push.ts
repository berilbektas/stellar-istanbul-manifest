/**
 * Web Push sender (VAPID) — wakes a CLOSED wallet extension (manifest §15.3).
 *
 * When `/sign-request` finds no live WebSocket, the transporter sends a Web
 * Push to the wallet's stored subscription. The wallet's service worker wakes
 * on the push, shows an OS notification, and on open reconnects the WS — the
 * transporter then flushes the full pending request.
 *
 * The VAPID private key is a sensitive secret (manifest §6), held only here /
 * in `config`. The push body carries no XDR, only `{ requestId, address, meta }`.
 */

import webpush, { WebPushError } from "web-push";
import type { Config } from "./config.js";
import type { TransporterStore } from "./store.js";
import type { PendingRequest, SignRequestNotification } from "./types.js";

export class PushSender {
  constructor(
    private readonly store: TransporterStore,
    config: Config
  ) {
    webpush.setVapidDetails(
      config.vapidSubject,
      config.vapidPublicKey,
      config.vapidPrivateKey
    );
  }

  /**
   * Notify the wallet of a pending request out-of-band. Returns false if the
   * wallet has no subscription or the send failed. Never throws.
   */
  async notify(pending: PendingRequest): Promise<boolean> {
    const wallet = this.store.getById(pending.walletId);
    if (!wallet?.pushSubscription) {
      console.warn(
        `[push] no subscription for ${pending.walletId} — wallet never sent one (subscribe step failed?)`
      );
      return false;
    }

    const body: SignRequestNotification = {
      type: "sign_request",
      requestId: pending.requestId,
      address: wallet.publicKey,
      payloadType: pending.type,
      meta: pending.meta,
    };

    try {
      // TTL = the pending request's remaining lifetime, so the push service
      // drops a queued push once the request has expired (auth entries are
      // short-lived, manifest §15.1) rather than waking the wallet uselessly.
      const ttl = Math.max(
        0,
        Math.round((pending.expiresAt - Date.now()) / 1000)
      );
      await webpush.sendNotification(
        wallet.pushSubscription,
        JSON.stringify(body),
        {
          TTL: ttl,
        }
      );
      console.log(
        `[push] sent to ${pending.walletId} (req ${pending.requestId})`
      );
      return true;
    } catch (err) {
      // 404/410 = the push endpoint is gone; drop the stale subscription.
      if (
        err instanceof WebPushError &&
        (err.statusCode === 404 || err.statusCode === 410)
      ) {
        this.store.clearPushSubscription(pending.walletId);
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[push] notify failed (${pending.walletId}):`, message);
      return false;
    }
  }
}
