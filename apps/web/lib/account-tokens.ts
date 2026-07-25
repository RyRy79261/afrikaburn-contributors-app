import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Single-use tokens for the email-change flow (confirm-to-NEW, revoke-from-OLD).
//
// Lives in the app, not @quagga/core, because core is pure and must not reach for
// a runtime crypto module. The rules it enforces:
//
//  - Tokens are 256 bits from the CSPRNG. Enough that guessing is not a strategy.
//  - Only the SHA-256 HASH is stored. A database leak must not hand an attacker
//    a live confirmation or revocation link. Plain SHA-256 is right here (and
//    wrong for passwords): these are high-entropy random values, so there is no
//    dictionary to attack and no need for a slow KDF.
//  - Lookups are by hash equality in SQL, which is a constant-time-irrelevant
//    comparison of digests, not of secrets. `tokensMatch` exists for the rare
//    in-memory comparison and is timing-safe.

/** A fresh, URL-safe 256-bit token. Returned once; only its hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The stored form of a token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Timing-safe comparison of a presented token against a stored hash. Digests are
 * fixed-length, so the length check can never leak anything useful.
 */
export function tokensMatch(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
