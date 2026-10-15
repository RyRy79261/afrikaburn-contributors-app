import "server-only";

import { notFound, redirect } from "next/navigation";
import {
  canComposeCampAnnouncements,
  canSendCampAnnouncement,
} from "@quagga/core";
import type { ProjectAudience } from "@quagga/types";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition, type Edition } from "@/lib/edition";
import { getCampBySlug, type CampDetail } from "@/lib/groups-store";
import { getRoleAssignments, listRoles } from "@/lib/roles-store";
import { enforceGate, requireCampUser, type CampUser } from "@/lib/session";
import {
  getSenderContext,
  loadComposerTeams,
  type SenderContext,
} from "@/lib/announcements-store";
import { teamIdsByUser, type TeamOption } from "@/lib/team-audience-view";
import type {
  ComposerRole,
  ComposerScope,
} from "@/components/announcements/composer";

// The shared guard for every /camps/[slug]/announcements page. A viewer who
// is not a member of the camp, or a member with neither `post_announcements`
// nor a team they lead, gets
// the camp's ordinary 404 — the same answer as a camp that does not exist, so
// a free camp's announcements surface is as undiscoverable as the camp.

export type AnnouncementsContext =
  | { kind: "preview" }
  | {
      kind: "ready";
      user: CampUser;
      edition: Edition;
      camp: CampDetail;
      sender: SenderContext;
    };

export async function loadAnnouncementsContext(
  slug: string,
): Promise<AnnouncementsContext> {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  if (!isDatabaseConfigured()) return { kind: "preview" };

  const user = await requireCampUser();
  await enforceGate(user.id);

  const edition = await getActiveEdition();
  if (!edition) return { kind: "preview" };

  const camp = await getCampBySlug(slug, edition.id, user.id);
  if (!camp) notFound();

  const sender = await getSenderContext(camp.id, user.id);
  // `post_announcements`, or a lead of a live team (to their teams only).
  if (
    !sender ||
    !canComposeCampAnnouncements(sender.perms, sender.teams.ledTeamIds)
  )
    notFound();
  return { kind: "ready", user, edition, camp, sender };
}

/**
 * What the composer needs: the targetable roles and teams, each member's roles
 * and teams (for the live count), and what this sender's scope allows —
 * resolved through the SAME predicate the server enforces, so the picker
 * greys out (or, for a team lead, leaves out) what would be refused.
 */
export async function composerData(
  campId: string,
  sender: SenderContext,
  members: CampDetail["members"],
): Promise<{
  roles: ComposerRole[];
  teams: TeamOption[];
  members: { roleIds: string[]; teamIds: string[] }[];
  scope: ComposerScope;
}> {
  const [allRoles, assignments, campTeams] = await Promise.all([
    listRoles(campId),
    getRoleAssignments(campId),
    loadComposerTeams(campId),
  ]);
  // Custom/default/captain roles; "everyone" covers the baseline, and officers
  // are org-facing registrations addressed through their own consent flow.
  const roles = allRoles.filter(
    (r) => r.kind !== "officer" && r.kind !== "baseline",
  );
  const audience = (
    mode: "everyone" | "roles" | "teams",
    ids: string[],
  ): ProjectAudience =>
    mode === "teams"
      ? { kind: "project", groupId: campId, mode, roleIds: [], teamIds: ids }
      : { kind: "project", groupId: campId, mode, roleIds: ids };
  const may = (spec: ProjectAudience, requireAck: boolean) =>
    canSendCampAnnouncement(sender.perms, {
      groupId: campId,
      audience: spec,
      presentation: requireAck ? "acknowledge" : "feed",
      baselineRoleId: sender.baselineRoleId,
      campRoleIds: sender.campRoleIds,
      teams: sender.teams,
    });

  const canTargetEveryone = may(audience("everyone", []), false);
  const targetableRoleIds = roles
    .filter((r) => may(audience("roles", [r.id]), false))
    .map((r) => r.id);
  // A team lead without the camp-wide permission is offered only the teams
  // they lead; anyone else sees every live team, greyed where refused.
  const targetableTeamIds = campTeams.teams
    .filter((t) => may(audience("teams", [t.id]), false))
    .map((t) => t.id);
  const teamsOnly = !canTargetEveryone && targetableRoleIds.length === 0;
  const offeredTeams = teamsOnly
    ? campTeams.teams.filter((t) => targetableTeamIds.includes(t.id))
    : campTeams.teams;
  // `mayRequireAck` is a scope flag, but the predicate answers questions about
  // a whole send — probe it with a whole-camp or role audience this sender
  // may already target. Teams are asked one by one below instead: a team lead
  // may require acknowledgement of the teams they lead without the flag
  // (Ryan, 16 Oct 2026), so for teams the answer depends on the pick.
  const probe = canTargetEveryone
    ? audience("everyone", [])
    : targetableRoleIds[0]
      ? audience("roles", [targetableRoleIds[0]])
      : null;
  const mayRequireAck = probe ? may(probe, true) : false;
  const ackTeamIds = targetableTeamIds.filter((id) =>
    may(audience("teams", [id]), true),
  );

  const teamsByUser = teamIdsByUser(campTeams.seats);

  return {
    roles: roles.map((r) => ({ id: r.id, name: r.name })),
    teams: offeredTeams.map((t) => ({ id: t.id, name: t.name })),
    members: members.map((m) => ({
      roleIds: (assignments.get(m.membershipId) ?? [])
        .filter((a) => a.consent === "accepted")
        .map((a) => a.projectRoleId),
      teamIds: teamsByUser.get(m.userId) ?? [],
    })),
    scope: {
      canTargetEveryone,
      targetableRoleIds,
      targetableTeamIds,
      teamsOnly,
      mayRequireAck,
      ackTeamIds,
    },
  };
}
