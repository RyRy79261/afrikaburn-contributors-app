import { z } from "zod";
import { AVATAR_CONTENT_TYPES } from "@quagga/core";
import { getCurrentCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { resolveAvatarForViewer } from "@/lib/campmates-store";
import { isAvatarStorageConfigured, readAvatarBlob } from "@/lib/avatar-store";

// THE ONLY WAY A PROFILE PHOTO LEAVES THE BLOB STORE (epic #68).
//
// Photos are private blobs with no public URL. This route serves one after
// `resolveAvatarForViewer` — i.e. @quagga/core `canViewAvatar` over the
// viewer's and subject's live memberships and the photo's own visibility
// level for the current edition — says yes. Every refusal is the SAME 404
// ("no such photo"): not signed in, not allowed, no photo, deleted account and
// malformed id are indistinguishable, so the route is no oracle for who has a
// photo or who is whose camp-mate.
//
// Response hardening, because this streams user-supplied bytes from our own
// origin:
//   · Content-Type is the SNIFFED raster type stored at upload, and anything
//     else is refused — never an SVG, never HTML;
//   · `nosniff`, a sandboxing CSP and `inline` disposition;
//   · `Cache-Control: private, no-store` + `Vary: Cookie`, so no shared cache
//     can hand one viewer's permitted photo to a viewer who is not permitted.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ userId: z.string().uuid() });
const ALLOWED_TYPES: ReadonlySet<string> = new Set(AVATAR_CONTENT_TYPES);

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
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) return notFound();
  if (!isDatabaseConfigured() || !isAvatarStorageConfigured()) {
    return notFound();
  }

  const viewer = await getCurrentCampUser();
  if (!viewer) return notFound();
  const edition = await getActiveEdition();
  if (!edition) return notFound();

  const key = await resolveAvatarForViewer({
    viewerUserId: viewer.id,
    subjectUserId: parsed.data.userId,
    editionId: edition.id,
  });
  if (!key) return notFound();

  const blob = await readAvatarBlob(key).catch(() => null);
  if (!blob || !ALLOWED_TYPES.has(blob.blob.contentType)) return notFound();

  return new Response(blob.stream, {
    status: 200,
    headers: {
      "Content-Type": blob.blob.contentType,
      "Content-Length": String(blob.blob.size),
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
