import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCurrentCampUser, pendingBlockingRoute } from "@/lib/session";
import {
  buildCampMeetingIcs,
  loadMeetingsAccess,
} from "@/lib/camp-meetings-store";

// "Add to my calendar" (docs/camp-meetings-spec.md): one meeting as an .ics
// download. The same boundary as the meeting page — a current member who can
// see this meeting — and the same answer for everything else: a plain 404,
// whether the camp, the meeting or the viewer's access is what's missing. A
// cancelled meeting has no file. Never cached: the file carries the call link.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A bare 404 that names nothing. */
function notFound(): Response {
  return new Response("Not found.", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

/** The meeting's .ics, for a viewer who may see it. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
): Promise<Response> {
  if (!isDatabaseConfigured()) return notFound();
  const user = await getCurrentCampUser();
  if (!user) return notFound();
  if (await pendingBlockingRoute(user.id)) return notFound();
  const { slug, id } = await params;
  const edition = await getActiveEdition();
  if (!edition) return notFound();
  const access = await loadMeetingsAccess(slug, user.id);
  if (!access) return notFound();
  const file = await buildCampMeetingIcs(
    access,
    { id: edition.id, startDate: edition.startDate, endDate: edition.endDate },
    id,
    { now: new Date(), origin: new URL(request.url).origin },
  );
  if (!file) return notFound();
  return new Response(file.body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
