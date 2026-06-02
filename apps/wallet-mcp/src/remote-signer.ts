/**
 * Remote signer (manifest §4) — the core swap.
 *
 * `@x402/stellar`'s `createEd25519Signer` (which holds the private key locally)
 * is replaced by this object, which implements the SAME SEP-43 interface
 * (`ClientStellarSigner`: `{ address, signAuthEntry, signTransaction }`) but
 * holds NO key. Each signing call forwards the opaque payload (auth-entry
 * preimage XDR, or transaction XDR) to the transporter, which pushes it to the
 * user's Freighter; the real key signs there and the signature returns here.
 *
 * The MCP never parses the XDR — it's a pure string pass-through. The
 * format contract is between `@x402/stellar` and the forked Freighter.
 */

import type { ClientStellarSigner } from "@x402/stellar";
import type { TransporterClient } from "./transporter-client.js";
import type { SignMeta } from "./types.js";

/** A mutable holder so a long-lived signer can carry per-request approval meta. */
export interface MetaRef {
  current: SignMeta;
}

export function createRemoteSigner(args: {
  address: string;
  jwt: string;
  transporter: TransporterClient;
  metaRef: MetaRef;
  poll: { timeoutMs: number; intervalMs: number };
}): ClientStellarSigner {
  const { address, jwt, transporter, metaRef, poll } = args;

  return {
    address,

    // x402 path: sign a Soroban auth-entry preimage (Freighter.signAuthEntry).
    signAuthEntry: async (authEntry) => {
      const requestId = await transporter.signRequest(jwt, {
        type: "auth_entry",
        payload: authEntry,
        meta: metaRef.current,
      });
      const signedAuthEntry = await transporter.pollUntilSigned(
        jwt,
        requestId,
        poll
      );
      return { signedAuthEntry, signerAddress: address };
    },

    // General path: sign a transaction envelope (Freighter.signTransaction).
    signTransaction: async (xdr) => {
      const requestId = await transporter.signRequest(jwt, {
        type: "xdr",
        payload: xdr,
        meta: metaRef.current,
      });
      const signedTxXdr = await transporter.pollUntilSigned(
        jwt,
        requestId,
        poll
      );
      return { signedTxXdr, signerAddress: address };
    },
  };
}
