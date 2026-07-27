import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * Symmetric encryption for the always-private, POPIA-sensitive ID-document
 * columns on `burner_bios` (`sa_id_encrypted`, `passport_encrypted`).
 *
 * The schema labels these "pgcrypto-encrypted". We use Node's built-in
 * AES-256-GCM instead of the pgcrypto extension: same threat model (a single
 * shared key from `PGCRYPTO_KEY`, whose leak compromises either scheme), fewer
 * moving parts (no extension, no SQL fragments), and the base64 ciphertext fits
 * the existing text columns.
 *
 * Stored format: base64(iv ‖ tag ‖ ciphertext), iv = 12 bytes, tag = 16 bytes.
 * Encrypt in route handlers — never store these plaintext.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_SALT = "quagga-pgcrypto-v1";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.PGCRYPTO_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      "PGCRYPTO_KEY env var is required and must be at least 16 characters.",
    );
  }
  cachedKey = scryptSync(raw, KEY_SALT, 32);
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decrypt(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Ciphertext is too short to be valid.");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/** Decrypt-or-null helper for nullable stored columns.
 *
 * COLLAPSES TWO DIFFERENT FACTS INTO `null`: "nothing was stored" and "something
 * was stored but could not be read". That is fine for an ID document, where the
 * page shows a field as absent either way. It is NOT fine for medical notes,
 * where `null` renders as the affirmative "no medical notes on file" — a
 * reassurance that must never be produced by a failed decrypt. Safety-critical
 * columns use `decryptField` below. */
export function decryptOrNull(
  stored: string | null | undefined,
): string | null {
  if (!stored) return null;
  try {
    return decrypt(stored);
  } catch {
    return null;
  }
}

/**
 * The three genuinely distinct outcomes of reading an encrypted column.
 *
 * `unreadable` is the one that matters: ciphertext is present but this process
 * cannot decrypt it — a wrong or rotated PGCRYPTO_KEY, or a pre-encryption
 * plaintext row. Callers on a safety path MUST surface it as "we cannot read
 * this", never as "there is nothing here".
 */
export type DecryptedField =
  | { state: "empty"; value: null }
  | { state: "ok"; value: string }
  | { state: "unreadable"; value: null };

const EMPTY_FIELD: DecryptedField = { state: "empty", value: null };

/** Decrypt a nullable column, distinguishing absent from unreadable. */
export function decryptField(
  stored: string | null | undefined,
): DecryptedField {
  if (!stored) return EMPTY_FIELD;
  try {
    return { state: "ok", value: decrypt(stored) };
  } catch {
    // Deliberately not logged with the ciphertext — this runs on a POPIA column.
    return { state: "unreadable", value: null };
  }
}
