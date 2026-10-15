import Link from "next/link";
import {
  ChevronRight,
  Clock,
  ExternalLink,
  MapPin,
  NotebookPen,
  Video,
} from "lucide-react";
import { meetingPath } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { cn } from "@quagga/ui/lib/utils";
import type { MeetingListItem } from "@/lib/camp-meetings-store";
import { meetingTimeRange } from "@/lib/meeting-view";
import { AudienceChip } from "./audience-chip";
import { MeetingDateBlock } from "./date-block";

/**
 * One meeting on the list (frame G1): date block, title, audience chip, time,
 * place or "Online", and — for an upcoming meeting with a call — "Join call".
 * The call link is a plain external link, `rel="noopener noreferrer"`.
 */
export function MeetingRow({
  slug,
  meeting,
  upcoming,
}: {
  slug: string;
  meeting: MeetingListItem;
  upcoming: boolean;
}) {
  const cancelled = meeting.cancelledAt !== null;
  const href = meetingPath(slug, meeting.id);
  return (
    <li className="relative flex flex-col gap-3 px-4 py-3 hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-4 sm:items-center">
        <MeetingDateBlock date={meeting.date} muted={cancelled} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={href}
              className={cn(
                "font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring",
                cancelled && "text-muted-foreground",
              )}
            >
              {meeting.title}
            </Link>
            <AudienceChip audience={meeting.audience} />
            {cancelled && <Badge variant="destructive">Cancelled</Badge>}
          </div>
          <p className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {meetingTimeRange(meeting.startMinute, meeting.durationMinutes)}
            </span>
            {meeting.location && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{meeting.location}</span>
              </span>
            )}
            {meeting.videoLink && (
              <span className="inline-flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5" aria-hidden />
                Online
              </span>
            )}
            {!upcoming && (meeting.hasNotes || meeting.attendeeCount > 0) && (
              <span className="inline-flex items-center gap-1.5">
                <NotebookPen className="h-3.5 w-3.5" aria-hidden />
                {[
                  meeting.hasNotes ? "Notes" : null,
                  meeting.attendeeCount > 0
                    ? `${meeting.attendeeCount} came`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </p>
        </div>
      </div>
      {upcoming && meeting.videoLink && (
        <a
          href={meeting.videoLink}
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-10 inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          Join call
        </a>
      )}
      <ChevronRight
        className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block"
        aria-hidden
      />
    </li>
  );
}
