import "server-only";

// Server-side profile keypair generation (build-spec §apps/web `/onboarding`,
// §Schema `profile_keys`). Uses WebCrypto ECDSA P-256 (Node 22's global
// `crypto.subtle`). Generated once at onboarding; used for nothing yet except
// future QR attestations. The private key is stored encrypted; the public key
// is plaintext and its fingerprint is shown on the profile.

export interface GeneratedKeypair {
  /** Base64 of the raw (uncompressed) public key point. */
  publicKeyB64: string;
  /** Base64 of the PKCS#8-encoded private key (encrypt before storage). */
  privateKeyB64: string;
}

function toB64(buf: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buf)).toString("base64");
}

/** Generate an ECDSA P-256 keypair, exported to base64. */
export async function generateProfileKeypair(): Promise<GeneratedKeypair> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const [rawPublic, pkcs8Private] = await Promise.all([
    crypto.subtle.exportKey("raw", pair.publicKey),
    crypto.subtle.exportKey("pkcs8", pair.privateKey),
  ]);
  return {
    publicKeyB64: toB64(rawPublic),
    privateKeyB64: toB64(pkcs8Private),
  };
}

/**
 * A short, human-comparable fingerprint of a public key: the SHA-256 of its raw
 * bytes, hex, grouped in colon-separated pairs and truncated to 8 groups
 * (e.g. `a1:b2:c3:d4:e5:f6:07:18`). Deterministic, so the same key always shows
 * the same fingerprint on the profile.
 */
export async function fingerprintPublicKey(
  publicKeyB64: string,
): Promise<string> {
  const raw = Buffer.from(publicKeyB64, "base64");
  const digest = await crypto.subtle.digest("SHA-256", raw);
  const hex = Buffer.from(new Uint8Array(digest)).toString("hex");
  const pairs: string[] = [];
  for (let i = 0; i < 16; i += 2) pairs.push(hex.slice(i, i + 2));
  return pairs.join(":");
}
