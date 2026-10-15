import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { meetingPath } from "@quagga/core";
import type { MeetingListItem } from "@/lib/camp-meetings-store";
import { meetingWhenLine } from "@/lib/meeting-view";

/**
 * The camp page's way into Meetings (frame G1 state 3): the next meeting meant
 * for this member, or a line saying there is none. Members only — the camp
 * page never loads it for anyone else.
 */
export function MeetingsTile({
  slug,
  next,
  canSchedule,
}: {
  slug: string;
  next: MeetingListItem | null;
  canSchedule: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <CalendarClock className="h-4 w-4 text-accent" aria-hidden />
      <p className="text-sm font-medium">Meetings</p>
      {next ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Next
          </span>
          <Link
            href={meetingPath(slug, next.id)}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {next.title}
          </Link>
          <span className="text-xs text-muted-foreground">
            {meetingWhenLine(next)}
            {next.location ? ` · ${next.location}` : ""}
            {!next.location && next.videoLink ? " · Online" : ""}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {canSchedule
            ? "Schedule the camp's calls and get-togethers — the link, the agenda and the notes in one place."
            : "No meetings coming up for you."}
        </p>
      )}
      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1">
        <Link
          href={`/camps/${slug}/meetings`}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          All meetings
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href={`/camps/${slug}/calendar`}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Calendar
        </Link>
      </div>
    </div>
  );
}
