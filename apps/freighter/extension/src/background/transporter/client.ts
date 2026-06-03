/**
 * Transporter HTTP client (wallet side) — manifest §9, contract in
 * docs/api-transporter.md. Self-contained (the apps don't share packages).
 */

export type PayloadType = "auth_entry" | "xdr";

export interface SignMeta {
  amount?: string;
  asset?: string;
  destination?: string;
  description?: string;
  [key: string]: unknown;
}

/** Server → wallet push over the WebSocket. */
export interface SignRequestPush {
  type: "sign_request";
  requestId: string;
  /** The G-account that must sign (manifest §9). */
  address: string;
  payloadType: PayloadType;
  payload: string;
  meta: SignMeta;
}

/**
 * Server → wallet Web Push body when NO live WebSocket exists (manifest §15.3).
 * Carries NO `payload` (XDR): the woken service worker reconnects the WebSocket
 * and the transporter flushes the full pending request over `onmessage`.
 */
export interface SignRequestNotification {
  type: "sign_request";
  requestId: string;
  address: string;
  payloadType: PayloadType;
  meta: SignMeta;
}

export interface RegisterResult {
  walletId: string;
  totpSecret: string;
  walletToken: string;
  vapidPublicKey: string;
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const error =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(error);
  }
  return parsed as T;
}

/** Flow A.2: register this wallet's public key (manifest §7). */
export const registerWallet = (baseUrl: string, publicKey: string) =>
  postJson<RegisterResult>(new URL("/register", baseUrl).toString(), {
    publicKey,
  });

/** Flow C.6: return the signature (or rejection) to the transporter. */
export const postSignResult = (
  baseUrl: string,
  walletToken: string,
  body: { requestId: string; status: "signed" | "rejected"; signature: string | null },
) =>
  postJson<{ ok: true }>(
    new URL("/sign-result", baseUrl).toString(),
    body,
    { "x-wallet-token": walletToken },
  );

/** Register a Web Push subscription for offline delivery (manifest §15.3). */
export const postPushSubscription = (
  baseUrl: string,
  walletToken: string,
  subscription: unknown,
) =>
  postJson<{ ok: true }>(
    new URL("/push-subscription", baseUrl).toString(),
    { subscription },
    { "x-wallet-token": walletToken },
  );
