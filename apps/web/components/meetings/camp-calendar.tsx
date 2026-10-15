import Link from "next/link";
import { CalendarClock, ChevronLeft, ChevronRight, Hammer } from "lucide-react";
import {
  formatClock,
  meetingPath,
  shiftDateLabel,
  shiftRangeLabel,
  type CalendarCell,
  type CalendarDay,
  type CalendarEntry,
  type ShiftPhase,
} from "@quagga/core";
import { cn } from "@quagga/ui/lib/utils";
import { meetingTimeRange, monthLabel, PHASE_BAND } from "@/lib/meeting-view";

// The camp calendar's pieces (frame G4 rvZKo / Lyu2T): read-only and derived.
// The month grid shows on wide screens, the agenda list on phones. Nothing
// here loads data — the page passes the viewer's own calendar in.

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Where an entry links: a meeting's page, or the viewer's own shifts. */
function entryHref(slug: string, e: CalendarEntry): string {
  return e.kind === "meeting"
    ? meetingPath(slug, e.id)
    : `/camps/${slug}/shifts/mine`;
}

/** The month switcher: previous, "April 2027", next. */
export function MonthSwitcher({
  basePath,
  months,
  month,
}: {
  basePath: string;
  months: readonly string[];
  month: string;
}) {
  const i = months.indexOf(month);
  const prev = i > 0 ? months[i - 1] : null;
  const next = i >= 0 && i < months.length - 1 ? months[i + 1] : null;
  const arrow =
    "inline-flex h-11 w-11 items-center justify-center rounded-md border border-input hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const off = "pointer-events-none opacity-40";
  return (
    <div className="flex items-center justify-between gap-3 md:justify-start">
      {prev ? (
        <Link
          href={`${basePath}?month=${prev}`}
          className={arrow}
          aria-label={`Previous month, ${monthLabel(prev)}`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(arrow, off)} aria-hidden>
          <ChevronLeft className="h-4 w-4" />
        </span>
      )}
      <h2 className="text-xl font-semibold" aria-live="polite">
        {monthLabel(month)}
      </h2>
      {next ? (
        <Link
          href={`${basePath}?month=${next}`}
          className={arrow}
          aria-label={`Next month, ${monthLabel(next)}`}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(arrow, off)} aria-hidden>
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}

/** The legend: Build, the event, Strike, Meeting, My shift. */
export function CalendarLegend({ eventLabel }: { eventLabel: string }) {
  const items: { label: string; swatch: string }[] = [
    { label: "Build", swatch: PHASE_BAND.build },
    { label: eventLabel, swatch: PHASE_BAND.event },
    { label: "Strike", swatch: PHASE_BAND.strike },
    { label: "Meeting", swatch: "bg-secondary" },
    { label: "My shift", swatch: "border border-border" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className={cn("h-3.5 w-3.5 rounded-sm", it.swatch)}
            aria-hidden
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** A meeting or shift chip inside a month cell. */
function EntryChip({ slug, entry }: { slug: string; entry: CalendarEntry }) {
  const meeting = entry.kind === "meeting";
  const cancelled = meeting && entry.cancelled;
  return (
    <Link
      href={entryHref(slug, entry)}
      className={cn(
        "flex items-start gap-1 rounded px-1.5 py-1 text-xs leading-tight hover:ring-1 hover:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        meeting ? "bg-secondary" : "border border-border",
        cancelled && "text-muted-foreground line-through",
      )}
    >
      {meeting ? (
        <CalendarClock
          className="mt-px h-3 w-3 shrink-0 text-primary"
          aria-hidden
        />
      ) : (
        <Hammer className="mt-px h-3 w-3 shrink-0" aria-hidden />
      )}
      <span className="min-w-0">
        <span className="sr-only">
          {meeting
            ? cancelled
              ? "Cancelled meeting: "
              : "Meeting: "
            : "Your shift: "}
        </span>
        {formatClock(entry.startMinute)} {entry.title}
      </span>
    </Link>
  );
}

/** The six-week Monday-first month view (wide screens). */
export function CalendarMonth({
  slug,
  weeks,
  today,
  phaseLabel,
}: {
  slug: string;
  weeks: CalendarCell[][];
  today: string;
  phaseLabel: Record<ShiftPhase, string>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week, w) => (
        <div
          key={week[0]?.date ?? w}
          className="grid grid-cols-7 border-b border-border last:border-b-0"
        >
          {week.map((cell, i) => {
            const phase = cell.day?.phase ?? null;
            const prevPhase = i > 0 ? (week[i - 1]?.day?.phase ?? null) : null;
            const label = shiftDateLabel(cell.date);
            return (
              <div
                key={cell.date}
                className={cn(
                  "flex min-h-28 min-w-0 flex-col gap-1 border-r border-border pb-1.5 last:border-r-0",
                  !cell.inMonth && "bg-muted/20 text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "px-2 pt-1.5 text-sm",
                    cell.date === today && "font-semibold text-primary",
                  )}
                >
                  {label.day === 1 ? `${label.day} ${label.month}` : label.day}
                </span>
                {phase ? (
                  <span
                    className={cn(
                      "h-6 truncate px-2 text-[11px] font-semibold uppercase leading-6 tracking-wide",
                      PHASE_BAND[phase],
                    )}
                  >
                    {phase !== prevPhase ? phaseLabel[phase] : ""}
                  </span>
                ) : null}
                <div className="flex flex-col gap-1 px-1">
                  {(cell.day?.entries ?? []).map((e) => (
                    <EntryChip
                      key={`${e.kind}-${e.id}`}
                      slug={slug}
                      entry={e}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** The phone agenda: only the month's days with something on. */
export function CalendarAgenda({
  slug,
  days,
  allDays,
  phaseLabel,
}: {
  slug: string;
  days: CalendarDay[];
  /** Every day of the calendar, for each phase's full range. */
  allDays: readonly CalendarDay[];
  phaseLabel: Record<ShiftPhase, string>;
}) {
  if (days.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Nothing on this month.
      </p>
    );
  }
  const firstOfPhase = new Map<ShiftPhase, string>();
  const lastOfPhase = new Map<ShiftPhase, string>();
  for (const d of allDays) {
    if (!d.phase) continue;
    if (!firstOfPhase.has(d.phase)) firstOfPhase.set(d.phase, d.date);
    lastOfPhase.set(d.phase, d.date);
  }
  const visible = days.filter(
    (d) =>
      d.entries.length > 0 || (d.phase && firstOfPhase.get(d.phase) === d.date),
  );
  return (
    <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card px-4">
      {visible.map((d) => {
        const label = shiftDateLabel(d.date);
        const startsPhase = d.phase && firstOfPhase.get(d.phase) === d.date;
        return (
          <li key={d.date} className="flex gap-4 py-4">
            <span className="flex w-10 shrink-0 flex-col items-center">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label.weekday}
              </span>
              <span className="text-xl font-semibold">{label.day}</span>
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {startsPhase && d.phase && (
                <div className={cn("rounded-lg p-3", PHASE_BAND[d.phase])}>
                  <p className="font-medium">{phaseLabel[d.phase]}</p>
                  <p className="text-sm">
                    {shiftRangeLabel(
                      d.date,
                      lastOfPhase.get(d.phase) ?? d.date,
                    )}
                  </p>
                </div>
              )}
              {d.entries.map((e) => (
                <Link
                  key={`${e.kind}-${e.id}`}
                  href={entryHref(slug, e)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    e.kind === "meeting"
                      ? "bg-secondary"
                      : "border border-border",
                  )}
                >
                  {e.kind === "meeting" ? (
                    <CalendarClock
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden
                    />
                  ) : (
                    <Hammer className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block font-medium",
                        e.kind === "meeting" &&
                          e.cancelled &&
                          "text-muted-foreground line-through",
                      )}
                    >
                      {e.title}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {meetingTimeRange(e.startMinute, e.durationMinutes)}
                      {e.kind === "shift"
                        ? " · your shift"
                        : e.cancelled
                          ? " · cancelled"
                          : ""}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
