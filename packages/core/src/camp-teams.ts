// Camp teams and team chat (docs/camp-teams-spec.md, Ryan 15 Oct 2026). PURE —
// no I/O, no env, no DB. The stores (apps/web/lib/camp-teams-store.ts and the
// team half of apps/web/lib/messages-store.ts) load every fact these
// functions read from the database; a request names a camp by slug and a team
// by id, and nothing else.
//
// ONE TEAM LIST. The shift teams (`shift_teams`) ARE the camp's teams: a team
// has a page (description, leads, members) and a chat. Shifts keep their
// `team_id`; removing someone from a team keeps their shifts.
//
// WHO SEES A TEAM. Every current member of the camp sees its team list and
// each team page. Strangers — and former or erased members — get the camp's
// 404 before anything here is asked. Archived teams are listed for the camp's
// leads only (so they can restore one); a member of an archived team can
// still open it.
//
// WHO MANAGES A TEAM. The camp's structural leads and co-leads (the
// irrevocable backstop, ./project-permissions) on every team, and a team's own
// leads on THAT team only: edit its page, add and remove people, appoint its
// leads, and set its chat's timer. Creating and archiving teams is the camp
// leads' alone.
//
// THE TEAM CHAT IS A DIRECT-MESSAGE CHAT WITH MORE PEOPLE (./messaging). Only
// its CURRENT members read it — a participant row AND a current team
// membership, both required. There is no camp-lead, org or god path: nothing
// here takes a role for reading. A camp lead who wants to read a team chat
// joins the team, which everyone on it can see. The org sees only the copies a
// member reports.
//
//   · HISTORY CUT. A member sees messages sent at or after they joined (the
//     participant row's `joined_at`), never the history before it. Leaving
//     deletes the row; joining again starts a new cut.
//   · BLOCKS HIDE, THEY DO NOT REMOVE. A block between two people (either
//     direction) hides each one's messages from the other in every team chat
//     they share. Neither leaves the team and neither is stopped from posting
//     to everyone else.
//   · TIMER. Team leads and camp leads set it — while they are on the team;
//     a camp lead outside the team has no write path into its chat either.
//   · NO PHONE NUMBERS. People are user ids, shown by handle.

import type {
  MembershipRole,
  NotificationPayload,
  TeamJoinMode,
} from "@quagga/types";
import {
  canReadConversation,
  canReportMessages,
  isBlockedEitherWay,
  type UserBlock,
} from "./messaging";
import { isPermissionBackstop } from "./project-permissions";

// --- Constants -------------------------------------------------------------

/** Audit action names (written in the same transaction as the change). Ids
 * only — never a message, never a description. */
export const TEAM_AUDIT = {
  create: "camp.team.create",
  update: "camp.team.update",
  archive: "camp.team.archive",
  restore: "camp.team.restore",
  add: "camp.team.member.add",
  remove: "camp.team.member.remove",
  lead: "camp.team.lead",
} as const;

// --- Who ---------------------------------------------------------------------

/** The viewer as the store resolved them for ONE camp. */
export interface TeamViewer {
  userId: string;
  /** The viewer's ACTIVE structural role in the camp; null = not a current
   * member (stranger, former member, erased account). */
  campRole: MembershipRole | null;
}

/** What a team decision reads about the team itself. */
export interface TeamFacts {
  joinMode: TeamJoinMode;
  archived: boolean;
}

/** The viewer's own row on this team, if any. */
export interface TeamSeat {
  isLead: boolean;
}

/** Is this camp role a camp lead or co-lead (the backstop)? */
export function isCampLeadRole(role: MembershipRole | null): boolean {
  return role !== null && isPermissionBackstop(role);
}

/** May the viewer see the camp's teams and each team page? Any current
 * member of the camp. Everyone else gets the camp's 404. */
export function canSeeCampTeams(viewer: TeamViewer): boolean {
  return viewer.campRole !== null;
}

/** Is an archived team shown in the list to this viewer? Camp leads only
 * (to restore it), plus anyone still on it. */
export function canSeeArchivedTeam(
  viewer: TeamViewer,
  seat: TeamSeat | null,
): boolean {
  return (
    isCampLeadRole(viewer.campRole) || (viewer.campRole !== null && !!seat)
  );
}

/** May the viewer create a team? Camp leads and co-leads. */
export function canCreateTeam(viewer: TeamViewer): boolean {
  return isCampLeadRole(viewer.campRole);
}

/** May the viewer archive or restore a team? Camp leads and co-leads. */
export function canArchiveTeam(viewer: TeamViewer): boolean {
  return isCampLeadRole(viewer.campRole);
}

/**
 * May the viewer manage THIS team — edit its page, add and remove people,
 * appoint its leads? Camp leads on every team; a team lead on their own team
 * while it is not archived. Never anyone who is not a current camp member.
 */
export function canManageTeam(
  viewer: TeamViewer,
  team: TeamFacts,
  seat: TeamSeat | null,
): boolean {
  if (viewer.campRole === null) return false;
  if (isCampLeadRole(viewer.campRole)) return true;
  return !team.archived && seat?.isLead === true;
}

// --- Joining and leaving -------------------------------------------------------

/** Why a team write was refused (`teamRefusalMessage` words it). */
export type TeamRefusal =
  | "not_member"
  | "not_manager"
  | "archived"
  | "leads_add"
  | "already_on_team"
  | "not_on_team"
  | "target_not_member";

/** A team decision: allowed, or refused with a reason. */
export type TeamDecision = { ok: true } | { ok: false; reason: TeamRefusal };

const ok: TeamDecision = { ok: true };
const no = (reason: TeamRefusal): TeamDecision => ({ ok: false, reason });

/**
 * May the viewer join this team themselves? A current camp member, on an
 * open team that is not archived. A `leads_add` team refuses everyone who
 * cannot manage it — a camp lead may still put themselves on it (they add
 * anyone, themselves included).
 */
export function decideJoinTeam(
  viewer: TeamViewer,
  team: TeamFacts,
  seat: TeamSeat | null,
): TeamDecision {
  if (viewer.campRole === null) return no("not_member");
  if (seat) return no("already_on_team");
  if (team.archived) return no("archived");
  if (team.joinMode === "leads_add" && !isCampLeadRole(viewer.campRole)) {
    return no("leads_add");
  }
  return ok;
}

/** May the viewer leave this team? Anyone on it, always — leaving is never
 * gated (the last lead leaving leaves the camp's leads in charge). */
export function decideLeaveTeam(
  viewer: TeamViewer,
  seat: TeamSeat | null,
): TeamDecision {
  if (viewer.campRole === null) return no("not_member");
  if (!seat) return no("not_on_team");
  return ok;
}

/**
 * May the viewer add this person? A manager of the team, while it is not
 * archived; the person must be a CURRENT member of the camp (not erased) and
 * not already on it.
 */
export function decideAddTeamMember(input: {
  viewer: TeamViewer;
  team: TeamFacts;
  viewerSeat: TeamSeat | null;
  targetIsCampMember: boolean;
  targetSeat: TeamSeat | null;
}): TeamDecision {
  if (input.viewer.campRole === null) return no("not_member");
  if (!canManageTeam(input.viewer, input.team, input.viewerSeat)) {
    return no("not_manager");
  }
  if (input.team.archived) return no("archived");
  if (!input.targetIsCampMember) return no("target_not_member");
  if (input.targetSeat) return no("already_on_team");
  return ok;
}

/** May the viewer remove this person from the team? A manager, and the
 * person must be on it. Their shifts are untouched. */
export function decideRemoveTeamMember(input: {
  viewer: TeamViewer;
  team: TeamFacts;
  viewerSeat: TeamSeat | null;
  targetSeat: TeamSeat | null;
}): TeamDecision {
  if (input.viewer.campRole === null) return no("not_member");
  if (!canManageTeam(input.viewer, input.team, input.viewerSeat)) {
    return no("not_manager");
  }
  if (!input.targetSeat) return no("not_on_team");
  return ok;
}

/** May the viewer make someone a team lead (or stop them being one)? A
 * manager; the person must be on the team (a lead is a member first). */
export function decideSetTeamLead(input: {
  viewer: TeamViewer;
  team: TeamFacts;
  viewerSeat: TeamSeat | null;
  targetSeat: TeamSeat | null;
}): TeamDecision {
  if (input.viewer.campRole === null) return no("not_member");
  if (!canManageTeam(input.viewer, input.team, input.viewerSeat)) {
    return no("not_manager");
  }
  if (input.team.archived) return no("archived");
  if (!input.targetSeat) return no("not_on_team");
  return ok;
}

/** The one sentence a refusal shows. */
export function teamRefusalMessage(reason: TeamRefusal): string {
  switch (reason) {
    case "not_member":
      return "Only members of this camp can do that.";
    case "not_manager":
      return "Only this team's leads and the camp's leads can do that.";
    case "archived":
      return "That team is archived.";
    case "leads_add":
      return "A team lead adds people to this team.";
    case "already_on_team":
      return "They're already on this team.";
    case "not_on_team":
      return "They're not on this team.";
    case "target_not_member":
      return "Only current members of the camp can be added to a team.";
  }
}

// --- Team chat ------------------------------------------------------------------

/** The facts the team chat's gates read, resolved server-side. */
export interface TeamChatAccess {
  viewerUserId: string;
  /** Every participant row of the team's conversation. */
  participantUserIds: readonly string[];
  /** The viewer holds a `team_members` row for this team AND an active
   * membership of its camp AND an account that is not erased. */
  viewerOnTeam: boolean;
}

/**
 * May the viewer read this team chat? ONLY a current member of the team who
 * is a participant of its conversation — both, so a stale participant row or
 * a stale team row alone opens nothing.
 *
 * There is deliberately no role, rank or capability parameter: a camp lead,
 * org staff and the System manager who are not on the team are refused
 * exactly like a stranger.
 */
export function canReadTeamChat(access: TeamChatAccess): boolean {
  return (
    access.viewerOnTeam &&
    canReadConversation({
      viewerUserId: access.viewerUserId,
      participantUserIds: access.participantUserIds,
    })
  );
}

/**
 * May the viewer post into this team chat? A reader, on a team that is not
 * archived. Blocks do NOT refuse a post in a group: they hide the two
 * people's messages from each other (`visibleTeamMessages`), and everyone
 * else still reads both.
 */
export function canSendTeamMessage(
  access: TeamChatAccess,
  team: Pick<TeamFacts, "archived">,
): boolean {
  return canReadTeamChat(access) && !team.archived;
}

/**
 * May the viewer change the team chat's timer? A reader who is a team lead or
 * a camp lead, on a team that is not archived. A camp lead who is not on the
 * team has no way to write into its chat — not even a timer notice.
 */
export function canSetTeamChatTimer(
  access: TeamChatAccess,
  viewer: TeamViewer,
  team: Pick<TeamFacts, "archived">,
  seat: TeamSeat | null,
): boolean {
  if (!canSendTeamMessage(access, team)) return false;
  return isCampLeadRole(viewer.campRole) || seat?.isLead === true;
}

/** One team-chat message as the read path loaded it. */
export interface TeamChatMessage {
  senderId: string;
  createdAt: Date;
}

/**
 * Is this message visible to the viewer? Sent at or after the viewer joined
 * (the history cut), and not from someone they block or who blocks them. The
 * viewer's own messages are always theirs. Expiry is a separate filter
 * (./messaging `isMessageLive`).
 */
export function isTeamMessageVisible(
  message: TeamChatMessage,
  viewer: { userId: string; joinedAt: Date },
  blocks: readonly UserBlock[],
): boolean {
  if (message.createdAt.getTime() < viewer.joinedAt.getTime()) return false;
  if (message.senderId === viewer.userId) return true;
  return !isBlockedEitherWay(blocks, viewer.userId, message.senderId);
}

/** The messages of a team chat the viewer may see, in the given order. */
export function visibleTeamMessages<T extends TeamChatMessage>(
  messages: readonly T[],
  viewer: { userId: string; joinedAt: Date },
  blocks: readonly UserBlock[],
): T[] {
  return messages.filter((m) => isTeamMessageVisible(m, viewer, blocks));
}

/**
 * May the reporter attach these messages to a report? The direct-message rule
 * (a reader, a bounded non-empty selection, every message from this
 * conversation) plus: every message must be one the reporter can SEE — a
 * report is never a way to reach history from before they joined or messages
 * a block hides from them.
 */
export function canReportTeamMessages(input: {
  access: TeamChatAccess;
  conversationId: string;
  joinedAt: Date;
  blocks: readonly UserBlock[];
  selected: readonly {
    id: string;
    conversationId: string;
    senderId: string;
    createdAt: Date;
  }[];
}): boolean {
  if (!canReadTeamChat(input.access)) return false;
  if (
    !canReportMessages({
      reporterUserId: input.access.viewerUserId,
      conversationId: input.conversationId,
      participantUserIds: input.access.participantUserIds,
      selected: input.selected,
    })
  ) {
    return false;
  }
  const viewer = {
    userId: input.access.viewerUserId,
    joinedAt: input.joinedAt,
  };
  return input.selected.every((m) =>
    isTeamMessageVisible(m, viewer, input.blocks),
  );
}

/**
 * Who a team-chat report is about: the person (other than the reporter) who
 * sent the most of the selected messages, the earliest on a tie. Null when
 * the reporter selected only their own. The org's queue shows every copy with
 * its sender regardless.
 */
export function reportedTeamSender(
  reporterUserId: string,
  selected: readonly { senderId: string; createdAt: Date }[],
): string | null {
  const counts = new Map<string, { n: number; first: number }>();
  for (const m of selected) {
    if (m.senderId === reporterUserId) continue;
    const c = counts.get(m.senderId);
    const t = m.createdAt.getTime();
    if (c) {
      c.n += 1;
      c.first = Math.min(c.first, t);
    } else {
      counts.set(m.senderId, { n: 1, first: t });
    }
  }
  let best: string | null = null;
  let bestN = 0;
  let bestFirst = Infinity;
  for (const [id, c] of counts) {
    if (c.n > bestN || (c.n === bestN && c.first < bestFirst)) {
      best = id;
      bestN = c.n;
      bestFirst = c.first;
    }
  }
  return best;
}

/**
 * The team inbox row's line: who and how many, or who sent last — never
 * what. Matches the direct-message preview rule (./messaging
 * `unreadMessagesLine`).
 */
export function teamInboxLine(input: {
  unread: number;
  lastSenderName: string | null;
}): string {
  const from = input.lastSenderName
    ? ` · last from ${input.lastSenderName}`
    : "";
  if (input.unread <= 0) {
    return input.lastSenderName
      ? `Last message from ${input.lastSenderName}`
      : "No messages yet";
  }
  const count =
    input.unread === 1 ? "1 new message" : `${input.unread} new messages`;
  return `${count}${from}`;
}

// --- Notifications ---------------------------------------------------------------

/**
 * "You were added to {team}" — to a person a lead added. Joining a team
 * yourself sends nothing. Kind `team`, the camp's name as the body, a link to
 * the team page. Names and ids only — never a private field.
 */
export function teamAddedNotification(input: {
  campName: string;
  campSlug: string;
  teamId: string;
  teamName: string;
}): NotificationPayload {
  return {
    kind: "team",
    title: `You were added to ${input.teamName}`,
    body: input.campName,
    link: `/camps/${encodeURIComponent(input.campSlug)}/teams/${input.teamId}`,
  };
}
