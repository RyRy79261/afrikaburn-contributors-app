import { z } from "zod";
import { getCurrentCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { exportCampRosterCsv } from "@/lib/roster-store";

// The lead roster export (epic #55, CDB-030).
//
// A ROUTE RATHER THAN A SERVER ACTION because the product is a FILE — the same
// reasoning as the org's placement export: a route sets Content-Disposition
// and the browser does the rest.
//
// AUTHORISED HERE, ON EVERY REQUEST: `exportCampRosterCsv` resolves the
// viewer's membership of THIS camp and asks @quagga/core
// `canExportCampRoster` (the `view_member_details` permission; lead/admin
// always). Every refusal — signed out, not a member, a member without the
// permission, a lead of another camp, a camp that does not exist, a malformed
// slug — is the SAME 404, so the route is no oracle for which camps exist.
//
// WHAT IS NOT IN THE FILE is enforced one layer down: core's
// `RosterExportRow` has no column for a phone number, an emergency contact, an
// ID or passport number or a medical note, and every cell goes through the
// formula-injection guard.

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ slug: z.string().min(1).max(200) });

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
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) return notFound();
  if (!isDatabaseConfigured()) return notFound();

  const viewer = await getCurrentCampUser();
  if (!viewer) return notFound();
  // The hard gate applies to a download exactly as to a page: a lead with a
  // blocking questionnaire outstanding answers it first.
  await enforceGate(viewer.id);

  const edition = await getActiveEdition();
  if (!edition) return notFound();

  // The page's filter, carried on the link, so the file is what the lead sees.
  const url = new URL(request.url);
  const searchParams: Record<string, string> = {};
  for (const key of ["q", "role", "bio"]) {
    const value = url.searchParams.get(key);
    if (value !== null) searchParams[key] = value;
  }

  const result = await exportCampRosterCsv({
    slug: parsed.data.slug,
    viewerUserId: viewer.id,
    editionId: edition.id,
    editionYear: edition.year,
    searchParams,
  });
  if (!result) return notFound();

  return new Response(result.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      // Personal data about named people: never in a shared cache, and a
      // cached copy is a stale roster anyway.
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
