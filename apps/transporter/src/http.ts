/**
 * Transporter HTTP API (manifest §9, contract in docs/api-transporter.md).
 *
 *   POST /register            { publicKey }            -> { walletId, totpSecret, walletToken }
 *   POST /pair                { publicKey, totpCode }  -> { jwt }
 *   POST /sign-request        (Bearer JWT)             -> { requestId }
 *   GET  /sign-request/:id    (Bearer JWT)             -> { status, result }
 *   POST /sign-result         (walletToken)            -> { ok }
 *   GET  /attestation                                  -> { report, vlekCertChain, reportData }
 *   GET  /health                                       -> { ok }
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Attestation } from "./attestation.js";
import { bearer, signJwt, verifyJwt, verifyTotp } from "./auth.js";
import type { Config } from "./config.js";
import { DEV_TEST_AUTH_ENTRY, DEV_TEST_META } from "./dev.js";
import type { TransporterStore } from "./store.js";
import type {
  PayloadType,
  PendingRequest,
  PushSubscriptionJSON,
  SignMeta,
  WalletClaims,
} from "./types.js";

interface Deps {
  store: TransporterStore;
  config: Config;
  attestation: Attestation;
  /** Push to the wallet's live WebSocket. Returns false if no live socket. */
  pushSignRequest: (pending: PendingRequest) => boolean;
  /** Fallback when the socket is dead: Web Push to a closed extension. */
  notifyOffline: (pending: PendingRequest) => void;
}

// --- small helpers ---------------------------------------------------------

function fail(res: Response, code: number, error: string): void {
  res.status(code).json({ error });
}

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void> | void
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// Light, dependency-free Stellar public-key shape check (G... ed25519).
function looksLikeStellarPublicKey(v: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(v);
}

function asPayloadType(v: unknown): PayloadType | null {
  return v === "auth_entry" || v === "xdr" ? v : null;
}

function asMeta(v: unknown): SignMeta {
  return isRecord(v) ? (v as SignMeta) : {};
}

/** Validate a Web Push subscription shape, or null. */
function asPushSubscription(v: unknown): PushSubscriptionJSON | null {
  if (!isRecord(v)) return null;
  const endpoint = asString(v.endpoint);
  const keys = isRecord(v.keys) ? v.keys : null;
  const p256dh = keys ? asString(keys.p256dh) : null;
  const auth = keys ? asString(keys.auth) : null;
  if (!endpoint || !p256dh || !auth) return null;
  const expirationTime =
    typeof v.expirationTime === "number" ? v.expirationTime : null;
  return { endpoint, expirationTime, keys: { p256dh, auth } };
}

/** Resolve + verify the Bearer JWT, or 401 and return null. */
function requireClaims(
  req: Request,
  res: Response,
  config: Config
): WalletClaims | null {
  const token = bearer(req.header("authorization"));
  const claims = token ? verifyJwt(token, config.jwtSigningKey) : null;
  if (!claims) {
    fail(res, 401, "missing or invalid bearer token");
    return null;
  }
  return claims;
}

/** Resolve the walletToken (header or body) to a walletId, or 401 + null. */
function requireWalletId(
  req: Request,
  res: Response,
  store: TransporterStore
): string | null {
  const fromHeader = req.header("x-wallet-token");
  const fromBody = isRecord(req.body) ? asString(req.body.walletToken) : null;
  const token = fromHeader ?? fromBody ?? undefined;
  const walletId = token ? store.walletIdForToken(token) : undefined;
  if (!walletId) {
    fail(res, 401, "missing or invalid wallet token");
    return null;
  }
  return walletId;
}

// --- app -------------------------------------------------------------------

export function createApp(deps: Deps): express.Express {
  const { store, config, attestation, pushSignRequest, notifyOffline } = deps;
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // DEV ONLY (config.devTestSign): force an OFFLINE-path push to every
  // registered wallet — creates a test pending request and sends the Web Push
  // regardless of socket state, so you can exercise the closed-extension wake +
  // notification with one curl (no need to manually stop the service worker).
  if (config.devTestSign) {
    app.post("/dev/push-test", (_req, res) => {
      const now = Date.now();
      const requestIds = store.allWallets().map((wallet) => {
        const pending = store.createPending({
          walletId: wallet.walletId,
          type: "auth_entry",
          payload: DEV_TEST_AUTH_ENTRY,
          meta: DEV_TEST_META,
          ttlMs: config.signRequestTtlMs,
          now,
        });
        notifyOffline(pending);
        return pending.requestId;
      });
      console.log(`[dev] push-test -> ${requestIds.length} wallet(s)`);
      res.json({ wallets: requestIds.length, requestIds });
    });
  }

  // VAPID public key for the wallet SW to subscribe to Web Push (manifest §15.3).
  app.get("/push/vapid-public-key", (_req, res) => {
    res.json({ vapidPublicKey: config.vapidPublicKey });
  });

  // Flow A.2 — registration.
  app.post("/register", (req, res) => {
    const publicKey = isRecord(req.body) ? asString(req.body.publicKey) : null;
    if (!publicKey || !looksLikeStellarPublicKey(publicKey)) {
      return fail(res, 400, "publicKey must be a Stellar G-address");
    }
    const { walletId, totpSecret, walletToken } = store.register(publicKey);
    res.json({
      walletId,
      totpSecret,
      walletToken,
      vapidPublicKey: config.vapidPublicKey,
    });
  });

  // Wallet attaches its Web Push subscription (auth: walletToken).
  app.post("/push-subscription", (req, res) => {
    const walletId = requireWalletId(req, res, store);
    if (!walletId) return;
    const body = isRecord(req.body) ? req.body : {};
    const subscription = asPushSubscription(body.subscription);
    if (!subscription) {
      return fail(res, 400, "subscription must be a Web Push subscription");
    }
    store.setPushSubscription(walletId, subscription);
    console.log(`[push] subscription stored for ${walletId}`);
    res.json({ ok: true });
  });

  // Flow B — pairing.
  app.post("/pair", (req, res) => {
    const publicKey = isRecord(req.body) ? asString(req.body.publicKey) : null;
    const totpCode = isRecord(req.body) ? asString(req.body.totpCode) : null;
    if (!publicKey || !totpCode) {
      return fail(res, 400, "publicKey and totpCode are required");
    }
    const wallet = store.getByPublicKey(publicKey);
    if (!wallet) {
      return fail(res, 404, "wallet not registered");
    }
    if (!verifyTotp(totpCode, wallet.totpSecret, config.totpWindow)) {
      return fail(res, 401, "invalid TOTP code");
    }
    const jwt = signJwt(
      { walletId: wallet.walletId, publicKey: wallet.publicKey },
      config.jwtSigningKey,
      config.jwtExpiresIn
    );
    res.json({ jwt });
  });

  // Flow C.2 — create a sign request and push it to the wallet.
  app.post("/sign-request", (req, res) => {
    const claims = requireClaims(req, res, config);
    if (!claims) return;
    if (!store.getById(claims.walletId)) {
      return fail(res, 401, "wallet no longer registered");
    }
    const body = isRecord(req.body) ? req.body : {};
    const type = asPayloadType(body.type);
    const payload = asString(body.payload);
    if (!type) return fail(res, 400, 'type must be "auth_entry" or "xdr"');
    if (!payload) return fail(res, 400, "payload (XDR string) is required");

    const pending = store.createPending({
      walletId: claims.walletId,
      type,
      payload,
      meta: asMeta(body.meta),
      ttlMs: config.signRequestTtlMs,
      now: Date.now(),
    });
    const delivered = pushSignRequest(pending);
    if (!delivered) {
      // No live socket: the extension is closed/idle. Wake it via Web Push;
      // the full request is flushed when its SW reconnects (manifest §15.3).
      console.warn(
        `[http] sign-request ${pending.requestId}: wallet offline, push fallback`
      );
      notifyOffline(pending);
    }
    res.json({ requestId: pending.requestId });
  });

  // Flow C.4 — MCP polls for the result.
  app.get("/sign-request/:requestId", (req, res) => {
    const claims = requireClaims(req, res, config);
    if (!claims) return;
    const pending = store.getPending(req.params.requestId, Date.now());
    if (!pending || pending.walletId !== claims.walletId) {
      return fail(res, 404, "unknown requestId");
    }
    res.json({ status: pending.status, result: pending.result });
  });

  // Flow C.6 — wallet posts the signature (or rejection).
  app.post("/sign-result", (req, res) => {
    const walletId = requireWalletId(req, res, store);
    if (!walletId) return;
    const body = isRecord(req.body) ? req.body : {};
    const requestId = asString(body.requestId);
    const status = body.status;
    if (!requestId) return fail(res, 400, "requestId is required");
    if (status !== "signed" && status !== "rejected") {
      return fail(res, 400, 'status must be "signed" or "rejected"');
    }
    const pending = store.getPending(requestId, Date.now());
    if (!pending || pending.walletId !== walletId) {
      return fail(res, 404, "unknown requestId");
    }
    if (pending.status !== "pending") {
      return fail(res, 409, `request already ${pending.status}`);
    }
    pending.status = status;
    pending.result = status === "signed" ? asString(body.signature) : null;
    if (status === "signed" && !pending.result) {
      pending.status = "pending";
      return fail(res, 400, "signature is required when status is signed");
    }
    if (status === "signed") {
      console.log(
        `[sign-result] ${requestId} signed (${pending.type}) signature=${pending.result}`
      );
    } else {
      console.log(`[sign-result] ${requestId} rejected`);
    }
    res.json({ ok: true });
  });

  // §18 — TEE attestation (best-effort; never throws).
  app.get(
    "/attestation",
    asyncHandler(async (_req, res) => {
      res.json(await attestation.produce());
    })
  );

  // Central error responder.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "internal error";
    console.error("[http] unhandled error:", message);
    if (!res.headersSent) res.status(500).json({ error: "internal error" });
  });

  return app;
}
