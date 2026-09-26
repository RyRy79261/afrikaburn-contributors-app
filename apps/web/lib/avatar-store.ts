import "server-only";

import { del, get, put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import {
  avatarBlobPrefix,
  isOwnAvatarKey,
  type AvatarContentType,
} from "@quagga/core";
import { db, schema } from "./db";

// Profile-photo storage (epic #68). Photos live in Vercel Blob with
// `access: "private"` — there is NO public URL for one. They are read back only
// through `/api/avatar/[userId]`, after `resolveAvatarForViewer` (campmates-
// store) has checked the photo's own visibility against the viewer. The same
// provider as the registration uploads (BLOB_READ_WRITE_TOKEN), so no new
// infrastructure; without the token every call here is refused, never crashes.

export function isAvatarStorageConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

const EXTENSION: Record<AvatarContentType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Delete a stored photo blob, but ONLY when the key sits under the owner's own
 * prefix — a corrupted key must never let one account's removal delete
 * another's file. Missing blobs are fine (`del` is idempotent).
 */
export async function deleteAvatarBlob(
  userId: string,
  key: string | null | undefined,
): Promise<void> {
  if (!key || !isOwnAvatarKey(userId, key)) return;
  await del(key);
}

/**
 * Store a new photo (bytes ALREADY checked by @quagga/core
 * `checkAvatarUpload`), point `users.avatar_key` at it, then delete the photo
 * it replaced. The content type stored with the blob is the SNIFFED one.
 */
export async function replaceAvatar(
  userId: string,
  bytes: Uint8Array,
  contentType: AvatarContentType,
): Promise<void> {
  const [current] = await db()
    .select({ avatarKey: schema.users.avatarKey })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const blob = await put(
    `${avatarBlobPrefix(userId)}photo.${EXTENSION[contentType]}`,
    Buffer.from(bytes),
    {
      access: "private",
      addRandomSuffix: true,
      contentType,
    },
  );
  await db()
    .update(schema.users)
    .set({ avatarKey: blob.pathname })
    .where(eq(schema.users.id, userId));

  // The old photo goes only AFTER the new key is committed, so a failure here
  // leaves an ORPHAN blob under this user's own prefix (logged, never served —
  // no key points at it any more) rather than a broken profile. Nothing sweeps
  // orphans yet; that is a known gap, not a guarantee.
  if (current?.avatarKey && current.avatarKey !== blob.pathname) {
    await deleteAvatarBlob(userId, current.avatarKey).catch((err) => {
      console.error("[avatar] could not delete the replaced photo", err);
    });
  }
}

/**
 * Remove the member's photo: delete the blob FIRST, then clear the key. If the
 * blob delete throws, the key stays and the caller reports failure — the
 * member is never told a photo is gone while its file still exists.
 */
export async function removeAvatar(userId: string): Promise<void> {
  const [current] = await db()
    .select({ avatarKey: schema.users.avatarKey })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!current?.avatarKey) return;
  await deleteAvatarBlob(userId, current.avatarKey);
  await db()
    .update(schema.users)
    .set({ avatarKey: null })
    .where(eq(schema.users.id, userId));
}

/** Does the member have a photo on file? (Owner-facing; says nothing about
 * who may see it.) */
export async function hasAvatar(userId: string): Promise<boolean> {
  const [row] = await db()
    .select({ avatarKey: schema.users.avatarKey })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return Boolean(row?.avatarKey);
}

/** Stream a stored photo, or null when it is missing. */
export async function readAvatarBlob(key: string) {
  const result = await get(key, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return result;
}
