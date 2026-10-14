import { NextResponse } from "next/server";
import { z } from "zod";
import { checkReceiptUpload, RECEIPT_MAX_BYTES } from "@quagga/core";
import { ReceiptSubjectKind } from "@quagga/types";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCurrentCampUser, pendingBlockingRoute } from "@/lib/session";
import { isReceiptStorageConfigured } from "@/lib/camp-receipt-blob";
import { attachReceipt, loadMoneyAccess } from "@/lib/camp-money-store";

// Add or replace a receipt on a camp money record (docs/camp-budget-spec.md):
// an entry (money people) or the caller's OWN claim while it waits for a
// decision. Multipart: `slug`, `kind` ("claim" | "entry"), `id`, `file`.
//
// A route, not a server action, because a server action's body is capped at
// 1 MB and a phone photo of a till slip is not. The record is created first
// (by its action); the receipt follows here.
//
// The same boundary as the profile-photo upload (app/api/avatar/route.ts):
//   · a cross-site request is refused before the session is read;
//   · the bytes are checked by @quagga/core `checkReceiptUpload` — size cap,
//     then the format SNIFFED from the bytes (the declared type is ignored);
//   · without BLOB_READ_WRITE_TOKEN the upload is refused with a message
//     (501) — nothing crashes, the record stays without its receipt;
//   · WHO may attach to WHICH record is decided inside the store's
//     transaction (`attachReceipt`), over the caller's locked membership.
// A camp the caller is not in answers exactly like one that does not exist.

export const runtime = "nodejs";

const TOO_BIG = "That receipt is larger than 4 MB. Try a smaller photo.";

const Fields = z
  .object({
    slug: z.string().min(1).max(200),
    kind: ReceiptSubjectKind,
    id: z.string().uuid(),
  })
  .strict();

function isCrossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

function fail(error: string, status: number): Response {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (isCrossSite(request)) return fail("Forbidden.", 403);
  if (!isDatabaseConfigured()) {
    return fail("Receipts aren't available on this deployment.", 501);
  }
  const user = await getCurrentCampUser();
  if (!user) return fail("Sign in first.", 401);
  if (await pendingBlockingRoute(user.id)) {
    return fail("Finish your onboarding first.", 403);
  }

  // Cheap early refusal on the declared length; the real cap is enforced on
  // the bytes actually read below.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > RECEIPT_MAX_BYTES + 64 * 1024) return fail(TOO_BIG, 413);

  const form = await request.formData().catch(() => null);
  if (!form) return fail("No file provided.", 400);
  const fields = Fields.safeParse({
    slug: form.get("slug"),
    kind: form.get("kind"),
    id: form.get("id"),
  });
  if (!fields.success) return fail("Camp not found.", 404);
  const file = form.get("file");
  if (!(file instanceof File)) return fail("No file provided.", 400);
  if (file.size > RECEIPT_MAX_BYTES) return fail(TOO_BIG, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkReceiptUpload(bytes);
  if (!check.ok) return fail(check.error, check.status);

  // After the file check on purpose: a refusal of the file itself does not
  // depend on the deployment, so it reads the same everywhere.
  if (!isReceiptStorageConfigured()) {
    return fail(
      "Receipt uploads aren't configured on this deployment. The record is saved without it.",
      501,
    );
  }

  const access = await loadMoneyAccess(fields.data.slug, user.id);
  if (!access) return fail("Camp not found.", 404);
  const edition = await getActiveEdition();
  if (!edition) return fail("No active edition is configured.", 404);

  try {
    const result = await attachReceipt({
      actorUserId: user.id,
      groupId: access.camp.id,
      editionId: edition.id,
      kind: fields.data.kind,
      id: fields.data.id,
      receipt: { bytes },
    });
    if (!result.ok) return fail(result.error, 400);
  } catch (err) {
    console.error("[receipts] upload failed", err);
    return fail("We couldn't save that receipt. Please try again.", 500);
  }
  return NextResponse.json({ ok: true });
}
