import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { encrypt, decrypt, decryptOrNull, decryptField } from "../crypto";

const KEY = "test-key-at-least-16-chars-long";
/** Stored format is base64(iv ‖ tag ‖ ciphertext) — 12 + 16 bytes of header. */
const IV_PLUS_TAG = 12 + 16;

// The crypto helper reads PGCRYPTO_KEY at call time (lazily, then caches).
beforeAll(() => {
  process.env.PGCRYPTO_KEY = KEY;
});

// Several cases below re-import the module with a different key. The cache is
// MODULE state, so they must reset modules and put the env back.
afterEach(() => {
  process.env.PGCRYPTO_KEY = KEY;
  vi.restoreAllMocks();
});

/** Re-import with a specific key (or none), past the module-level key cache. */
async function cryptoWithKey(key: string | undefined) {
  vi.resetModules();
  if (key === undefined) delete process.env.PGCRYPTO_KEY;
  else process.env.PGCRYPTO_KEY = key;
  return import("../crypto");
}

describe("pgcrypto-style AES-256-GCM helpers", () => {
  it("round-trips plaintext", () => {
    const plain = "8001015009087"; // fictional SA-ID-shaped string
    const cipher = encrypt(plain);
    expect(cipher).not.toContain(plain);
    expect(decrypt(cipher)).toBe(plain);
  });

  it("produces a fresh IV per call (ciphertexts differ)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });

  it("decryptOrNull returns null for empty / corrupt input", () => {
    expect(decryptOrNull(null)).toBeNull();
    expect(decryptOrNull(undefined)).toBeNull();
    expect(decryptOrNull("not-valid-base64-ciphertext")).toBeNull();
  });

  it("refuses a buffer too short to hold an IV, a tag and a byte", () => {
    // Named explicitly rather than letting the cipher throw something
    // driver-shaped: a truncated column is a storage problem, and the message
    // should say so.
    expect(() => decrypt(Buffer.alloc(IV_PLUS_TAG).toString("base64"))).toThrow(
      /too short/i,
    );
  });
});

describe("decryptField — absent is not the same fact as unreadable", () => {
  it("reports an absent column as 'empty'", () => {
    for (const stored of [null, undefined, ""]) {
      expect(decryptField(stored)).toEqual({ state: "empty", value: null });
    }
  });

  it("reports a readable column as 'ok' with its plaintext", () => {
    expect(decryptField(encrypt("Penicillin allergy"))).toEqual({
      state: "ok",
      value: "Penicillin allergy",
    });
  });

  it("reports a present-but-undecryptable column as 'unreadable', NEVER as empty", () => {
    // This is the entire reason the type exists. On a medical column `null`
    // renders as the affirmative "no medical notes on file" — a reassurance a
    // failed decrypt must never produce, because the person reading it is
    // deciding how to treat somebody.
    const verdict = decryptField("this-is-not-ciphertext-at-all");
    expect(verdict.state).toBe("unreadable");
    expect(verdict.value).toBeNull();
  });

  it("reports a ROTATED key as unreadable rather than throwing or blanking", async () => {
    // The realistic failure. A rotated or mis-set PGCRYPTO_KEY would otherwise
    // silently blank every ID document and medical note in the product, with no
    // error anywhere in the system to say the data is still there.
    const stored = encrypt("Type 1 diabetic");
    const rotated = await cryptoWithKey("a-completely-different-key-value");
    expect(rotated.decryptField(stored)).toEqual({
      state: "unreadable",
      value: null,
    });
  });

  it("never puts the ciphertext into a log line", async () => {
    // POPIA column. The failure path is deliberately silent about its input.
    const spies = (["log", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const stored = encrypt("+27821234567");
    const rotated = await cryptoWithKey("yet-another-key-of-sufficient-length");
    expect(rotated.decryptField(stored).state).toBe("unreadable");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("decryptOrNull stays a DIFFERENT helper", () => {
  it("collapses unreadable and absent to a bare null, not a DecryptedField", () => {
    // Correct for an ID document, where the page shows the field as absent
    // either way. Pinned so the two helpers cannot be quietly unified — that
    // merge would silently downgrade the medical path to "nothing on file".
    expect(decryptOrNull("not-valid-base64-ciphertext")).toBeNull();
    expect(decryptOrNull(null)).toBeNull();
    expect(decryptOrNull(encrypt("A01234567"))).toBe("A01234567");
  });
});

describe("the PGCRYPTO_KEY guard", () => {
  it("refuses to encrypt with no key configured, and names the variable", async () => {
    // The message is what an operator acts on. "Invalid key length" from the
    // cipher would send them to the wrong place.
    const unkeyed = await cryptoWithKey(undefined);
    expect(() => unkeyed.encrypt("x")).toThrow(/PGCRYPTO_KEY/);
  });

  it("refuses a key of 15 characters or fewer", async () => {
    const tooShort = await cryptoWithKey("0123456789abcde"); // 15
    expect(() => tooShort.encrypt("x")).toThrow(/at least 16 characters/);

    const justEnough = await cryptoWithKey("0123456789abcdef"); // 16
    expect(() => justEnough.encrypt("x")).not.toThrow();
  });
});
