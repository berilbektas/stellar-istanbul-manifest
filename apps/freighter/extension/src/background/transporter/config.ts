import browser from "webextension-polyfill";

import { getUrlHostname } from "helpers/urls";

/**
 * Transporter integration config (manifest §5, §7).
 *
 * The Wallet MCP relays sign requests through the transporter; this fork is the
 * wallet that approves + signs them. Only the transporter URL is configurable;
 * the private key never leaves this extension.
 */

const TRANSPORTER_URL_KEY = "TRANSPORTER_URL";
const DEFAULT_TRANSPORTER_URL = "http://localhost:8787";

export const getTransporterUrl = async (): Promise<string> => {
  const stored = (await browser.storage.local.get(TRANSPORTER_URL_KEY))[
    TRANSPORTER_URL_KEY
  ];
  return typeof stored === "string" && stored.length > 0
    ? stored
    : DEFAULT_TRANSPORTER_URL;
};

export const setTransporterUrl = async (url: string): Promise<void> => {
  await browser.storage.local.set({ [TRANSPORTER_URL_KEY]: url });
};

/** WebSocket URL for the persistent wallet connection (manifest §9). */
export const transporterWsUrl = (baseUrl: string, walletToken: string) => {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = `?token=${encodeURIComponent(walletToken)}`;
  return u.toString();
};

/**
 * The origin shown on the approval screen + granted in the allow-list (the
 * agent acting through the transporter). Granting it once at registration is
 * analogous to authorizing a dApp; every signature still needs per-request
 * approval (manifest §11).
 */
export const agentDomain = (baseUrl: string) =>
  getUrlHostname(baseUrl) || "wallet-mcp";
