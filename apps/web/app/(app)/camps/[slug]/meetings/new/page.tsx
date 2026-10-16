import { Lock } from "lucide-react";
import { PreviewNotice } from "@/components/preview-notice";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { MeetingForm } from "@/components/meetings/meeting-form";
import { preselectedTeamIds } from "@/lib/team-audience-view";
import { loadSchedulerContext, meetingFormData } from "../context";

export const dynamic = "force-dynamic";

// /camps/[slug]/meetings/new (frame G3 TqtC2 / Cf5Jm; team audience frame
// bIVG2 / YGauR). Leads, co-leads, `schedule_meetings` holders and team leads
// (for their teams) only; everyone else gets the camp's 404, and the store
// refuses them regardless. `?team=<id>` (the team page's "Schedule a team
// meeting") starts on "Teams" with that team chosen, when it is offered.

/** The schedule form. */
export default async function NewMeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ team?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const ctx = await loadSchedulerContext(slug);
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp meetings" />;
  const { access, edition, user } = ctx;
  const { roles, teams, members } = await meetingFormData(
    access,
    edition.id,
    user.id,
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ShiftsHeader
        backHref={`/camps/${access.camp.slug}/meetings`}
        backLabel="Meetings"
        title="Schedule a meeting"
      />
      <MeetingForm
        slug={access.camp.slug}
        roles={roles}
        teams={teams}
        campWide={access.canScheduleCampWide}
        members={members}
        initialTeamIds={preselectedTeamIds(query.team, teams)}
        baselineRoleId={access.baselineRoleId}
      />
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Only the leads and members with the &ldquo;Schedule meetings&rdquo;
        privilege can schedule, move or cancel a meeting — and team leads, for
        the teams they lead. Nothing here is ever public.
      </p>
    </div>
  );
}
