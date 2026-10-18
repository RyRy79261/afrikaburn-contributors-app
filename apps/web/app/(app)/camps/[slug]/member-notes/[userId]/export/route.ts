import { z } from "zod";
import { getCurrentCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { exportMemberNotes } from "@/lib/member-records-store";

// The member-notes export (docs/member-records-spec.md §Export; #105): a camp
// lead downloads the camp's notes about ONE member as plain text, to send to
// that member when they ask under POPIA s23. The member never sees notes in
// the app; this file is the lead's to send.
//
// A ROUTE RATHER THAN A SERVER ACTION because the product is a FILE (the
// roster export's reasoning): a route sets Content-Disposition and the
// browser does the rest.
//
// AUTHORISED HERE, ON EVERY REQUEST: `exportMemberNotes` locks the actor's and
// the person's memberships, loads the actor's permissions live and asks
// @quagga/core `canExportMemberNotes` (a structural lead, co-lead or captain
// of THIS camp, about someone else in it). Every refusal — signed out, not a
// member, a note-keeper who is not a lead or captain, the member themself, a
// lead or captain of another camp, an org account, an unknown camp or person, a malformed id — is the
// SAME 404, so the route is no oracle for who has notes. The one other answer
// is a 503 to a lead when the encryption key is missing: no partial file.
//
// CROSS-SITE. A GET that writes an audit row and hands over personal
// information is refused when the browser says it came from another site
// (`Sec-Fetch-Site`), so a link elsewhere cannot make a lead's browser
// download a file — or write an audit row — they did not ask for.

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  slug: z.string().min(1).max(200),
  userId: z.string().uuid(),
});

const NO_STORE = {
  "Cache-Control": "private, no-store",
  "Content-Type": "text/plain; charset=utf-8",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
} as const;

function refusal(status: 404 | 503, message: string): Response {
  return new Response(message, { status, headers: NO_STORE });
}

const NOT_FOUND = "Not found";

/** A request the browser marks as coming from another site. Absent (an older
 * browser, a script) and `none` (typed into the address bar) are allowed. */
function isCrossSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site === "cross-site" || site === "same-site";
}

/** Next answers HEAD with GET when HEAD is not defined — which would run an
 * export and write its audit row for a request that never gets the file. */
export function HEAD(): Response {
  return new Response(null, {
    status: 405,
    headers: { ...NO_STORE, Allow: "GET" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; userId: string }> },
): Promise<Response> {
  if (isCrossSite(request)) return refusal(404, NOT_FOUND);
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) return refusal(404, NOT_FOUND);
  if (!isDatabaseConfigured()) return refusal(404, NOT_FOUND);

  const viewer = await getCurrentCampUser();
  if (!viewer) return refusal(404, NOT_FOUND);
  // The hard gate applies to a download exactly as to a page.
  await enforceGate(viewer.id);

  const result = await exportMemberNotes(viewer.id, {
    slug: parsed.data.slug,
    subjectUserId: parsed.data.userId,
  });
  if (!result.ok) {
    return result.reason === "unavailable"
      ? refusal(503, result.error)
      : refusal(404, NOT_FOUND);
  }

  return new Response(result.text, {
    status: 200,
    headers: {
      ...NO_STORE,
      // The filename is slugified in @quagga/core: ASCII letters, digits and
      // hyphens only, so nothing a person typed reaches this header.
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  });
}
