import browser from "webextension-polyfill";

import { RegisterResult } from "./client";

/**
 * Persisted transporter registration, keyed by public key (manifest §7 Flow A).
 * Holds the `totpSecret` (to show the pairing code) and `walletToken` (to auth
 * the WebSocket + `/sign-result`). NO private key — that stays in Freighter's
 * key store.
 */

const REGISTRATIONS_KEY = "TRANSPORTER_REGISTRATIONS";

export interface Registration {
  walletId: string;
  totpSecret: string;
  walletToken: string;
  vapidPublicKey: string;
  transporterUrl: string;
}

type Registrations = Record<string, Registration>;

async function readAll(): Promise<Registrations> {
  const stored = (await browser.storage.local.get(REGISTRATIONS_KEY))[
    REGISTRATIONS_KEY
  ];
  return (stored as Registrations) || {};
}

export async function getRegistration(
  publicKey: string,
): Promise<Registration | undefined> {
  return (await readAll())[publicKey];
}

/** All stored registrations — used to (re)subscribe to push at SW boot. */
export async function getAllRegistrations(): Promise<Registration[]> {
  return Object.values(await readAll());
}

export async function saveRegistration(
  publicKey: string,
  result: RegisterResult,
  transporterUrl: string,
): Promise<Registration> {
  const all = await readAll();
  const registration: Registration = {
    walletId: result.walletId,
    totpSecret: result.totpSecret,
    walletToken: result.walletToken,
    vapidPublicKey: result.vapidPublicKey,
    transporterUrl,
  };
  all[publicKey] = registration;
  await browser.storage.local.set({ [REGISTRATIONS_KEY]: all });
  return registration;
}

/**
 * Drop a stored registration. Used when the transporter rejects our
 * `walletToken` — the transporter keeps state in memory, so a restart
 * invalidates it and we must re-register (manifest §9 state model).
 */
export async function clearRegistration(publicKey: string): Promise<void> {
  const all = await readAll();
  if (all[publicKey]) {
    delete all[publicKey];
    await browser.storage.local.set({ [REGISTRATIONS_KEY]: all });
  }
}
