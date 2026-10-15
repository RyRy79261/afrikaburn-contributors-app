import { notFound } from "next/navigation";
import { Lock, Users } from "lucide-react";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { PreviewNotice } from "@/components/preview-notice";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { NewTeamButton } from "@/components/teams/team-dialogs";
import { TeamListRow } from "@/components/teams/team-list";
import {
  listCampTeams,
  listNewTeamLeadCandidates,
} from "@/lib/camp-teams-store";
import { loadTeamsContext } from "./context";

export const dynamic = "force-dynamic";

// /camps/[slug]/teams (frame T1 Zam6P / mcghm, docs/camp-teams-spec.md).
// Current members of the camp only: `listCampTeams` returns null for a
// stranger, a former member and an erased account, and that is the camp's
// ordinary 404. Archived teams are listed for camp leads and for people still
// on them. The same list the shifts use — one list.

/** The camp's teams, with Join / Joined and New team for camp leads. */
export default async function CampTeamsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadTeamsContext();
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp teams" />;
  const { user, edition } = ctx;

  const view = await listCampTeams({ slug, viewerUserId: user.id });
  if (!view) notFound();
  const { camp, canCreate, teams } = view;
  const candidates = canCreate
    ? await listNewTeamLeadCandidates({ slug, viewerUserId: user.id })
    : [];
  const mine = teams.filter((t) => t.viewerOnTeam).length;

  const newTeam = (
    <NewTeamButton
      slug={camp.slug}
      leadCandidates={candidates.map((c) => ({
        userId: c.userId,
        displayName: c.displayName,
      }))}
      className="w-full sm:w-auto"
    />
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <ShiftsHeader
        backHref={`/camps/${camp.slug}`}
        backLabel={camp.name}
        title="Teams"
        description={`The camp's teams for ${edition.name} — the same teams its shifts use. Join an open team to get its chat and see its shifts.`}
        actions={canCreate ? newTeam : undefined}
      />

      {teams.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No teams yet"
          description={
            canCreate
              ? "Make the camp's first team. Its page, its people and its chat live here."
              : "When your camp leads make teams, they show up here."
          }
          action={
            canCreate ? (
              <NewTeamButton
                slug={camp.slug}
                leadCandidates={candidates.map((c) => ({
                  userId: c.userId,
                  displayName: c.displayName,
                }))}
                icon={false}
              />
            ) : undefined
          }
        />
      ) : (
        <section
          aria-labelledby="teams-heading"
          className="flex flex-col gap-3"
        >
          {/* A count line, not a display heading: opt out of the brand's
              uppercase h2 so it reads as the frame's "6 teams · you're in 2". */}
          <h2
            id="teams-heading"
            className="text-sm font-normal normal-case tracking-normal"
          >
            <span className="font-semibold">
              {teams.length} {teams.length === 1 ? "team" : "teams"}
            </span>
            <span className="text-muted-foreground">
              {" "}
              · you&apos;re in {mine}
            </span>
          </h2>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {teams.map((t) => (
              <TeamListRow key={t.id} slug={camp.slug} team={t} />
            ))}
          </ul>
        </section>
      )}

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Every member of the camp sees its teams and who is in them. Only a
        team&apos;s members read its chat — a camp lead joins the team to read
        it, and everyone in it can see that.
      </p>
    </div>
  );
}
