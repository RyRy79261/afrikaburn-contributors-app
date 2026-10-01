import Link from "next/link";
import { CalendarClock, Pencil, Plus } from "lucide-react";
import {
  dayGapLabel,
  formatShiftTime,
  openSpots,
  shiftDateLabel,
  shiftRangeLabel,
  summariseDays,
  summariseShifts,
  type ShiftDay,
  type ShiftPhase,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { cn } from "@quagga/ui/lib/utils";
import type { ShiftBoard } from "@/lib/shifts-store";
import { AssignDialog } from "./assign-dialog";
import { TeamFilter } from "./team-filter";
import { candidatesFor, namesOn, shiftLabel } from "./view-model";

// The lead's Shifts overview (canvas S1 `gAQnT` / `BPuki`): headline numbers,
// the week strip with each day's gaps, a team filter, and one day's shifts
// with who is on each and where the gaps are.

const PHASE_LABEL: Record<ShiftPhase, string> = {
  build: "Build",
  event: "Event",
  strike: "Strike",
};

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function LeadOverview({
  slug,
  board,
  days,
  selectedDay,
  teamFilter,
}: {
  slug: string;
  board: ShiftBoard;
  days: ShiftDay[];
  selectedDay: string;
  teamFilter: string | null;
}) {
  const base = `/camps/${slug}/shifts`;
  const filtered = teamFilter
    ? board.shifts.filter((s) => s.teamId === teamFilter)
    : board.shifts;
  const counts = board.shifts.map((s) => ({
    date: s.date,
    capacity: s.capacity,
    filled: s.assignments.length,
  }));
  const stats = summariseShifts(counts);
  const week = summariseDays(
    days,
    filtered.map((s) => ({
      date: s.date,
      capacity: s.capacity,
      filled: s.assignments.length,
    })),
  );
  const onAShift = new Set(
    board.shifts.flatMap((s) => s.assignments.map((a) => a.membershipId)),
  ).size;
  const dayShifts = filtered.filter((s) => s.date === selectedDay);
  const dayOpen = dayShifts.reduce((n, s) => n + openSpots(s), 0);
  const q = (day: string, team: string | null) =>
    `${base}?day=${day}${team ? `&team=${team}` : ""}`;

  if (board.shifts.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock className="h-6 w-6" />}
        title="No shifts yet"
        description="Set up the kitchen, tea bar, sound or MOOP rota once and repeat it across the days you need. Members pick what suits them; you fill the gaps."
        action={
          <Button asChild>
            <Link href={`${base}/new`}>
              <Plus className="h-4 w-4" aria-hidden />
              New shift
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Shifts"
          value={String(stats.shifts)}
          sub={shiftRangeLabel(stats.firstDate, stats.lastDate)}
        />
        <Stat
          label="Spots filled"
          value={`${stats.filled} of ${stats.spots}`}
          sub={stats.percentFilled === null ? null : `${stats.percentFilled}%`}
        />
        <Stat
          label="Open spots"
          value={String(stats.open)}
          sub={
            stats.daysWithGaps === 0
              ? "every shift is full"
              : `across ${stats.daysWithGaps} day${stats.daysWithGaps === 1 ? "" : "s"}`
          }
        />
        <Stat
          label="On a shift"
          value={`${onAShift} of ${board.members.length}`}
          sub="people in the camp"
        />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          The week
        </h2>
        <nav
          aria-label="Days"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:grid lg:grid-flow-col lg:auto-cols-fr lg:overflow-visible lg:px-0"
        >
          {week.map((d) => {
            const label = dayGapLabel(d);
            const active = d.date === selectedDay;
            return (
              <Link
                key={d.date}
                href={q(d.date, teamFilter)}
                aria-current={active ? "date" : undefined}
                className={cn(
                  "flex min-w-[6.5rem] shrink-0 flex-col rounded-md border px-3 py-2 lg:min-w-0 lg:px-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-wide",
                    d.phase === "event"
                      ? "text-muted-foreground"
                      : "text-primary",
                  )}
                >
                  {PHASE_LABEL[d.phase]}
                </span>
                <span className="text-sm font-medium">
                  {shiftDateLabel(d.date).short}
                </span>
                <span
                  className={cn(
                    "text-xs",
                    d.shifts === 0
                      ? "text-muted-foreground"
                      : d.open === 0
                        ? "text-success"
                        : "text-warning",
                  )}
                >
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>
        {week.length > 4 && (
          <p className="text-xs text-muted-foreground lg:hidden">
            Swipe for more days →
          </p>
        )}
      </section>

      {board.teams.length > 0 && (
        <TeamFilter
          teams={board.teams.map((t) => ({
            id: t.id,
            name: t.name,
            href: q(selectedDay, t.id),
          }))}
          allHref={q(selectedDay, null)}
          active={teamFilter}
        />
      )}

      <section
        className="overflow-hidden rounded-xl border border-border bg-card"
        aria-labelledby="day-heading"
      >
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-4">
          <h2 id="day-heading" className="text-lg font-semibold">
            {shiftDateLabel(selectedDay).long}
          </h2>
          <span className="text-sm text-muted-foreground">
            {dayShifts.length} shift{dayShifts.length === 1 ? "" : "s"} ·{" "}
            {dayOpen} open spot{dayOpen === 1 ? "" : "s"}
          </span>
        </header>
        {dayShifts.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No shifts on this day{teamFilter ? " for this team" : ""}.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {dayShifts.map((s) => {
              const gaps = openSpots(s);
              const { candidates, excludedNote } = candidatesFor(
                s,
                board.members,
                board.shifts,
              );
              const sub = s.requiredRoleName
                ? `Needs ${s.requiredRoleName}`
                : (s.teamName ??
                  (s.signupMode === "assign" ? "Leads assign" : null));
              return (
                <li
                  key={s.id}
                  data-testid="lead-shift-row"
                  className={cn(
                    "flex flex-col gap-1.5 px-5 py-4 md:grid md:grid-cols-[7.5rem_1fr_1fr_auto_auto] md:items-center md:gap-4",
                    gaps > 0 && "bg-warning/5",
                  )}
                >
                  {/* On a phone the time and the count share the top line
                      (canvas `BPuki`); from md up they are grid columns. */}
                  <div className="flex items-center justify-between gap-2 md:contents">
                    <span className="font-mono text-sm md:order-1">
                      {formatShiftTime(s.startMinute, s.durationMinutes)}
                    </span>
                    <span className="flex items-center gap-2 text-sm font-medium md:order-4">
                      {s.assignments.length} of {s.capacity}
                      {gaps === 0 ? (
                        <Badge variant="success">Full</Badge>
                      ) : (
                        <Badge variant="warning">
                          {gaps} gap{gaps === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </span>
                  </div>
                  <div className="min-w-0 md:order-2">
                    <p className="font-medium">{s.name}</p>
                    {sub && (
                      <p className="text-sm text-muted-foreground">{sub}</p>
                    )}
                  </div>
                  <p
                    className={cn(
                      "text-sm md:order-3",
                      s.assignments.length === 0 && "text-muted-foreground",
                    )}
                  >
                    {namesOn(s)}
                    {s.assignments.some((a) => a.offered || a.handoverTo) && (
                      <span className="block text-xs text-muted-foreground">
                        {s.assignments
                          .filter((a) => a.offered || a.handoverTo)
                          .map((a) =>
                            a.offered
                              ? `${a.displayName} needs a replacement`
                              : `${a.displayName} is handing on to ${a.handoverTo!.displayName}`,
                          )
                          .join(" · ")}
                      </span>
                    )}
                  </p>
                  <span className="mt-1 flex items-center justify-end gap-2 md:order-5 md:mt-0">
                    {gaps > 0 && (
                      <AssignDialog
                        slug={slug}
                        shiftId={s.id}
                        shiftLabel={shiftLabel(s)}
                        candidates={candidates}
                        excludedNote={excludedNote}
                        fullWidth="mobile"
                        className="flex-1 md:flex-none"
                      />
                    )}
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${s.name}`}
                    >
                      <Link href={`${base}/${s.id}/edit`}>
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
