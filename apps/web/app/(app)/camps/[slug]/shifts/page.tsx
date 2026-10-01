import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { shiftDateLabel } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { PreviewNotice } from "@/components/preview-notice";
import { LeadOverview } from "@/components/shifts/lead-overview";
import { MemberShifts } from "@/components/shifts/member-shifts";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { loadShiftsContext } from "./context";

export const dynamic = "force-dynamic";

// /camps/[slug]/shifts (epic #57). A lead or co-lead gets the overview (S1);
// every other member gets their own view (S3), which leads also reach at
// /shifts/mine. Strangers and former members get the camp's 404.

function pick(
  value: string | string[] | undefined,
): string | null {
  return typeof value === "string" && value ? value : null;
}

export default async function ShiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await loadShiftsContext(slug);
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp shifts" />;
  const { camp, board, days, me, canManage, edition } = ctx;

  const teamParam = pick(query.team);
  const teamFilter =
    teamParam && board.teams.some((t) => t.id === teamParam) ? teamParam : null;
  const back = { href: `/camps/${camp.slug}`, label: camp.name };

  if (!canManage) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <ShiftsHeader
          backHref={back.href}
          backLabel={back.label}
          title="Shifts"
          description="Pick up a shift if you can — none of this is required. Every day of the burn is listed, build and strike included."
        />
        <MemberShifts
          slug={camp.slug}
          board={board}
          me={me}
          teamFilter={teamFilter}
          basePath={`/camps/${camp.slug}/shifts`}
        />
      </div>
    );
  }

  const dayParam = pick(query.day);
  const inScope = teamFilter
    ? board.shifts.filter((s) => s.teamId === teamFilter)
    : board.shifts;
  const selectedDay =
    (dayParam && days.some((d) => d.date === dayParam) ? dayParam : null) ??
    inScope.find((s) => s.assignments.length < s.capacity)?.date ??
    inScope[0]?.date ??
    days.find((d) => d.phase === "event")?.date ??
    days[0]?.date ??
    edition.startDate;

  const firstBuild = days.find((d) => d.phase === "build");
  const strike = days.find((d) => d.phase === "strike");
  const when =
    firstBuild && strike
      ? ` · build from ${shiftDateLabel(firstBuild.date).dayMonth}, strike on ${shiftDateLabel(strike.date).dayMonth}`
      : "";

  return (
    <div className="flex flex-col gap-6">
      <ShiftsHeader
        backHref={back.href}
        backLabel={back.label}
        title="Shifts"
        description={`${edition.name}${when}. Signing up is optional — people pick what suits them, you fill the gaps.`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/camps/${camp.slug}/shifts/mine`}>
                <CalendarDays className="h-4 w-4" aria-hidden />
                My shifts
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/camps/${camp.slug}/shifts/new`}>
                <Plus className="h-4 w-4" aria-hidden />
                New shift
              </Link>
            </Button>
          </>
        }
      />
      <LeadOverview
        slug={camp.slug}
        board={board}
        days={days}
        selectedDay={selectedDay}
        teamFilter={teamFilter}
      />
    </div>
  );
}
