import "server-only";

import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition, type Edition } from "@/lib/edition";
import { enforceGate, getCurrentCampUser, type CampUser } from "@/lib/session";
import { getCampBySlug } from "@/lib/groups-store";
import { getRoleAssignments } from "@/lib/roles-store";
import type { ReachMember } from "@/lib/meeting-view";
import type { MeetingFormRole } from "@/components/meetings/meeting-form";
import { teamIdsByUser, type TeamOption } from "@/lib/team-audience-view";
import {
  listCampTeamSeats,
  loadMeetingsAccess,
  type MeetingEdition,
  type MeetingsAccess,
} from "@/lib/camp-meetings-store";

// The shared guard for every /camps/[slug]/meetings and /calendar page
// (docs/camp-meetings-spec.md). Meetings are for the camp's CURRENT members
// only: a stranger, a former member, an erased account and a member of
// another camp all get the camp's ordinary 404 — the same answer as a camp
// that does not exist, so a free camp's meetings are as undiscoverable as the
// camp itself. Which MEETINGS a member sees is the store's call, per meeting.

export type MeetingsContext =
  | { kind: "preview" }
  | {
      kind: "ready";
      user: CampUser;
      edition: Edition;
      /** The edition as the meetings store takes it. */
      meetingEdition: MeetingEdition;
      access: MeetingsAccess;
    };

/** Signed in, past the hard gate, and a current member of this camp — or
 * the camp's 404. Without a database or an edition: the preview notice. */
export async function loadMeetingsContext(
  slug: string,
): Promise<MeetingsContext> {
  if (!isDatabaseConfigured()) return { kind: "preview" };
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  const [user, edition] = await Promise.all([
    getCurrentCampUser(),
    getActiveEdition(),
  ]);
  if (!user) redirect("/auth/sign-in");
  if (!edition) return { kind: "preview" };
  await enforceGate(user.id);

  const access = await loadMeetingsAccess(slug, user.id);
  if (!access) notFound();
  return {
    kind: "ready",
    user,
    edition,
    meetingEdition: {
      id: edition.id,
      startDate: edition.startDate,
      endDate: edition.endDate,
    },
    access,
  };
}

/** A scheduler-only page (the form): everyone else gets the same 404. */
export async function loadSchedulerContext(
  slug: string,
): Promise<MeetingsContext> {
  const ctx = await loadMeetingsContext(slug);
  if (ctx.kind === "ready" && !ctx.access.canSchedule) notFound();
  return ctx;
}

/**
 * What the schedule form needs: the roles a meeting can be for (the
 * announcements picker's set — custom, default and captain roles; "whole
 * camp" covers the baseline, and officer roles are org-facing registrations),
 * the teams it can be for, and each current member's roles and teams, for the
 * live "Shows to N members" guide. The store re-decides the audience on every
 * write; this only informs.
 *
 * Teams offered: every live team for a camp-wide scheduler; only the live
 * teams they lead for a team lead without `schedule_meetings`. When editing,
 * the teams already on the meeting stay listed (an archived one included) so
 * they can be kept.
 */
export async function meetingFormData(
  access: MeetingsAccess,
  editionId: string,
  viewerId: string,
  storedTeamIds: readonly string[] = [],
): Promise<{
  roles: MeetingFormRole[];
  teams: TeamOption[];
  members: ReachMember[];
}> {
  const [camp, assignments, seats] = await Promise.all([
    getCampBySlug(access.camp.slug, editionId, viewerId),
    getRoleAssignments(access.camp.id),
    listCampTeamSeats(access.camp.id),
  ]);
  const led = access.viewer.ledTeamIds ?? new Set<string>();
  const kept = new Set(storedTeamIds);
  const teams = access.teams
    .filter(
      (t) =>
        kept.has(t.id) ||
        (!t.archived && (access.canScheduleCampWide || led.has(t.id))),
    )
    .map((t) => ({ id: t.id, name: t.name }));
  const teamsByUser = teamIdsByUser(seats);
  const roles = access.roles
    .filter((r) => r.kind !== "officer" && r.kind !== "baseline")
    .map((r) => ({ id: r.id, name: r.name }));
  const members = (camp?.members ?? []).map((m) => ({
    role: m.role,
    roleIds: (assignments.get(m.membershipId) ?? [])
      .filter((a) => a.consent === "accepted")
      .map((a) => a.projectRoleId),
    teamIds: teamsByUser.get(m.userId) ?? [],
  }));
  return { roles, teams, members };
}
