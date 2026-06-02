/**
 * @wallet-mcp/transporter — Transporter (manifest Component 2)
 *
 * A pure relay + pairing authority + attestation server that runs INSIDE an
 * AWS AMD SEV-SNP confidential VM. It relays sign payloads between the Wallet
 * MCP and the user's Freighter wallet. It holds NO private key — only pairing
 * secrets (TOTP secret, JWT signing key), which SEV-SNP protects even from the
 * host operator.
 *
 * See: README.md, docs/api-transporter.md, docs/manifest.md §5 (Component 2),
 * §9 (API), §18 (TEE/attestation).
 *
 * Wiring only — the logic lives in: config, store, auth, attestation, http, ws.
 */

import { createServer } from "node:http";
import { Attestation } from "./attestation.js";
import { config } from "./config.js";
import { createApp } from "./http.js";
import { PushSender } from "./push.js";
import { TransporterStore } from "./store.js";
import { WalletGateway } from "./ws.js";

/** Drop resolved/expired pending records older than this (memory bound). */
const SWEEP_MAX_AGE_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

const store = new TransporterStore();
const attestation = new Attestation(config.snpguestBin);
const pushSender = new PushSender(store, config);

// Late-bound: the app's push closure needs the gateway, the gateway needs the
// HTTP server, the server needs the app. The closure only runs per-request, by
// which point `gateway` is assigned.
let gateway: WalletGateway;
const app = createApp({
  store,
  config,
  attestation,
  pushSignRequest: (pending) =>
    gateway.pushSignRequest(pending.walletId, pending),
  notifyOffline: (pending) => {
    void pushSender.notify(pending);
  },
});

const server = createServer(app);
gateway = new WalletGateway(server, store, config);

const sweepTimer = setInterval(
  () => store.sweepPending(Date.now(), SWEEP_MAX_AGE_MS),
  SWEEP_INTERVAL_MS
);

server.listen(config.port, () => {
  console.log(`[transporter] listening on :${config.port}`);
  console.log(`[transporter] identity reportData: ${attestation.reportData}`);
  if (config.jwtKeyEphemeral) {
    console.warn(
      "[transporter] JWT_SIGNING_KEY not set — generated an ephemeral key; " +
        "existing pairings will break on restart."
    );
  }
  if (config.vapidKeyEphemeral) {
    console.warn(
      "[transporter] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — generated " +
        "an ephemeral pair; existing push subscriptions will break on restart."
    );
  }
});

function shutdown(signal: string): void {
  console.log(`[transporter] ${signal} received, shutting down`);
  clearInterval(sweepTimer);
  gateway.close();
  server.close(() => process.exit(0));
  // Don't hang forever on lingering sockets.
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
