// Team audiences (docs/team-audiences-spec.md, Ryan 15 Oct 2026). PURE — no
// I/O, no env, no DB. Camp announcements and camp meetings may be addressed to
// chosen camp teams (`ProjectAudience.mode === "teams"`, `teamIds`). This file
// holds the rules both features share:
//
//   · WHO MAY ADDRESS A TEAM. A camp lead or co-lead (the backstop) may pick
//     any of the camp's live teams. So may a holder of the camp-wide
//     permission (`post_announcements` with every role in its scope, or
//     `schedule_meetings`). Anyone else — a TEAM LEAD — may pick only the
//     live teams they lead right now, and only by team: never the whole camp,
//     never roles. The store reads the lead's seats inside the write's
//     transaction, held FOR SHARE, so a lead removed mid-send is refused.
//
//   · WHO IS REACHED. Current camp members on any chosen team. The team-member
//     rows are passed to the shared resolver (./audience) as
//     `AudienceContext.teamMembers`; an id with no rows (a deleted team)
//     resolves to nobody. An ARCHIVED team keeps its rows, so a meeting for it
//     stays visible to its members; a NEW send to an archived team is refused.
//
//   · WHO SEES IT. As for roles: the reached members, the camp's leads and
//     co-leads, and whoever sent or scheduled it.
//
//   · THE CHIP. "Kitchen team" for one team, "Kitchen + Build & strike" for
//     several (frame Yzft0).

import type { ProjectAudience } from "@quagga/types";
import { AUDIENCE_MAX_TEAMS } from "@quagga/types";
import {
  hasProjectPermission,
  isPermissionBackstop,
  type PermissionMembership,
} from "./project-permissions";

/** One row of `team_members`, trimmed to what audience resolution needs. The
 * team's own `groupId` lets the resolver refuse another camp's team. */
export interface AudienceTeamMember {
  teamId: string;
  groupId: string;
  userId: string;
}

/** What a sender may address by team in ONE camp. */
export interface TeamAudienceReach {
  /** Lead/co-lead, or holder of the camp-wide permission: any live team. */
  campWide: boolean;
  /** The live teams of this camp the sender leads right now. */
  ledTeamIds: ReadonlySet<string>;
}

/** The camp's teams, as a team-audience decision reads them. */
export interface CampTeamFacts {
  /** Teams of this camp that are not archived — the only ones a NEW send may
   * name. */
  liveTeamIds: ReadonlySet<string>;
  /** Team ids already on the stored audience (editing a meeting). These stay
   * acceptable even when their team has since been archived, so a meeting
   * for an archived team can still be moved or retitled. */
  keepTeamIds?: ReadonlySet<string>;
}

export type TeamAudienceRefusal = "no_teams" | "unknown_team" | "not_your_team";

export type TeamAudienceDecision =
  { ok: true; teamIds: string[] } | { ok: false; reason: TeamAudienceRefusal };

/** The team ids an audience names: empty unless `mode` is `teams`. */
export function audienceTeamIds(
  audience: Pick<ProjectAudience, "mode" | "teamIds">,
): string[] {
  return audience.mode === "teams" ? [...(audience.teamIds ?? [])] : [];
}

/**
 * Check the teams a sender picked, for THIS camp. At least one team; every
 * team one of the camp's live teams (or already on the stored audience); and,
 * for a sender without camp-wide reach, every team one they lead now.
 * Returns the ids de-duplicated and sorted, as they are stored.
 */
export function decideTeamAudienceTargets(
  teamIds: readonly string[],
  camp: CampTeamFacts,
  reach: TeamAudienceReach,
): TeamAudienceDecision {
  const ids = [...new Set(teamIds)].sort();
  if (ids.length === 0) return { ok: false, reason: "no_teams" };
  if (ids.length > AUDIENCE_MAX_TEAMS) {
    return { ok: false, reason: "unknown_team" };
  }
  const known = (id: string) =>
    camp.liveTeamIds.has(id) || (camp.keepTeamIds?.has(id) ?? false);
  if (!ids.every(known)) return { ok: false, reason: "unknown_team" };
  if (!reach.campWide && !ids.every((id) => reach.ledTeamIds.has(id))) {
    return { ok: false, reason: "not_your_team" };
  }
  return { ok: true, teamIds: ids };
}

/**
 * Does `post_announcements` reach the whole camp for this member? The backstop
 * does; so does a grant whose role scope is "all". A grant scoped to some
 * roles does NOT make its holder a camp-wide team sender — they may still
 * address the teams they lead.
 */
export function hasCampWideAnnouncementReach(m: PermissionMembership): boolean {
  if (isPermissionBackstop(m.structuralRole)) return true;
  return m.rolePermissions.some(
    (p) => p.post_announcements?.audienceRoles === "all",
  );
}

/** May this member require acknowledgement? The backstop, or a
 * `post_announcements` grant with `mayRequireAck`. A team lead without one
 * sends to their team as an ordinary inbox item only. */
export function mayRequireAnnouncementAck(m: PermissionMembership): boolean {
  if (isPermissionBackstop(m.structuralRole)) return true;
  return m.rolePermissions.some((p) => p.post_announcements?.mayRequireAck);
}

/** Does `schedule_meetings` (or the backstop) reach the whole camp? */
export function hasCampWideMeetingReach(m: PermissionMembership): boolean {
  return hasProjectPermission(m, "schedule_meetings");
}

/**
 * Every team in `teamIds` is one the sender may address: all of them when
 * campWide, otherwise only teams they lead now. An empty list is no.
 */
export function teamsWithinReach(
  teamIds: readonly string[],
  reach: TeamAudienceReach,
): boolean {
  if (teamIds.length === 0) return false;
  if (reach.campWide) return true;
  return teamIds.every((id) => reach.ledTeamIds.has(id));
}

/** The sentence a refused team pick reads. */
export function teamAudienceRefusalMessage(
  reason: TeamAudienceRefusal,
): string {
  switch (reason) {
    case "no_teams":
      return "Pick at least one team.";
    case "unknown_team":
      return "One of those teams doesn't exist any more. Reload and pick again.";
    case "not_your_team":
      return "You can only send to the teams you lead.";
  }
}

/**
 * The audience chip for a team audience: "Kitchen team" for one team (a name
 * that already ends in "team" is not doubled), "Kitchen + Build & strike" for
 * several, in the order given. Names of teams deleted since are left out by
 * the caller; with none left it reads "Deleted team".
 */
export function teamAudienceLabel(names: readonly string[]): string {
  const clean = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (clean.length === 0) return "Deleted team";
  if (clean.length === 1) {
    const only = clean[0] as string;
    return /\bteam$/i.test(only) ? only : `${only} team`;
  }
  return clean.join(" + ");
}

/**
 * The chosen teams' names, in the order of `teams` (pass the camp's list
 * order — `sort`, then name — so a chip reads like the picker did), skipping
 * ids whose team no longer exists. The stored ids are sorted by uuid, which
 * is no order a person chose. For building `teamAudienceLabel`'s input.
 */
export function teamNamesFor(
  teamIds: readonly string[],
  teams: readonly { id: string; name: string }[],
): string[] {
  const wanted = new Set(teamIds);
  return teams.filter((t) => wanted.has(t.id)).map((t) => t.name);
}
