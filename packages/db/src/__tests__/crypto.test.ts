import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt, decryptOrNull } from "../crypto";

// The crypto helper reads PGCRYPTO_KEY at call time (lazily, then caches).
beforeAll(() => {
  process.env.PGCRYPTO_KEY = "test-key-at-least-16-chars-long";
});

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
});
