import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CalendarDays,
  CalendarPlus,
  CalendarX,
  ExternalLink,
  ListChecks,
  MapPin,
  Pencil,
  Video,
} from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { MarkdownView } from "@quagga/ui/components/markdown-editor/markdown-view";
import { PreviewNotice } from "@/components/preview-notice";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { AudienceChip } from "@/components/meetings/audience-chip";
import { CancelMeetingButton } from "@/components/meetings/cancel-meeting";
import { MeetingNotes } from "@/components/meetings/meeting-notes";
import { MeetingVersionProvider } from "@/components/meetings/meeting-version";
import { WhoCame } from "@/components/meetings/who-came";
import { loadCampMeeting } from "@/lib/camp-meetings-store";
import {
  displayLink,
  meetingDurationLabel,
  meetingLongDate,
  meetingTimeRange,
} from "@/lib/meeting-view";
import { loadMeetingsContext } from "../context";

export const dynamic = "force-dynamic";

// /camps/[slug]/meetings/[id] (frame G2 mxFqi / vt8Cf). A meeting the viewer
// is not in the audience for gets exactly the 404 an unknown id gets — the
// store returns null for both. The call link is a plain external link with
// rel="noopener noreferrer", never embedded. A cancelled meeting stays
// readable with its agenda and notes, but offers no call and no .ics.

/** "21 Mar 2027, 20:14" in South African time — the zone meeting times are
 * read in (docs/camp-meetings-spec.md, Rules). */
function stamp(d: Date): string {
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  });
}

/** One of the When / Where / Call blocks. */
function Fact({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}

/** The meeting page. */
export default async function MeetingPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const ctx = await loadMeetingsContext(slug);
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp meetings" />;
  const { access, meetingEdition } = ctx;
  const meeting = await loadCampMeeting(access, meetingEdition, id);
  if (!meeting) notFound();
  const { camp } = access;
  const cancelled = meeting.cancelledAt !== null;
  const base = `/camps/${camp.slug}/meetings/${meeting.id}`;
  const lastEdited =
    meeting.notesUpdatedAt && meeting.notesUpdatedByName
      ? `Last edited by ${meeting.notesUpdatedByName} · ${stamp(meeting.notesUpdatedAt)}`
      : null;

  return (
    <MeetingVersionProvider version={meeting.version}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <ShiftsHeader
          backHref={`/camps/${camp.slug}/meetings`}
          backLabel="Meetings"
          title={meeting.title}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <AudienceChip audience={meeting.audience} />
              {cancelled && <Badge variant="destructive">Cancelled</Badge>}
              {meeting.createdByName && (
                <span>Scheduled by {meeting.createdByName}</span>
              )}
            </span>
          }
          actions={
            meeting.canEdit && !cancelled ? (
              <>
                <Button
                  asChild
                  variant="outline"
                  className="flex-1 sm:flex-none"
                >
                  <Link href={`${base}/edit`}>
                    <Pencil className="h-4 w-4" aria-hidden />
                    Edit
                  </Link>
                </Button>
                <CancelMeetingButton
                  slug={camp.slug}
                  meetingId={meeting.id}
                  className="flex-1 sm:flex-none"
                />
              </>
            ) : undefined
          }
        />

        {cancelled && meeting.cancelledAt && (
          <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
            <CalendarX
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
              aria-hidden
            />
            <p className="text-sm">
              Cancelled on {stamp(meeting.cancelledAt).split(",")[0]}
              {meeting.cancelledByName ? ` by ${meeting.cancelledByName}` : ""}.
              Everyone it was for got a notice. The agenda and notes stay here.
            </p>
          </div>
        )}

        <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5">
          <div className="grid gap-5 md:grid-cols-3">
            <Fact
              icon={<CalendarDays className="h-4 w-4" aria-hidden />}
              label="When"
            >
              <p className="font-medium">{meetingLongDate(meeting.date)}</p>
              <p className="text-sm text-muted-foreground">
                {meetingTimeRange(meeting.startMinute, meeting.durationMinutes)}{" "}
                · {meetingDurationLabel(meeting.durationMinutes)}
              </p>
            </Fact>
            <Fact
              icon={<MapPin className="h-4 w-4" aria-hidden />}
              label="Where"
            >
              <p className="break-words font-medium">
                {meeting.location ?? (meeting.videoLink ? "Online" : "Not set")}
              </p>
              {!meeting.location && (
                <p className="text-sm text-muted-foreground">No place set</p>
              )}
            </Fact>
            {meeting.videoLink && (
              <Fact
                icon={<Video className="h-4 w-4" aria-hidden />}
                label="Call"
              >
                <a
                  href={meeting.videoLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block break-all font-mono text-sm underline-offset-4 hover:underline"
                >
                  {displayLink(meeting.videoLink)}
                  <ExternalLink
                    className="ml-1.5 inline h-3.5 w-3.5 align-[-2px] text-primary"
                    aria-hidden
                  />
                </a>
                <p className="text-sm text-muted-foreground">
                  Opens in a new tab
                </p>
              </Fact>
            )}
          </div>
          {!cancelled && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              {meeting.videoLink && (
                <Button asChild className="w-full sm:w-auto">
                  <a
                    href={meeting.videoLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden />
                    Join call
                  </a>
                </Button>
              )}
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <a href={`${base}/ics`} download>
                  <CalendarPlus className="h-4 w-4" aria-hidden />
                  Add to my calendar
                </a>
              </Button>
              <p className="text-sm text-muted-foreground">
                Downloads an .ics file for your own calendar app.
              </p>
            </div>
          )}
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <section
              aria-labelledby="agenda-heading"
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
            >
              <h2
                id="agenda-heading"
                className="flex items-center gap-2 font-semibold"
              >
                <ListChecks className="h-4 w-4 text-primary" aria-hidden />
                Agenda
              </h2>
              {meeting.agendaMd.trim() ? (
                <MarkdownView value={meeting.agendaMd} />
              ) : (
                <p className="text-sm text-muted-foreground">No agenda.</p>
              )}
            </section>
            <MeetingNotes
              slug={camp.slug}
              meetingId={meeting.id}
              notesMd={meeting.notesMd}
              version={meeting.version}
              lastEdited={lastEdited}
              canEdit={meeting.canEditNotes}
            />
          </div>
          <WhoCame
            slug={camp.slug}
            meetingId={meeting.id}
            attendees={meeting.attendees}
            tickList={meeting.tickList}
            cancelled={cancelled}
          />
        </div>
      </div>
    </MeetingVersionProvider>
  );
}
