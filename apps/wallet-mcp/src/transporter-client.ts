/**
 * Transporter HTTP client (manifest §7 Flows B & C, contract in
 * `docs/api-transporter.md`). The MCP side of the relay: pair, submit a sign
 * request, and poll for the result.
 */

import type {
  PairResponse,
  PayloadType,
  SignMeta,
  SignRequestResponse,
  SignStatus,
  SignStatusResponse,
} from "./types.js";

export class SignError extends Error {}

interface PollOptions {
  timeoutMs: number;
  intervalMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TransporterClient {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }

  private async json<T>(res: Response): Promise<T> {
    const text = await res.text();
    const body: unknown = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new SignError(err);
    }
    return body as T;
  }

  /** Flow B: exchange publicKey + TOTP code for a pairing JWT. */
  async pair(publicKey: string, totpCode: string): Promise<string> {
    const res = await fetch(this.url("/pair"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey, totpCode }),
    });
    const { jwt } = await this.json<PairResponse>(res);
    return jwt;
  }

  /** Flow C.2: submit a payload for the wallet to sign; returns requestId. */
  async signRequest(
    jwt: string,
    req: { type: PayloadType; payload: string; meta: SignMeta }
  ): Promise<string> {
    const res = await fetch(this.url("/sign-request"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(req),
    });
    const { requestId } = await this.json<SignRequestResponse>(res);
    return requestId;
  }

  /** Flow C.4: read the current status/result of a sign request. */
  async getSignStatus(
    jwt: string,
    requestId: string
  ): Promise<SignStatusResponse> {
    const res = await fetch(
      this.url(`/sign-request/${encodeURIComponent(requestId)}`),
      { headers: { authorization: `Bearer ${jwt}` } }
    );
    return this.json<SignStatusResponse>(res);
  }

  /**
   * Flow C.4–8: poll until the user approves (→ signature), rejects, the
   * request expires, or we time out. Returns the signed result string.
   */
  async pollUntilSigned(
    jwt: string,
    requestId: string,
    opts: PollOptions
  ): Promise<string> {
    const deadline = Date.now() + opts.timeoutMs;
    while (Date.now() < deadline) {
      const { status, result } = await this.getSignStatus(jwt, requestId);
      if (status === "signed") {
        if (!result) throw new SignError("signed but no signature returned");
        return result;
      }
      if (status === "rejected") {
        throw new SignError("the user rejected the request in their wallet");
      }
      if (status === "expired") {
        throw new SignError("the request expired before it was approved");
      }
      await sleep(opts.intervalMs);
    }
    throw new SignError(
      "timed out waiting for wallet approval — is the wallet open?"
    );
  }
}

export type { SignStatus };
