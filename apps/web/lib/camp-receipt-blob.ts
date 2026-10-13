import "server-only";

import { del, get, put } from "@vercel/blob";
import {
  campReceiptPath,
  isCampReceiptKey,
  type ReceiptContentType,
} from "@quagga/core";

// Camp money receipts (docs/camp-budget-spec.md) in Vercel Blob, the same
// private store and token as profile photos (lib/avatar-store.ts). Every
// receipt is `access: "private"` under its camp's own prefix
// (@quagga/core `campReceiptPrefix`) — there is NO public URL for one. A
// receipt is read back only through the authorised receipt route, after
// `resolveReceiptForViewer` (camp-money-store) has said the viewer is a money
// person or the claimant. Without BLOB_READ_WRITE_TOKEN every upload is
// refused with a message and nothing crashes (apps boot env-less).

export function isReceiptStorageConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Store receipt bytes (ALREADY checked by @quagga/core `checkReceiptUpload`)
 * and return the private pathname. The content type stored is the SNIFFED
 * one. */
export async function putReceiptBlob(
  groupId: string,
  bytes: Uint8Array,
  contentType: ReceiptContentType,
): Promise<string> {
  const blob = await put(
    campReceiptPath(groupId, contentType),
    Buffer.from(bytes),
    { access: "private", addRandomSuffix: true, contentType },
  );
  return blob.pathname;
}

/** Delete a receipt, but ONLY when the key sits under this camp's prefix — a
 * corrupted key must never delete another camp's file. `del` is idempotent. */
export async function deleteReceiptBlob(
  groupId: string,
  key: string | null | undefined,
): Promise<void> {
  if (!key || !isCampReceiptKey(groupId, key)) return;
  await del(key);
}

/** Best-effort delete after a commit: a failure leaves an orphan under the
 * camp's own prefix that nothing points at (logged, never served). */
export async function deleteReceiptBlobQuietly(
  groupId: string,
  key: string | null | undefined,
): Promise<void> {
  try {
    await deleteReceiptBlob(groupId, key);
  } catch (err) {
    console.error("[receipts] could not delete a receipt blob", err);
  }
}

/** Stream a stored receipt, or null when it is missing. */
export async function readReceiptBlob(groupId: string, key: string) {
  if (!isCampReceiptKey(groupId, key)) return null;
  const result = await get(key, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return result;
}
