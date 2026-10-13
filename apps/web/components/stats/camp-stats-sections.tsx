import Link from "next/link";
import {
  Archive,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  Hammer,
  IdCard,
  Info,
  Ticket,
  Users,
} from "lucide-react";
import {
  shiftDateLabel,
  WAP_LIST_STATUS_LABELS,
  type CampStatsView,
} from "@quagga/core";
import type { WapListStatus } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { cn } from "@quagga/ui/lib/utils";
import { SectionLink, StatTile } from "./stat-tile";

// The camp statistics page body (frame C1, desktop b7zfxq / mobile oaV8b).
// PRESENTATIONAL ONLY: every number came out of @quagga/core
// `buildCampStats`, which refused anyone who is not a roster viewer. COUNTS
// ONLY — nothing here can render a name, because nothing it is given has one.
// A section whose figures are null (no onboarding sent, no shifts, no passes
// asked for) is not rendered at all.

export interface CampStatsLinks {
  onboardingResults: boolean;
  passes: boolean;
}

const LIST_STATUS_HINT: Record<WapListStatus, string> = {
  draft: "The camp is still drafting the list",
  submitted: "Waiting for AfrikaBurn to approve",
  approved: "AfrikaBurn approved the list",
  returned: "AfrikaBurn sent it back for changes",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function dayMonth(iso: string): string {
  const d = shiftDateLabel(iso);
  return d.day ? `${d.day} ${d.month}` : iso;
}

function SectionHeader({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <CardHeader className="pb-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        {action && <div className="order-last sm:order-none">{action}</div>}
      </div>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

function Legend({
  items,
}: {
  items: { label: string; value: number; swatch: string }[];
}) {
  return (
    <dl className="flex flex-col gap-1.5">
      {items.map((i) => (
        <div
          key={i.label}
          className="flex items-center justify-between text-sm"
        >
          <dt className="flex items-center gap-2 text-muted-foreground">
            <span
              className={cn("h-2.5 w-2.5 rounded-sm", i.swatch)}
              aria-hidden
            />
            {i.label}
          </dt>
          <dd className="font-medium tabular-nums">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A stacked fill bar. Decorative — the legend beside it carries the numbers. */
function StackedBar({
  parts,
  total,
}: {
  parts: { value: number; className: string }[];
  total: number;
}) {
  return (
    <div
      className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
      aria-hidden
    >
      {total > 0 &&
        parts
          .filter((p) => p.value > 0)
          .map((p, i) => (
            <span
              key={i}
              className={cn("h-full", p.className)}
              style={{ width: `${(p.value / total) * 100}%` }}
            />
          ))}
    </div>
  );
}

// --- People ------------------------------------------------------------------

function PeopleSection({
  slug,
  people,
}: {
  slug: string;
  people: CampStatsView["people"];
}) {
  const roster = `/camps/${slug}/roster`;
  return (
    <Card data-testid="stats-people">
      <SectionHeader
        icon={<Users className="h-4 w-4 text-accent" aria-hidden />}
        title="People"
        description="Current members this edition. New or returning comes from the camp's own records, not from bios."
        action={<SectionLink href={roster}>Open the roster</SectionLink>}
      />
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Current members"
            value={people.current}
            hint="Leads included"
            href={roster}
          />
          <StatTile
            label="New to the camp"
            value={people.newToCamp}
            hint="First edition with the camp"
          />
          <StatTile
            label="Returning"
            value={people.returning}
            hint="With the camp before"
          />
          <StatTile
            label="First burn ever"
            value={people.firstBurn}
            hint="First AfrikaBurn, from their bio"
          />
        </div>
        <p className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-lg bg-secondary/30 px-3 py-2.5 text-sm">
          <Archive
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          {people.former > 0 ? (
            <Link
              href={`${roster}?status=former`}
              className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {plural(people.former, "former member", "former members")}
            </Link>
          ) : (
            <span className="font-medium">No former members</span>
          )}
          <span className="text-muted-foreground">
            Archived from the camp. Shown apart, never counted as current.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

// --- Onboarding and bios -----------------------------------------------------

function OnboardingSection({
  slug,
  onboarding,
  current,
  canOpenResults,
}: {
  slug: string;
  onboarding: NonNullable<CampStatsView["onboarding"]>;
  current: number;
  canOpenResults: boolean;
}) {
  return (
    <Card data-testid="stats-onboarding">
      <SectionHeader
        icon={<ClipboardList className="h-4 w-4 text-accent" aria-hidden />}
        title="Onboarding"
        description={`“${onboarding.title}” went to ${onboarding.targeted} of the ${plural(current, "member", "members")}.`}
      />
      <CardContent className="flex flex-col gap-4">
        <p className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">
            {onboarding.completed}
          </span>
          <span className="text-sm text-muted-foreground">
            of {onboarding.targeted} completed
          </span>
        </p>
        <StackedBar
          total={onboarding.targeted}
          parts={[
            { value: onboarding.completed, className: "bg-success" },
            { value: onboarding.inProgress, className: "bg-primary" },
          ]}
        />
        <Legend
          items={[
            {
              label: "Completed",
              value: onboarding.completed,
              swatch: "bg-success",
            },
            {
              label: "In progress",
              value: onboarding.inProgress,
              swatch: "bg-primary",
            },
            {
              label: "Not started",
              value: onboarding.notStarted,
              swatch: "border border-border bg-muted",
            },
          ]}
        />
        {canOpenResults && onboarding.completed < onboarding.targeted && (
          <SectionLink
            href={`/camps/${slug}/questionnaires/${onboarding.activationId}?names=incomplete`}
          >
            See who&apos;s still to finish
          </SectionLink>
        )}
      </CardContent>
    </Card>
  );
}

function BiosSection({
  slug,
  bios,
  editionName,
  current,
  className,
}: {
  slug: string;
  bios: CampStatsView["bios"];
  editionName: string;
  current: number;
  className?: string;
}) {
  const total = bios.complete + bios.incomplete;
  return (
    <Card data-testid="stats-bios" className={className}>
      <SectionHeader
        icon={<IdCard className="h-4 w-4 text-accent" aria-hidden />}
        title="Bios"
        description={`Bios for ${editionName} across the ${plural(current, "current member", "current members")}.`}
      />
      <CardContent className="flex flex-col gap-4">
        <p className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">
            {bios.complete}
          </span>
          <span className="text-sm text-muted-foreground">
            of {total} complete
          </span>
        </p>
        <StackedBar
          total={total}
          parts={[{ value: bios.complete, className: "bg-success" }]}
        />
        <Legend
          items={[
            { label: "Complete", value: bios.complete, swatch: "bg-success" },
            {
              label: "Incomplete",
              value: bios.incomplete,
              swatch: "border border-border bg-muted",
            },
          ]}
        />
        <div className="flex flex-col gap-2">
          <SectionLink href={`/camps/${slug}/roster?bio=complete`}>
            Complete bios on the roster
          </SectionLink>
          <SectionLink href={`/camps/${slug}/roster?bio=incomplete`}>
            Incomplete bios on the roster
          </SectionLink>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Build and strike --------------------------------------------------------

function ArrivalsChart({
  days,
}: {
  days: CampStatsView["buildStrike"]["arrivalsByDay"];
}) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="overflow-x-auto">
      <ol
        className="flex min-w-fit items-end gap-2 border-b border-border sm:gap-3"
        aria-label="Arrivals per day"
      >
        {days.map((d) => {
          const label = shiftDateLabel(d.date);
          return (
            <li
              key={d.date}
              className="flex min-w-12 flex-1 flex-col items-center gap-1.5"
              aria-label={`${label.long}, ${d.phase}: ${plural(d.count, "arrival", "arrivals")}`}
            >
              <span className="text-xs font-semibold tabular-nums" aria-hidden>
                {d.count}
              </span>
              <span
                className="w-full max-w-16 rounded-t-sm bg-primary"
                style={{ height: `${Math.round((d.count / max) * 96)}px` }}
                aria-hidden
              />
            </li>
          );
        })}
      </ol>
      <ol className="flex min-w-fit gap-2 pt-1.5 sm:gap-3" aria-hidden>
        {days.map((d) => (
          <li
            key={d.date}
            className="flex min-w-12 flex-1 flex-col items-center text-center"
          >
            <span className="text-xs font-medium">
              {shiftDateLabel(d.date).short}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {d.phase}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function BuildStrikeSection({
  buildStrike,
  current,
  eventStart,
}: {
  buildStrike: CampStatsView["buildStrike"];
  current: number;
  eventStart: string;
}) {
  const of = `Of ${plural(current, "member", "members")}`;
  const set = current - buildStrike.arrivalNotSet;
  return (
    <Card data-testid="stats-build-strike">
      <SectionHeader
        icon={<Hammer className="h-4 w-4 text-accent" aria-hidden />}
        title="Build and strike"
        description="From each member's own plans on the roster."
      />
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            label="Joining build"
            value={buildStrike.joiningBuild}
            hint={of}
          />
          <StatTile
            label="Joining strike"
            value={buildStrike.joiningStrike}
            hint={of}
          />
          <StatTile
            label="Arrival not set"
            value={buildStrike.arrivalNotSet}
            hint="No arrival date yet"
          />
        </div>
        {buildStrike.arrivalsByDay.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Arrivals per day
            </h3>
            <ArrivalsChart days={buildStrike.arrivalsByDay} />
          </div>
        )}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {set} of the {plural(current, "member has", "members have")} set an
          arrival date. The event opens on {shiftDateLabel(eventStart).long}.
        </p>
      </CardContent>
    </Card>
  );
}

// --- Shifts ------------------------------------------------------------------

function ShiftsSection({
  slug,
  shifts,
}: {
  slug: string;
  shifts: NonNullable<CampStatsView["shifts"]>;
}) {
  const base = `/camps/${slug}/shifts`;
  const next = shifts.nextSevenDays;
  return (
    <Card data-testid="stats-shifts">
      <SectionHeader
        icon={<CalendarClock className="h-4 w-4 text-accent" aria-hidden />}
        title="Shifts"
        description={`${plural(shifts.shifts, "shift", "shifts")} this edition, with ${plural(shifts.spots, "spot", "spots")} between them.`}
        action={<SectionLink href={base}>Open shifts</SectionLink>}
      />
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Spots filled"
            value={`${shifts.filled} of ${shifts.spots}`}
            hint={
              shifts.percentFilled !== null
                ? `${shifts.percentFilled}% of spots`
                : undefined
            }
          />
          <StatTile
            label="Open spots"
            value={shifts.open}
            hint="Across the whole edition"
          />
          <StatTile
            label="Open in the next 7 days"
            value={plural(next.shifts, "shift", "shifts")}
            hint={`${plural(next.openSpots, "open spot", "open spots")} · ${dayMonth(next.from)} – ${dayMonth(next.to)}`}
          />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            By team
          </h3>
          <div className="overflow-hidden rounded-lg border border-border">
            <div
              className="hidden grid-cols-[minmax(8rem,12rem)_1fr_7rem_6rem] gap-4 bg-secondary/30 px-4 py-2 text-xs text-muted-foreground sm:grid"
              aria-hidden
            >
              <span>Team</span>
              <span>Fill</span>
              <span>Spots filled</span>
              <span>Open</span>
            </div>
            <ul className="flex flex-col divide-y divide-border">
              {shifts.byTeam.map((t) => {
                const pct = t.spots > 0 ? (t.filled / t.spots) * 100 : 0;
                const name = t.teamId ? (
                  <Link
                    href={`${base}?team=${encodeURIComponent(t.teamId)}`}
                    className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t.name}
                  </Link>
                ) : (
                  <span className="font-medium">{t.name}</span>
                );
                return (
                  <li
                    key={t.teamId ?? "none"}
                    className="flex flex-col gap-2 px-4 py-3 text-sm sm:grid sm:grid-cols-[minmax(8rem,12rem)_1fr_7rem_6rem] sm:items-center sm:gap-4"
                  >
                    <div className="flex items-center justify-between gap-2 sm:contents">
                      {name}
                      <span className="sm:order-last">
                        {t.open > 0 ? (
                          <Badge variant="warning">{t.open} open</Badge>
                        ) : (
                          <Badge variant="success">Full</Badge>
                        )}
                      </span>
                    </div>
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                      aria-hidden
                    >
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums sm:text-sm">
                      {t.filled} of {t.spots}
                      <span className="sm:hidden"> filled</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {next.days.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Open in the next 7 days
            </h3>
            <ul className="grid gap-2 sm:grid-cols-3">
              {next.days.map((d) => (
                <li key={d.date}>
                  <Link
                    href={`${base}?day=${d.date}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-4 py-3 hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">
                        {shiftDateLabel(d.date).medium}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {plural(d.openSpots, "open spot", "open spots")}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-accent" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Work Access Passes ------------------------------------------------------

function PassesSection({
  slug,
  passes,
  canOpen,
}: {
  slug: string;
  passes: NonNullable<CampStatsView["passes"]>;
  canOpen: boolean;
}) {
  return (
    <Card data-testid="stats-passes">
      <SectionHeader
        icon={<Ticket className="h-4 w-4 text-accent" aria-hidden />}
        title="Work Access Passes"
        description="Passes from AfrikaBurn for people on site before the event opens or staying on for strike."
        action={
          canOpen ? (
            <SectionLink href={`/camps/${slug}/passes`}>
              Open passes
            </SectionLink>
          ) : undefined
        }
      />
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Granted"
            value={passes.granted}
            hint={
              passes.pending !== null
                ? `By AfrikaBurn · ${passes.pending} more asked, waiting`
                : "By AfrikaBurn"
            }
          />
          <StatTile
            label="Allocated"
            value={passes.allocated}
            hint="On the camp's list"
          />
          <StatTile
            label="Left"
            value={passes.left}
            hint="Not given to anyone yet"
          />
          <StatTile
            label="List status"
            value={WAP_LIST_STATUS_LABELS[passes.listStatus]}
            hint={LIST_STATUS_HINT[passes.listStatus]}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// --- The page body -----------------------------------------------------------

export function CampStatsSections({
  slug,
  stats,
  links,
  editionName,
  eventStart,
}: {
  slug: string;
  stats: CampStatsView;
  links: CampStatsLinks;
  editionName: string;
  /** The edition's first day (the event opens). */
  eventStart: string;
}) {
  const current = stats.people.current;
  return (
    <div className="flex flex-col gap-5">
      <PeopleSection slug={slug} people={stats.people} />
      <div className="grid gap-5 lg:grid-cols-2">
        {stats.onboarding && (
          <OnboardingSection
            slug={slug}
            onboarding={stats.onboarding}
            current={current}
            canOpenResults={links.onboardingResults}
          />
        )}
        <BiosSection
          slug={slug}
          bios={stats.bios}
          editionName={editionName}
          current={current}
          className={stats.onboarding ? undefined : "lg:col-span-2"}
        />
      </div>
      <BuildStrikeSection
        buildStrike={stats.buildStrike}
        current={current}
        eventStart={eventStart}
      />
      {stats.shifts && <ShiftsSection slug={slug} shifts={stats.shifts} />}
      {stats.passes && (
        <PassesSection
          slug={slug}
          passes={stats.passes}
          canOpen={links.passes}
        />
      )}
    </div>
  );
}
