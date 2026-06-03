import browser from "webextension-polyfill";

import { Transaction } from "stellar-sdk";

import { getSdk } from "@shared/helpers/stellar";
import {
  EntryToSign,
  ResponseQueue,
  SignAuthEntryResponse,
  SignTransactionResponse,
} from "@shared/api/types/message-request";
import { NetworkDetails } from "@shared/constants/stellar";
import { TransactionInfo } from "types/transactions";
import { buildStore } from "background/store";
import { publicKeySelector } from "background/ducks/session";
import {
  getNetworkDetails,
  setAllowListDomain,
} from "background/helpers/account";
import {
  browserLocalStorage,
  dataStorageAccess,
} from "background/helpers/dataStorageAccess";
import {
  authEntryQueue,
  responseQueue,
  transactionQueue,
} from "background/messageListener/popupMessageListener";
import { openSigningWindow } from "background/messageListener/freighterApiMessageListener";
import { encodeObject, getPunycodedDomain } from "helpers/urls";

import {
  agentDomain,
  getTransporterUrl,
  transporterWsUrl,
} from "./config";
import {
  postPushSubscription,
  postSignResult,
  registerWallet,
  SignRequestNotification,
  SignRequestPush,
} from "./client";
import {
  clearRegistration,
  getAllRegistrations,
  getRegistration,
  Registration,
  saveRegistration,
} from "./storage";

/**
 * Transporter bridge (manifest §5 Component 3, §7 Flow C).
 *
 * Holds the persistent WebSocket to the transporter and turns inbound
 * `sign_request` pushes into Freighter's EXISTING signing flow: it pushes the
 * request onto the same queues a dApp uses and opens the same approval popup
 * (`/sign-auth-entry` or `/sign-transaction`). On approve, Freighter's existing
 * handler signs with the real key; our `responseQueue` callback then returns the
 * signature to the transporter via `POST /sign-result`.
 *
 * The signature formats are verified to match `@x402/stellar`'s `basicNodeSigner`:
 *   - auth_entry → base64 of `keypair.sign(hash(preimage))`
 *   - xdr        → `TransactionBuilder.fromXDR(...).sign(keypair).toXDR()`
 *
 * MV3 note (manifest §15.3): the service worker drops the socket when idle, so
 * a ~30s alarm wakes it and reconnects.
 */

export const TRANSPORTER_ALARM_NAME = "transporter:keepalive";
const REQUEST_TTL_MS = 90_000;

let socket: WebSocket | null = null;

/**
 * Build a single-shot result relay: the returned `finish` posts the signature
 * (or rejection) to the transporter exactly once, guarding against the success
 * callback and the window-close/TTL rejection racing each other.
 */
function makeFinish(opts: {
  requestId: string;
  transporterUrl: string;
  walletToken: string;
}) {
  let settled = false;
  return async (status: "signed" | "rejected", signature: string | null) => {
    if (settled) return;
    settled = true;
    try {
      await postSignResult(opts.transporterUrl, opts.walletToken, {
        requestId: opts.requestId,
        status,
        signature,
      });
    } catch (e) {
      console.error("[transporter] sign-result failed:", e);
    }
  };
}

/** Reject if the approval window closes without a result, plus a TTL safety net. */
function watchForRejection(
  popup: browser.Windows.Window | null | undefined,
  finish: (status: "rejected", signature: null) => Promise<void>,
) {
  setTimeout(() => void finish("rejected", null), REQUEST_TTL_MS);
  if (popup && typeof popup.id === "number") {
    const windowId = popup.id;
    const onRemoved = (removedId: number) => {
      if (removedId === windowId) {
        browser.windows.onRemoved.removeListener(onRemoved);
        void finish("rejected", null);
      }
    };
    browser.windows.onRemoved.addListener(onRemoved);
  }
}

async function handleAuthEntry(
  push: SignRequestPush,
  registration: Registration,
  transporterUrl: string,
  networkDetails: NetworkDetails,
) {
  const uuid = crypto.randomUUID();
  const authEntry: EntryToSign = {
    domain: agentDomain(transporterUrl),
    entry: push.payload,
    url: transporterUrl,
    accountToSign: push.address,
    networkPassphrase: networkDetails.networkPassphrase,
    uuid,
  };

  const finish = makeFinish({
    requestId: push.requestId,
    transporterUrl,
    walletToken: registration.walletToken,
  });

  authEntryQueue.push({ authEntry, uuid, createdAt: Date.now() });
  (responseQueue as ResponseQueue<SignAuthEntryResponse>).push({
    uuid,
    createdAt: Date.now(),
    // Freighter's signAuthEntry handler signs `hash(entry)` and calls this with
    // the raw signature Buffer — base64 of it is exactly what @x402/stellar wants.
    response: (sig) =>
      sig
        ? void finish("signed", Buffer.from(sig).toString("base64"))
        : void finish("rejected", null),
  });

  const popup = await openSigningWindow(
    `/sign-auth-entry?${encodeObject(authEntry)}`,
    uuid,
  );
  watchForRejection(popup, finish);
}

async function handleXdr(
  push: SignRequestPush,
  registration: Registration,
  transporterUrl: string,
  networkDetails: NetworkDetails,
) {
  const Sdk = getSdk(networkDetails.networkPassphrase);
  // x402 / general payments are plain (non-fee-bump) envelopes.
  const transaction = Sdk.TransactionBuilder.fromXDR(
    push.payload,
    networkDetails.networkPassphrase,
  ) as Transaction;
  const uuid = crypto.randomUUID();
  const transactionInfo: TransactionInfo = {
    url: transporterUrl,
    tab: undefined,
    transaction,
    transactionXdr: push.payload,
    flaggedKeys: {},
    accountToSign: push.address,
    uuid,
  };

  const finish = makeFinish({
    requestId: push.requestId,
    transporterUrl,
    walletToken: registration.walletToken,
  });

  transactionQueue.push({ transaction, uuid, createdAt: Date.now() });
  (responseQueue as ResponseQueue<SignTransactionResponse>).push({
    uuid,
    createdAt: Date.now(),
    // Freighter's signTransaction handler returns the signed envelope XDR —
    // exactly what @x402/stellar / Soroban RPC submit expects.
    response: (signedXdr) =>
      signedXdr
        ? void finish("signed", signedXdr)
        : void finish("rejected", null),
  });

  const popup = await openSigningWindow(
    `/sign-transaction?${encodeObject(transactionInfo)}`,
    uuid,
  );
  watchForRejection(popup, finish);
}

async function onMessage(
  data: unknown,
  registration: Registration,
  transporterUrl: string,
  networkDetails: NetworkDetails,
) {
  let push: SignRequestPush;
  try {
    push = JSON.parse(typeof data === "string" ? data : "");
  } catch {
    return;
  }
  if (!push || push.type !== "sign_request") return;

  if (push.payloadType === "auth_entry") {
    await handleAuthEntry(push, registration, transporterUrl, networkDetails);
  } else if (push.payloadType === "xdr") {
    await handleXdr(push, registration, transporterUrl, networkDetails);
  }
}

/** Connect (idempotent): register if needed, grant the agent origin, open WS. */
export async function connectTransporter() {
  try {
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const sessionStore = await buildStore();
    const publicKey = publicKeySelector(sessionStore.getState());
    if (!publicKey) return; // wallet locked / no account yet — retry on alarm.

    const localStore = dataStorageAccess(browserLocalStorage);
    const networkDetails = await getNetworkDetails({ localStore });
    const transporterUrl = await getTransporterUrl();

    let registration = await getRegistration(publicKey);
    if (!registration || registration.transporterUrl !== transporterUrl) {
      const result = await registerWallet(transporterUrl, publicKey);
      registration = await saveRegistration(publicKey, result, transporterUrl);
    }

    // Grant the agent origin once (manifest §11) so the approval Confirm button
    // is enabled. Per-request human approval is still required for every sign.
    await setAllowListDomain({
      publicKey,
      networkDetails,
      domain: getPunycodedDomain(agentDomain(transporterUrl)),
      localStore,
    });

    // Subscribe to Web Push so the transporter can wake a closed extension
    // (manifest §15.3). Best-effort, Chrome-only — never blocks the connect.
    void ensurePushSubscription(transporterUrl, registration);

    const ws = new WebSocket(
      transporterWsUrl(transporterUrl, registration.walletToken),
    );
    socket = ws;
    const reg = registration;
    let opened = false;
    ws.onopen = () => {
      opened = true;
    };
    ws.onmessage = (ev) => {
      void onMessage(ev.data, reg, transporterUrl, networkDetails);
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      // Closed before it ever opened → the transporter rejected our
      // walletToken (it restarted and lost in-memory state). Drop the stale
      // registration and reconnect; connectTransporter will re-register.
      if (!opened) {
        void clearRegistration(publicKey).then(() => connectTransporter());
      }
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  } catch (e) {
    console.error("[transporter] connect failed:", e);
  }
}

/**
 * Force a fresh WebSocket so the transporter re-flushes pending requests (the
 * flush runs in its connect handler). Used on notification click: the socket
 * may already be open, in which case plain `connectTransporter()` is a no-op and
 * nothing gets re-delivered. Closing an already-open socket is safe — it was
 * `opened`, so `onclose` won't clear the registration.
 */
async function reflushViaReconnect() {
  if (socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    socket = null;
  }
  await connectTransporter();
}

/** Wire up on background boot (manifest §7 Flow A.5, §15.3). */
export function initTransporterBridge() {
  void connectTransporter();
  browser.alarms.create(TRANSPORTER_ALARM_NAME, { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener(({ name }: { name: string }) => {
    if (name === TRANSPORTER_ALARM_NAME) void connectTransporter();
  });
}

// --- Offline Web Push (manifest §15.3) -------------------------------------
//
// Chrome MV3 only: the extension service worker subscribes to standard Web Push
// (VAPID). When the socket is dead, the transporter sends a payload-less push;
// the SW wakes, shows a notification, and reconnects — the transporter then
// flushes the full pending request over the WS, which opens the approval popup.
// No-op on Firefox (the background is a page, not a SW, so `pushManager` is
// absent). Verified against developer.chrome.com/docs/extensions/.../web-push.

const PUSH_TITLE = "Signature approval needed";

// `tsconfig` uses the `dom` lib (not `webworker`), so the SW-scope event types
// aren't declared. Define the minimal shapes we use; `ServiceWorkerRegistration`
// itself IS in the dom lib (with pushManager + showNotification).
interface SwGlobal {
  registration?: ServiceWorkerRegistration;
  addEventListener(type: string, listener: (event: Event) => void): void;
}
interface PushEventLike extends Event {
  readonly data: { json(): unknown; text(): string } | null;
  waitUntil(promise: Promise<unknown>): void;
}
interface NotificationClickEventLike extends Event {
  readonly notification: { close(): void; data?: unknown };
  waitUntil(promise: Promise<unknown>): void;
}

/** VAPID public keys are base64url; `pushManager.subscribe` wants a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function notificationBody(meta: SignRequestNotification["meta"] | undefined) {
  if (meta?.amount && meta.asset) {
    return `Approve sending ${meta.amount} ${meta.asset}.`;
  }
  if (typeof meta?.description === "string") return meta.description;
  return "A pending request needs your approval in your wallet.";
}

/**
 * Subscribe the SW to Web Push and hand the subscription to the transporter so
 * it can wake us when offline. Idempotent (reuses an existing subscription),
 * Chrome-only (no-ops where `pushManager` is absent), best-effort (never throws
 * into the caller). Does NOT require the wallet to be unlocked.
 */
async function ensurePushSubscription(
  transporterUrl: string,
  registration: Registration,
) {
  try {
    const swReg = (self as unknown as SwGlobal).registration;
    if (!swReg?.pushManager) {
      console.warn("[transporter] push: no pushManager in this context (skip)");
      return;
    }
    if (!registration.vapidPublicKey) {
      console.warn("[transporter] push: no vapidPublicKey on registration (skip)");
      return;
    }
    const wantKey = urlBase64ToUint8Array(registration.vapidPublicKey);

    let subscription = await swReg.pushManager.getSubscription();
    // A subscription made with a DIFFERENT VAPID key (e.g. from before the keys
    // were fixed) will be rejected by the push service (403/410). Drop it and
    // make a fresh one bound to the current key.
    if (subscription && !sameApplicationServerKey(subscription, wantKey)) {
      console.log("[transporter] push: VAPID key changed — re-subscribing");
      try {
        await subscription.unsubscribe();
      } catch {
        /* ignore */
      }
      subscription = null;
    }
    if (subscription) {
      console.log("[transporter] push: reusing existing subscription");
    } else {
      subscription = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: wantKey,
      });
      console.log("[transporter] push: subscribed (new)");
    }
    await postPushSubscription(
      transporterUrl,
      registration.walletToken,
      subscription.toJSON(),
    );
    console.log("[transporter] push: subscription posted to transporter");
  } catch (e) {
    console.error("[transporter] push subscribe failed (non-fatal):", e);
  }
}

/** Does an existing subscription use the VAPID key we expect? */
function sameApplicationServerKey(
  subscription: PushSubscription,
  want: Uint8Array,
): boolean {
  const have = subscription.options?.applicationServerKey;
  if (!have) return false;
  const bytes = new Uint8Array(have);
  if (bytes.length !== want.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] !== want[i]) return false;
  }
  return true;
}

/**
 * Register the Web Push SW handlers. MUST be called synchronously on SW boot so
 * a push can revive a terminated worker (Chrome SW event rules). No-op on a
 * Firefox background page (no SW registration / showNotification).
 */
export function initTransporterPush() {
  const swGlobal = self as unknown as SwGlobal;
  if (
    typeof swGlobal.addEventListener !== "function" ||
    !swGlobal.registration?.showNotification
  ) {
    return; // not a service worker (e.g. Firefox background page)
  }

  swGlobal.addEventListener("push", (event) => {
    console.log("[transporter] push: event received");
    const pushEvent = event as PushEventLike;
    pushEvent.waitUntil(
      (async () => {
        let parsed: unknown;
        try {
          parsed = pushEvent.data?.json();
        } catch {
          parsed = undefined;
        }
        const data =
          parsed && typeof parsed === "object"
            ? (parsed as Partial<SignRequestNotification>)
            : undefined;
        const requestId =
          typeof data?.requestId === "string" ? data.requestId : "";

        // userVisibleOnly:true REQUIRES a visible notification on every push,
        // so always show one (even on parse failure / unexpected payload).
        const swReg = swGlobal.registration;
        if (swReg?.showNotification) {
          try {
            await swReg.showNotification(PUSH_TITLE, {
              body: notificationBody(data?.meta),
              tag: requestId
                ? `transporter:sign:${requestId}`
                : "transporter:sign",
              requireInteraction: true,
              data: { requestId },
            });
            console.log("[transporter] push: notification shown");
          } catch (e) {
            console.error("[transporter] push: showNotification failed", e);
          }
        } else {
          console.warn("[transporter] push: no showNotification available");
        }

        // Reconnect: the transporter re-pushes the full pending request (with
        // XDR) over the WS, which opens the approval popup. Best-effort.
        try {
          await connectTransporter();
        } catch {
          /* notification already shown; user can retry via the click */
        }
      })(),
    );
  });

  swGlobal.addEventListener("notificationclick", (event) => {
    const clickEvent = event as NotificationClickEventLike;
    clickEvent.notification.close();
    console.log("[transporter] push: notification clicked");
    clickEvent.waitUntil(
      (async () => {
        // Force a fresh connection so the transporter re-flushes the pending
        // request (which opens the approval popup) even if a socket was already
        // open. Then focus an extension window.
        try {
          await reflushViaReconnect();
        } catch {
          /* ignore */
        }
        try {
          const windows = await browser.windows.getAll();
          const id = windows.find((w) => typeof w.id === "number")?.id;
          if (typeof id === "number") {
            await browser.windows.update(id, { focused: true });
          }
        } catch {
          /* ignore */
        }
      })(),
    );
  });

  // Browser expired/rotated the push subscription → re-subscribe + re-POST.
  swGlobal.addEventListener("pushsubscriptionchange", () => {
    console.log("[transporter] push: subscription changed — re-subscribing");
    void resubscribeAll();
  });

  // Subscribe at boot using any stored registration — independent of wallet
  // unlock, so offline delivery works even after a cold SW restart while locked.
  void resubscribeAll();
}

/** (Re)subscribe to push for every stored registration. */
async function resubscribeAll() {
  for (const registration of await getAllRegistrations()) {
    await ensurePushSubscription(registration.transporterUrl, registration);
  }
}
