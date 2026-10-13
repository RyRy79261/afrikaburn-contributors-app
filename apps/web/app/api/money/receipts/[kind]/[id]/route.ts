import { z } from "zod";
import { ReceiptSubjectKind } from "@quagga/types";
import { isDatabaseConfigured } from "@/lib/config";
import { getCurrentCampUser } from "@/lib/session";
import {
  isReceiptStorageConfigured,
  readReceiptBlob,
} from "@/lib/camp-receipt-blob";
import { resolveReceiptForViewer } from "@/lib/camp-money-store";

// THE ONLY WAY A CAMP RECEIPT LEAVES THE BLOB STORE (docs/camp-budget-spec.md).
//
// Receipts are private blobs with no public URL. This route serves one after
// `resolveReceiptForViewer` — @quagga/core `canViewReceipt` over the viewer's
// live membership of the record's camp — says yes: a money person of that
// camp, or a claim's own claimant. Every refusal is the SAME 404: not signed
// in, not allowed, no receipt, no such record and a malformed id are
// indistinguishable, so the route is no oracle for which receipts exist.
//
// Response hardening, as for profile photos (app/api/avatar/[userId]):
//   · Content-Type is the SNIFFED type stored at upload, re-checked against
//     the receipt allow-list — never SVG, never HTML;
//   · `nosniff`, a sandboxing CSP, `private, no-store` + `Vary: Cookie`;
//   · images open inline; a PDF is served as a DOWNLOAD — browsers' built-in
//     PDF viewers do not run under a sandboxing CSP, and serving a PDF inline
//     without one would hand an uploaded document a scripting surface on our
//     own origin.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  kind: ReceiptSubjectKind,
  id: z.string().uuid(),
});

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
): Promise<Response> {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) return notFound();
  if (!isDatabaseConfigured() || !isReceiptStorageConfigured()) {
    return notFound();
  }

  const viewer = await getCurrentCampUser();
  if (!viewer) return notFound();

  const receipt = await resolveReceiptForViewer({
    viewerUserId: viewer.id,
    kind: parsed.data.kind,
    id: parsed.data.id,
  });
  if (!receipt) return notFound();

  const blob = await readReceiptBlob(receipt.groupId, receipt.key).catch(
    () => null,
  );
  // The stored type must still be the one recorded at upload.
  if (!blob || blob.blob.contentType !== receipt.contentType) return notFound();

  const isPdf = receipt.contentType === "application/pdf";
  return new Response(blob.stream, {
    status: 200,
    headers: {
      "Content-Type": receipt.contentType,
      "Content-Length": String(blob.blob.size),
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": isPdf
        ? 'attachment; filename="receipt.pdf"'
        : "inline",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
