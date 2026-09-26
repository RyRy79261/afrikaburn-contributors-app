// Profile-photo upload rules (epic #68). PURE: the upload route reads the bytes
// and asks this module whether they are an acceptable photo.
//
// RASTER ONLY, DECIDED BY THE BYTES. The declared Content-Type of a multipart
// part is whatever the client says it is, so it is never the check. An SVG is
// XML that can carry script, and a photo served from our own origin must never
// be a document a browser might execute — so the format is sniffed from the
// file's magic number and only three raster signatures pass. Everything else,
// SVG included (with or without an XML prolog, with or without a lying
// `image/png` label), is refused. The proxy then serves the SNIFFED type, never
// the uploaded one, with `nosniff`.

/** The only formats a profile photo may be. */
export const AVATAR_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];

/** Hard size cap. A profile photo is shown at thumbnail size; 2 MB is ample for
 * a phone photo and small enough that the route can buffer it to sniff. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0) {
  if (bytes.length < at + signature.length) return false;
  return signature.every((b, i) => bytes[at + i] === b);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG = [0xff, 0xd8, 0xff] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP" at offset 8

/**
 * The raster format these bytes actually are, or `null` when they are not one
 * of the three allowed formats. Reads the magic number only; never trusts a
 * filename or a declared type.
 */
export function sniffAvatarType(bytes: Uint8Array): AvatarContentType | null {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return "image/webp";
  }
  return null;
}

export type AvatarCheck =
  | { ok: true; contentType: AvatarContentType }
  | { ok: false; status: 400 | 413 | 415; error: string };

/** Validate an uploaded photo: non-empty, under the cap, and a real raster. */
export function checkAvatarUpload(bytes: Uint8Array): AvatarCheck {
  if (bytes.length === 0) {
    return { ok: false, status: 400, error: "That file is empty." };
  }
  if (bytes.length > AVATAR_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "That photo is larger than 2 MB. Try a smaller one.",
    };
  }
  const contentType = sniffAvatarType(bytes);
  if (!contentType) {
    return {
      ok: false,
      status: 415,
      error: "Upload a PNG, JPEG or WebP photo.",
    };
  }
  return { ok: true, contentType };
}

/** The blob pathname a user's photo is stored under. Namespaced by user so a
 * key can be checked as belonging to its owner before it is deleted. */
export function avatarBlobPrefix(userId: string): string {
  return `avatars/${userId}/`;
}

/** True when a stored key sits under this user's own prefix — the guard before
 * any delete, so a corrupted key can never make one account delete another's
 * blob. */
export function isOwnAvatarKey(userId: string, key: string): boolean {
  return key.startsWith(avatarBlobPrefix(userId)) && !key.includes("..");
}
