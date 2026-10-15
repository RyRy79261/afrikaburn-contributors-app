import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  ArrowRight,
  Archive,
  CalendarClock,
  Crown,
  FileText,
  Lock,
  MessageCircle,
  Users,
} from "lucide-react";
import { formatShiftTime, openSpots, shiftDateLabel } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { MarkdownView } from "@quagga/ui/components/markdown-editor/markdown-view";
import { AvatarImage } from "@/components/avatar-image";
import { PreviewNotice } from "@/components/preview-notice";
import { DateBlock } from "@/components/shifts/date-block";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { todayIso } from "@/components/shifts/view-model";
import { JoinModeChip } from "@/components/teams/join-mode-chip";
import {
  AddPeopleButton,
  EditTeamButton,
  JoinTeamButton,
  LeaveTeamButton,
  RemoveMemberButton,
} from "@/components/teams/team-dialogs";
import { memberCountLabel } from "@/components/teams/team-list";
import {
  getCampTeam,
  listTeamCandidates,
  type TeamPersonView,
} from "@/lib/camp-teams-store";
import { loadShiftBoard, type ShiftView } from "@/lib/shifts-store";
import { loadTeamsContext } from "../context";

export const dynamic = "force-dynamic";

// /camps/[slug]/teams/[id] (frame T2 z53vuX / lexRq). Every current member
// of the camp sees the page — description, leads, members; `getCampTeam`
// returns null for everyone else, for another camp's team and for an
// archived team the viewer may not see, and that is the camp's 404. The
// edit controls render only when the store says `canManage`, and every one
// is re-decided by its server action. The chat itself is NOT on this page:
// "Team chat" opens it in Messages, behind its own gate.

const ParamsSchema = z.object({
  slug: z.string().min(1),
  id: z.string().uuid(),
});

/** How many upcoming shifts the page lists before "All of the team's shifts". */
const UPCOMING_SHIFTS = 4;

/** One team's page: about, upcoming shifts, leads and members. */
export default async function CampTeamPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const ctx = await loadTeamsContext();
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp teams" />;
  const { user, edition } = ctx;

  const team = await getCampTeam({
    slug: parsed.data.slug,
    teamId: parsed.data.id,
    viewerUserId: user.id,
  });
  if (!team) notFound();
  const { camp } = team;
  const canAdd = team.canManage && !team.archived;
  const [candidates, board] = await Promise.all([
    canAdd
      ? listTeamCandidates({
          slug: camp.slug,
          teamId: team.id,
          viewerUserId: user.id,
        })
      : [],
    loadShiftBoard(camp.id, edition.id),
  ]);
  const today = todayIso();
  const upcoming = board.shifts
    .filter((s) => s.teamId === team.id && s.date >= today)
    .slice(0, UPCOMING_SHIFTS);
  const base = `/camps/${camp.slug}/teams`;
  const firstLead = team.leads[0]?.displayName ?? null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <ShiftsHeader
        backHref={base}
        backLabel="Teams"
        title={team.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <JoinModeChip joinMode={team.joinMode} long />
            {team.archived && <Badge variant="secondary">Archived</Badge>}
            <span>
              {memberCountLabel(team.members.length)} · {camp.name}
            </span>
          </span>
        }
        actions={
          <>
            {team.viewerOnTeam && team.chatConversationId && (
              <Button asChild className="w-full sm:w-auto">
                <Link href={`/messages/${team.chatConversationId}`}>
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  Team chat
                </Link>
              </Button>
            )}
            {team.canJoin && !team.viewerOnTeam && (
              <JoinTeamButton
                slug={camp.slug}
                teamId={team.id}
                teamName={team.name}
                variant="default"
                size="default"
                className="w-full sm:w-auto"
              />
            )}
            {team.viewerOnTeam && (
              <LeaveTeamButton
                slug={camp.slug}
                teamId={team.id}
                teamName={team.name}
                className="w-full sm:w-auto"
              />
            )}
            {team.canManage && (
              <EditTeamButton
                slug={camp.slug}
                canArchive={team.canArchive}
                className="w-full sm:w-auto"
                team={{
                  id: team.id,
                  name: team.name,
                  description: team.description,
                  joinMode: team.joinMode,
                  archived: team.archived,
                  members: team.members.map((m) => ({
                    userId: m.userId,
                    displayName: m.displayName,
                    isLead: m.isLead,
                  })),
                }}
              />
            )}
          </>
        }
      />

      {team.archived && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          This team is archived. It is off the camp&apos;s list and its chat is
          read-only.
        </p>
      )}

      {!team.viewerOnTeam && !team.archived && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          {team.canJoin ? (
            <>
              <MessageCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden
              />
              Join to get the team chat. You&apos;ll see messages sent after you
              join, not the ones before.
            </>
          ) : (
            <>
              <Lock
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden
              />
              Only team leads and camp leads add people to this team.
              {firstLead
                ? ` Ask ${firstLead} if you'd like to help.`
                : " Ask a camp lead if you'd like to help."}
            </>
          )}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section
            aria-labelledby="about-heading"
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <h2
              id="about-heading"
              className="flex items-center gap-2 font-semibold"
            >
              <FileText className="h-4 w-4 text-primary" aria-hidden />
              About the team
            </h2>
            {team.description ? (
              <MarkdownView value={team.description} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {team.canManage
                  ? "Say what the team does — press Edit team."
                  : "No description yet."}
              </p>
            )}
          </section>

          <section
            aria-labelledby="shifts-heading"
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <div>
              <h2
                id="shifts-heading"
                className="flex items-center gap-2 font-semibold"
              >
                <CalendarClock className="h-4 w-4 text-primary" aria-hidden />
                Upcoming shifts
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The team&apos;s next shifts. Sign up for one in Shifts.
              </p>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No shifts coming up for this team.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {upcoming.map((s) => (
                  <UpcomingShiftRow key={s.id} shift={s} />
                ))}
              </ul>
            )}
            <Link
              href={`/camps/${camp.slug}/shifts?team=${team.id}`}
              className="inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              All of the team&apos;s shifts
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section
            aria-labelledby="leads-heading"
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <div>
              <h2
                id="leads-heading"
                className="flex items-center gap-2 font-semibold"
              >
                <Crown className="h-4 w-4 text-primary" aria-hidden />
                Team leads
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                They edit this page, add and remove people and set the
                chat&apos;s timer — for this team only.
              </p>
            </div>
            {team.leads.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No team lead yet. The camp&apos;s leads look after it.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {team.leads.map((p) => (
                  <li key={p.userId} className="flex items-center gap-3">
                    <PersonAvatar person={p} />
                    <span className="text-sm font-medium">{p.displayName}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="members-heading"
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <div>
              <h2
                id="members-heading"
                className="flex items-center gap-2 font-semibold"
              >
                <Users className="h-4 w-4 text-primary" aria-hidden />
                Members · {team.members.length}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Everyone in the team, and in its chat.
                {team.canManage &&
                  " Removing someone takes them out of the chat too."}
              </p>
            </div>
            {team.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody is on this team yet.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {team.members.map((p) => {
                  const me = p.userId === user.id;
                  return (
                    <li key={p.userId} className="flex items-center gap-3 py-2">
                      <PersonAvatar person={p} />
                      <span className="min-w-0 flex-1 text-sm font-medium">
                        {p.displayName}
                      </span>
                      {p.isLead && (
                        <Badge variant="outline" className="text-[10px]">
                          Lead
                        </Badge>
                      )}
                      {me ? (
                        <Badge variant="secondary" className="text-[10px]">
                          You
                        </Badge>
                      ) : (
                        canAdd && (
                          <RemoveMemberButton
                            slug={camp.slug}
                            teamId={team.id}
                            teamName={team.name}
                            person={{
                              userId: p.userId,
                              displayName: p.displayName,
                            }}
                          />
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {canAdd && (
              <AddPeopleButton
                slug={camp.slug}
                teamId={team.id}
                teamName={team.name}
                className="w-full"
                candidates={candidates.map((c) => ({
                  userId: c.userId,
                  displayName: c.displayName,
                }))}
              />
            )}
          </section>
        </div>
      </div>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Every member of the camp sees this page and who is in the team. Only the
        team&apos;s members read its chat — not AfrikaBurn, and not camp leads
        unless they join the team.
      </p>
    </div>
  );
}

/** Initials only: the team page never asks for a photo. */
function PersonAvatar({ person }: { person: TeamPersonView }) {
  return (
    <AvatarImage
      userId={person.userId}
      name={person.displayName}
      showPhoto={false}
      className="h-8 w-8 text-xs"
    />
  );
}

/** One upcoming shift: date block, name, day and time, filled / capacity. */
function UpcomingShiftRow({ shift }: { shift: ShiftView }) {
  const d = shiftDateLabel(shift.date);
  const open = openSpots(shift);
  const filled = shift.assignments.length;
  return (
    <li className="flex items-center gap-3 py-3">
      <DateBlock date={shift.date} className="h-12 w-12" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{shift.name}</p>
        <p className="text-xs text-muted-foreground">
          {d.day} {d.month} ·{" "}
          {formatShiftTime(shift.startMinute, shift.durationMinutes)}
        </p>
      </div>
      <span
        className={
          open > 0
            ? "shrink-0 text-xs font-medium text-warning"
            : "shrink-0 text-xs text-muted-foreground"
        }
      >
        {filled} of {shift.capacity}
        {open > 0 && (
          <span className="hidden sm:inline">
            {" "}
            · {open} {open === 1 ? "spot" : "spots"} left
          </span>
        )}
      </span>
    </li>
  );
}
