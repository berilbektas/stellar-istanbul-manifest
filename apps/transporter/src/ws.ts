/**
 * WebSocket gateway (manifest §9 `WS /ws`, §7 Flow A.5).
 *
 * Wallets hold a persistent socket so the transporter can PUSH sign requests.
 * Auth is the opaque `walletToken` as a query param (`?token=...`); the socket
 * is mapped to its `walletId`.
 *
 * Two hardening details:
 *   - Keepalive ping/pong terminates dead sockets — and, on the wallet side,
 *     an MV3 service worker can drop the socket while idle (manifest §15.3), so
 *     on every (re)connect we flush any still-pending requests for that wallet.
 */

import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Config } from "./config.js";
import { DEV_TEST_AUTH_ENTRY, DEV_TEST_META } from "./dev.js";
import type { TransporterStore } from "./store.js";
import type { PendingRequest, SignRequestPush } from "./types.js";

interface WalletSocket extends WebSocket {
  walletId: string;
  isAlive: boolean;
}

function toPush(pending: PendingRequest, address: string): SignRequestPush {
  return {
    type: "sign_request",
    requestId: pending.requestId,
    address,
    payloadType: pending.type,
    payload: pending.payload,
    meta: pending.meta,
  };
}

export class WalletGateway {
  private readonly wss: WebSocketServer;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  /** Wallets we've already sent the dev test request to (once per process). */
  private readonly testSent = new Set<string>();

  constructor(
    server: HttpServer,
    private readonly store: TransporterStore,
    private readonly config: Config
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) =>
      this.handleUpgrade(req, socket, head)
    );
    this.wss.on("connection", (ws) =>
      this.handleConnection(ws as WalletSocket)
    );
    this.pingTimer = setInterval(() => this.ping(), config.wsPingIntervalMs);
  }

  /** Relay a pending request to the wallet's live socket. */
  pushSignRequest(walletId: string, pending: PendingRequest): boolean {
    const ws = this.store.getSocket(walletId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const address = this.store.getById(walletId)?.publicKey ?? "";
    ws.send(JSON.stringify(toPush(pending, address)));
    return true;
  }

  close(): void {
    clearInterval(this.pingTimer);
    this.wss.close();
  }

  private handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get("token");
    const walletId = token ? this.store.walletIdForToken(token) : undefined;
    if (!walletId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const sock = ws as WalletSocket;
      sock.walletId = walletId;
      sock.isAlive = true;
      this.wss.emit("connection", sock, req);
    });
  }

  private handleConnection(ws: WalletSocket): void {
    const { walletId } = ws;
    this.store.setSocket(walletId, ws);
    console.log(`[ws] wallet connected: ${walletId}`);

    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("close", () => {
      this.store.clearSocket(walletId, ws);
      console.log(`[ws] wallet disconnected: ${walletId}`);
    });
    ws.on("error", (err) => {
      console.error(`[ws] socket error (${walletId}):`, err.message);
    });

    // Flush requests that arrived (or were missed) while disconnected.
    const now = Date.now();
    const address = this.store.getById(walletId)?.publicKey ?? "";
    for (const pending of this.store.livePendingForWallet(walletId, now)) {
      ws.send(JSON.stringify(toPush(pending, address)));
    }

    // DEV ONLY: fire a canned test sign_request once, a few seconds after the
    // wallet connects, so the approval UI can be tested end-to-end.
    if (this.config.devTestSign && !this.testSent.has(walletId)) {
      this.testSent.add(walletId);
      setTimeout(() => {
        if (this.store.getSocket(walletId)?.readyState !== WebSocket.OPEN) {
          return;
        }
        const pending = this.store.createPending({
          walletId,
          type: "auth_entry",
          payload: DEV_TEST_AUTH_ENTRY,
          meta: DEV_TEST_META,
          ttlMs: this.config.signRequestTtlMs,
          now: Date.now(),
        });
        this.pushSignRequest(walletId, pending);
        console.log(
          `[dev] pushed test sign_request ${pending.requestId} -> ${walletId}`
        );
      }, this.config.devTestSignDelayMs);
    }
  }

  private ping(): void {
    for (const client of this.wss.clients) {
      const sock = client as WalletSocket;
      if (!sock.isAlive) {
        sock.terminate();
        continue;
      }
      sock.isAlive = false;
      sock.ping();
    }
  }
}
