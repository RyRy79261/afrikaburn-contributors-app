import "server-only";

import { encrypt, decryptOrNull, decryptField } from "@quagga/db/crypto";

/** Whether the pgcrypto/AES key is configured (POPIA-sensitive columns and the
 * profile private key are only ever stored encrypted). */
export function isCryptoConfigured(): boolean {
  const raw = process.env.PGCRYPTO_KEY;
  return Boolean(raw && raw.length >= 16);
}

/** Encrypt when a key is configured; otherwise return null so the caller drops
 * the value rather than persisting sensitive data in the clear. */
export function safeEncrypt(plaintext: string | null): string | null {
  if (!plaintext || !isCryptoConfigured()) return null;
  return encrypt(plaintext);
}

export { decryptOrNull, decryptField };
