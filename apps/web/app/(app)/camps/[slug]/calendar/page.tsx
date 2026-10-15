import Link from "next/link";
import { CalendarClock, Info } from "lucide-react";
import {
  calendarAgenda,
  calendarMonthGrid,
  calendarMonths,
  sastWallClock,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { PreviewNotice } from "@/components/preview-notice";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import {
  CalendarAgenda,
  CalendarLegend,
  CalendarMonth,
  MonthSwitcher,
} from "@/components/meetings/camp-calendar";
import { loadCampCalendar } from "@/lib/camp-meetings-store";
import { pickCalendarMonth, PHASE_LABEL } from "@/lib/meeting-view";
import { loadMeetingsContext } from "../meetings/context";

export const dynamic = "force-dynamic";

// /camps/[slug]/calendar (frame G4 rvZKo / Lyu2T). Read-only and derived:
// the edition's build, event and strike days, the meetings meant for this
// viewer and their OWN shifts — never anyone else's. Current members only
// (the meetings context's 404). A month view on wide screens, an agenda list
// on phones; `?month=YYYY-MM` picks the month.

/** The camp calendar. */
export default async function CampCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const ctx = await loadMeetingsContext(slug);
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp calendar" />;
  const { access, edition, meetingEdition } = ctx;
  const { camp } = access;
  const days = await loadCampCalendar(access, meetingEdition);
  const today = sastWallClock(new Date()).date;
  const months = calendarMonths(days, today);
  const month = pickCalendarMonth(months, (await searchParams).month, today);
  const phaseLabel = { ...PHASE_LABEL, event: edition.name };
  const basePath = `/camps/${camp.slug}/calendar`;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <ShiftsHeader
        backHref={`/camps/${camp.slug}`}
        backLabel={camp.name}
        title="Calendar"
        description={`The dates that matter for ${edition.name}: build, the event and strike, the meetings meant for you, and your own shifts.`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/camps/${camp.slug}/meetings`}>
              <CalendarClock className="h-4 w-4" aria-hidden />
              Meetings
            </Link>
          </Button>
        }
      />
      <section className="flex flex-col gap-4 md:rounded-xl md:border md:border-border md:bg-card md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <MonthSwitcher basePath={basePath} months={months} month={month} />
          <CalendarLegend eventLabel={edition.name} />
        </div>
        <div className="hidden md:block">
          <CalendarMonth
            slug={camp.slug}
            weeks={calendarMonthGrid(month, days)}
            today={today}
            phaseLabel={phaseLabel}
          />
        </div>
        <div className="flex flex-col gap-4 md:hidden">
          <CalendarAgenda
            slug={camp.slug}
            days={calendarAgenda(month, days)}
            allDays={days}
            phaseLabel={phaseLabel}
          />
          <p className="text-sm text-muted-foreground">
            Days with nothing on are left out. Tap a meeting to open it.
          </p>
        </div>
      </section>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Read-only. Build, event and strike dates come from AfrikaBurn. Meetings
        show only when they&apos;re meant for you, and your shifts are yours
        alone: nobody else sees them here.
      </p>
    </div>
  );
}
