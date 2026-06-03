/**
 * DEV-ONLY test fixtures (gated by `config.devTestSign`).
 *
 * A valid Stellar **testnet** Soroban auth-entry preimage (USDC `transfer`,
 * 1.00) so the wallet's approval screen renders + is signable without the full
 * x402 flow. Used by the WS connect hook (`ws.ts`) and the `POST /dev/push-test`
 * endpoint (`http.ts`).
 */

import type { SignMeta } from "./types.js";

export const DEV_TEST_AUTH_ENTRY =
  "AAAACc7gMC1ZhE0yvcqRXIID3USzP7t+3BkFHqN6vt8o7NRyAAAAAEmWAtI7msn/AAAAAAAAAAFQRc1ewHKado/VrQJQWFLfTwKNzoMOWsUiCbpISDsvAQAAAAh0cmFuc2ZlcgAAAAMAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAAAAAAAAAAAAACYloAAAAAA";

export const DEV_TEST_META: SignMeta = {
  amount: "1.00",
  asset: "USDC",
  destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  description: "TEST sign request (dev)",
};
