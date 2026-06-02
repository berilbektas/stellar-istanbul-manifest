/**
 * Pairing auth (manifest §7 Flow B, §11).
 *
 *   - TOTP verification proves "current access to the wallet" at pairing time.
 *   - The pairing JWT (signed with the transporter's `jwtSigningKey`) is what
 *     the Wallet MCP later presents on `/sign-request`. It cannot be forged
 *     without the signing key, which never leaves the TEE.
 */

import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import type { WalletClaims } from "./types.js";

/** Verify a 6-digit TOTP code against a wallet's stored secret. */
export function verifyTotp(
  code: string,
  secret: string,
  window: number
): boolean {
  // otplib mutates global options; scope the window to this check.
  const verifier = authenticator.clone();
  verifier.options = { window };
  try {
    return verifier.check(code, secret);
  } catch {
    return false;
  }
}

/** Mint a pairing JWT binding the caller to a walletId + publicKey. */
export function signJwt(
  claims: WalletClaims,
  signingKey: string,
  expiresIn: string
): string {
  return jwt.sign(claims, signingKey, {
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
  });
}

/** Verify a pairing JWT and extract its claims, or null if invalid/expired. */
export function verifyJwt(
  token: string,
  signingKey: string
): WalletClaims | null {
  try {
    const decoded = jwt.verify(token, signingKey);
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      typeof decoded.walletId === "string" &&
      typeof decoded.publicKey === "string"
    ) {
      return { walletId: decoded.walletId, publicKey: decoded.publicKey };
    }
    return null;
  } catch {
    return null;
  }
}

/** Extract a Bearer token from an Authorization header value. */
export function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
