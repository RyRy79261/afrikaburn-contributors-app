import Link from "next/link";
import { CalendarClock, CalendarDays, History, Lock, Plus } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { PreviewNotice } from "@/components/preview-notice";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { MeetingRow } from "@/components/meetings/meeting-row";
import { listCampMeetings } from "@/lib/camp-meetings-store";
import { loadMeetingsContext } from "./context";

export const dynamic = "force-dynamic";

// /camps/[slug]/meetings (frame G1 aP9oV / pLZ0n). Current members only (the
// context's 404); the store returns only the meetings meant for this viewer —
// a meeting for other roles is not listed, not even as a title.

/** The camp's meetings: upcoming soonest first, then past and cancelled. */
export default async function CampMeetingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadMeetingsContext(slug);
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp meetings" />;
  const { access, edition, meetingEdition } = ctx;
  const { camp, canSchedule } = access;
  const { upcoming, past } = await listCampMeetings(
    access,
    meetingEdition,
    new Date(),
  );
  const base = `/camps/${camp.slug}/meetings`;
  const none = upcoming.length === 0 && past.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <ShiftsHeader
        backHref={`/camps/${camp.slug}`}
        backLabel={camp.name}
        title="Meetings"
        description={`The camp's calls and get-togethers for ${edition.name}, with the link, the agenda and the notes in one place.`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/camps/${camp.slug}/calendar`}>
                <CalendarDays className="h-4 w-4" aria-hidden />
                Calendar
              </Link>
            </Button>
            {canSchedule && (
              <Button asChild>
                <Link href={`${base}/new`}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Schedule meeting
                </Link>
              </Button>
            )}
          </>
        }
      />

      {none ? (
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" />}
          title={canSchedule ? "No meetings yet" : "Nothing scheduled yet"}
          description={
            canSchedule
              ? "Schedule the camp's first call. The link, the agenda and the notes then live here."
              : "When the camp's organisers schedule a meeting for you, it shows here and you get a notice."
          }
          action={
            canSchedule ? (
              <Button asChild>
                <Link href={`${base}/new`}>Schedule meeting</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <section
            aria-labelledby="upcoming-heading"
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <div>
              <h2
                id="upcoming-heading"
                className="flex items-center gap-2 font-semibold"
              >
                <CalendarClock className="h-4 w-4 text-primary" aria-hidden />
                Upcoming
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Meetings meant for you, soonest first. Times are as the
                organiser typed them.
              </p>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing coming up.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {upcoming.map((m) => (
                  <MeetingRow
                    key={m.id}
                    slug={camp.slug}
                    meeting={m}
                    upcoming
                  />
                ))}
              </ul>
            )}
          </section>

          {past.length > 0 && (
            <section
              aria-labelledby="past-heading"
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
            >
              <div>
                <h2
                  id="past-heading"
                  className="flex items-center gap-2 font-semibold"
                >
                  <History className="h-4 w-4 text-primary" aria-hidden />
                  Past and cancelled
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Notes and who came stay with each meeting afterwards. A
                  cancelled meeting stays readable.
                </p>
              </div>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {past.map((m) => (
                  <MeetingRow
                    key={m.id}
                    slug={camp.slug}
                    meeting={m}
                    upcoming={false}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Only members of the camp see its meetings. A meeting for chosen roles
        shows only to people in those roles, the camp&apos;s leads and whoever
        scheduled it.
      </p>
    </div>
  );
}
