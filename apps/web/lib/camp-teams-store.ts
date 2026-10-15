import "server-only";

import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { activeMembership } from "@quagga/db";
import {
  SHIFT_MAX_TEAMS,
  TEAM_AUDIT,
  canArchiveTeam,
  canCreateTeam,
  canManageTeam,
  canSeeCampTeams,
  decideAddTeamMember,
  decideJoinTeam,
  decideLeaveTeam,
  decideRemoveTeamMember,
  decideSetTeamLead,
  isCampLeadRole,
  normalizeTeamName,
  publicMemberName,
  teamAddedNotification,
  teamRefusalMessage,
  type NotificationRow,
  type TeamDecision,
  type TeamFacts,
  type TeamSeat,
  type TeamViewer,
} from "@quagga/core";
import {
  AddTeamMembersInput,
  ArchiveTeamInput,
  CreateTeamInput,
  RemoveTeamMemberInput,
  ReportTeamMessagesInput,
  SendTeamMessageInput,
  SetTeamChatTimerInput,
  SetTeamLeadInput,
  TEAM_MAX_LEADS,
  TeamSelfInput,
  UpdateTeamInput,
  isProjectKind,
  type GroupKind,
  type MembershipRole,
  type TeamJoinMode,
} from "@quagga/types";
import { isDatabaseConfigured } from "./config";
import { db, schema, withTransaction, type Tx } from "./db";
import {
  addTeamChatParticipants,
  ensureTeamConversation,
  getTeamChat,
  removeTeamChatParticipants,
  reportTeamMessages,
  sendTeamMessage,
  setTeamChatTimer,
  type DmResult,
  type TeamChatView,
} from "./messages-store";
import { insertNotifications } from "./notifications";

// Camp teams (docs/camp-teams-spec.md). Every rule is a pure @quagga/core
// function (camp-teams.ts); this file loads the facts those functions read —
// from the database, never from the request — and performs the writes. The
// team CHAT's reads and writes live in ./messages-store (the team half),
// behind the same direct-message law; the wrappers at the bottom only parse
// the input and resolve the camp.
//
// SCOPING. A request names a camp by slug and then ids: a team, a person. The
// viewer's ACTIVE membership of that camp is resolved first; a non-member gets
// null from every read and "That team doesn't exist." from every write. A team
// is only ever found by (id, this camp), so another camp's team answers like
// an unknown id. A person is only ever added while they hold an ACTIVE
// membership of this camp on an account that is not erased.
//
// ONE LIST. Teams are `shift_teams` rows: the shifts team editor and this file
// edit the same list (a team's name is unique per camp, case-insensitively).
//
// RACES. Every write runs in one transaction that first locks the memberships
// AND accounts it depends on — the actor's and anyone being added — `FOR
// SHARE`, in one statement, re-checking `archived_at` and `sanitized_at` under
// the lock (the Work Access Pass pattern, which account-sanitize.ts relies on:
// erasure takes the users row `FOR UPDATE` before it deletes anything, and an
// archive UPDATEs the membership row, so either the write waits and re-reads
// nobody, or the cleanup comes after and deletes what it wrote). It then takes
// the team row `FOR UPDATE`, so two writes to one team serialise. Lock order is
// memberships/users → team row everywhere in this file.
//
// THE CHAT FOLLOWS THE TEAM. `team_members` and the team chat's
// `conversation_participants` change in the SAME transaction: joining starts
// the history cut, leaving or being removed deletes the participant row.
//
// NOTIFICATIONS ("You were added to {team}") are inserted after the commit,
// best effort. Joining a team yourself sends nothing.
//
// PRIVACY. Names are handles (`publicMemberName`); nothing here reads a phone,
// an emergency contact, an ID or a medical note.

/** A team write's result: ok with extras, or one sentence saying why not. */
export type TeamResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

const INVALID = "Check the form and try again.";
const MISSING = "That team doesn't exist.";
const TEAM_TAKEN = "The camp already has a team with that name.";

function refused(decision: TeamDecision): { ok: false; error: string } {
  return {
    ok: false,
    error: decision.ok ? INVALID : teamRefusalMessage(decision.reason),
  };
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

// --- Camp and viewer -----------------------------------------------------------

interface TeamCamp {
  id: string;
  name: string;
  slug: string;
}

/** The camp by slug, if it is a kind that has teams (any project). */
async function findCamp(slug: string): Promise<TeamCamp | null> {
  const [group] = await db()
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      slug: schema.groups.slug,
      kind: schema.groups.kind,
    })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!group || !isProjectKind(group.kind as GroupKind)) return null;
  return { id: group.id, name: group.name, slug: group.slug };
}

/** The viewer's ACTIVE role in this camp, null when they are no member (or an
 * erased account). Unlocked: for reads. */
async function viewerRole(
  groupId: string,
  userId: string,
): Promise<MembershipRole | null> {
  const [row] = await db()
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        eq(schema.memberships.userId, userId),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}

interface LockedPerson {
  userId: string;
  role: MembershipRole;
  name: string;
}

/**
 * Lock the actor's membership and account — and, for an add or a lead
 * appointment, every other person named — `FOR SHARE`, in ONE statement,
 * before the team row. Only ACTIVE memberships of this camp on accounts that
 * are not erased come back; Postgres re-checks both on a row it waited for.
 */
async function lockPeople(
  tx: Tx,
  groupId: string,
  userIds: readonly string[],
): Promise<Map<string, LockedPerson>> {
  const ids = [...new Set(userIds)];
  const rows = await tx
    .select({
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        inArray(schema.memberships.userId, ids),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .orderBy(asc(schema.memberships.id))
    // The USERS row too: erasure locks it `FOR UPDATE` before deleting team
    // rows (account-sanitize.ts step 1c) and never touches a membership row.
    .for("share", { of: [schema.memberships, schema.users] });
  const out = new Map<string, LockedPerson>();
  for (const r of rows) {
    // `isNull(sanitizedAt)` is re-evaluated on the waited-for row; this is
    // the belt to that brace.
    if (r.sanitizedAt !== null) continue;
    out.set(r.userId, {
      userId: r.userId,
      role: r.role,
      name: publicMemberName(r.username),
    });
  }
  return out;
}

interface LockedTeam {
  id: string;
  name: string;
  facts: TeamFacts;
  /** Everyone on the team, by user id. */
  seats: Map<string, TeamSeat>;
}

/** The team row `FOR UPDATE`, scoped to this camp, with its seats. */
async function lockTeam(
  tx: Tx,
  groupId: string,
  teamId: string,
): Promise<LockedTeam | null> {
  const [team] = await tx
    .select({
      id: schema.shiftTeams.id,
      name: schema.shiftTeams.name,
      joinMode: schema.shiftTeams.joinMode,
      archivedAt: schema.shiftTeams.archivedAt,
    })
    .from(schema.shiftTeams)
    .where(
      and(
        eq(schema.shiftTeams.id, teamId),
        eq(schema.shiftTeams.groupId, groupId),
      ),
    )
    .limit(1)
    .for("update");
  if (!team) return null;
  const seats = await tx
    .select({
      userId: schema.teamMembers.userId,
      isLead: schema.teamMembers.isLead,
    })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.teamId, teamId));
  return {
    id: team.id,
    name: team.name,
    facts: { joinMode: team.joinMode, archived: team.archivedAt !== null },
    seats: new Map(seats.map((s) => [s.userId, { isLead: s.isLead }])),
  };
}

function viewerOf(
  userId: string,
  people: Map<string, LockedPerson>,
): TeamViewer {
  return { userId, campRole: people.get(userId)?.role ?? null };
}

async function audit(
  tx: Tx,
  actorId: string,
  action: string,
  subject: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await tx
    .insert(schema.auditEvents)
    .values({ actorId, action, subject, meta });
}

function addedNotices(
  camp: TeamCamp,
  team: { id: string; name: string },
  userIds: readonly string[],
): NotificationRow[] {
  const payload = teamAddedNotification({
    campName: camp.name,
    campSlug: camp.slug,
    teamId: team.id,
    teamName: team.name,
  });
  return userIds.map((userId) => ({
    ...payload,
    userId,
    origin: "camp",
    linkApp: "web",
  }));
}

/** Insert after commit. Best effort: a failed notice never fails the change. */
async function notifyAfterCommit(rows: NotificationRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await insertNotifications(db(), rows);
  } catch (err) {
    console.error("[notifications] team notice failed", err);
  }
}

/**
 * The shape every write shares: parse, find the camp, open the transaction,
 * lock the actor (and anyone else named) and hand over. Notices queued by the
 * write go out after the commit.
 */
async function withTeamWrite<T>(
  slug: string,
  viewerUserId: string,
  otherUserIds: readonly string[],
  fn: (
    tx: Tx,
    ctx: {
      camp: TeamCamp;
      viewer: TeamViewer;
      people: Map<string, LockedPerson>;
      notices: NotificationRow[];
      now: Date;
    },
  ) => Promise<TeamResult<T>>,
): Promise<TeamResult<T>> {
  if (!isDatabaseConfigured()) return { ok: false, error: MISSING };
  const camp = await findCamp(slug);
  if (!camp) return { ok: false, error: MISSING };
  const notices: NotificationRow[] = [];
  const now = new Date();
  try {
    const result = await withTransaction(async (tx) => {
      const people = await lockPeople(tx, camp.id, [
        viewerUserId,
        ...otherUserIds,
      ]);
      const viewer = viewerOf(viewerUserId, people);
      // A stranger, former member or erased account: the camp's 404.
      if (!canSeeCampTeams(viewer))
        return { ok: false as const, error: MISSING };
      return fn(tx, { camp, viewer, people, notices, now });
    });
    if (result.ok) await notifyAfterCommit(notices);
    return result;
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: TEAM_TAKEN };
    throw err;
  }
}

// --- Reads ---------------------------------------------------------------------

/** One person on a team, by handle — never a contact detail. */
export interface TeamPersonView {
  userId: string;
  displayName: string;
  isLead: boolean;
}

/** One row of the camp's team list (frame T1). */
export interface TeamListItem {
  id: string;
  name: string;
  joinMode: TeamJoinMode;
  archived: boolean;
  memberCount: number;
  leads: TeamPersonView[];
  viewerOnTeam: boolean;
  /** The viewer may tap Join (open team, or a camp lead on any team). */
  canJoin: boolean;
}

/** The camp's team list for one viewer. */
export interface CampTeamsView {
  camp: TeamCamp;
  canCreate: boolean;
  teams: TeamListItem[];
}

/** Current team members (active camp membership, account not erased), for
 * these teams. Every read of who is on a team goes through here. */
async function loadSeats(
  groupId: string,
  teamIds: readonly string[],
): Promise<
  {
    teamId: string;
    userId: string;
    isLead: boolean;
    username: string | null;
  }[]
> {
  if (teamIds.length === 0) return [];
  return db()
    .select({
      teamId: schema.teamMembers.teamId,
      userId: schema.teamMembers.userId,
      isLead: schema.teamMembers.isLead,
      username: schema.users.username,
    })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
    .innerJoin(
      schema.memberships,
      and(
        eq(schema.memberships.userId, schema.teamMembers.userId),
        eq(schema.memberships.groupId, groupId),
        activeMembership(),
      ),
    )
    .where(
      and(
        inArray(schema.teamMembers.teamId, [...teamIds]),
        isNull(schema.users.sanitizedAt),
      ),
    );
}

function personView(row: {
  userId: string;
  isLead: boolean;
  username: string | null;
}): TeamPersonView {
  return {
    userId: row.userId,
    displayName: publicMemberName(row.username),
    isLead: row.isLead,
  };
}

function byName(a: TeamPersonView, b: TeamPersonView): number {
  return a.displayName.localeCompare(b.displayName);
}

/**
 * The camp's teams for a current member, or null (the camp's 404) for
 * everyone else. Archived teams are listed for the camp's leads and for
 * people still on them.
 */
export async function listCampTeams(input: {
  slug: string;
  viewerUserId: string;
}): Promise<CampTeamsView | null> {
  if (!isDatabaseConfigured()) return null;
  const camp = await findCamp(input.slug);
  if (!camp) return null;
  const viewer: TeamViewer = {
    userId: input.viewerUserId,
    campRole: await viewerRole(camp.id, input.viewerUserId),
  };
  if (!canSeeCampTeams(viewer)) return null;
  const teams = await db()
    .select({
      id: schema.shiftTeams.id,
      name: schema.shiftTeams.name,
      joinMode: schema.shiftTeams.joinMode,
      archivedAt: schema.shiftTeams.archivedAt,
    })
    .from(schema.shiftTeams)
    .where(eq(schema.shiftTeams.groupId, camp.id))
    .orderBy(asc(schema.shiftTeams.sort), asc(schema.shiftTeams.createdAt));
  const seats = await loadSeats(
    camp.id,
    teams.map((t) => t.id),
  );
  const campLead = isCampLeadRole(viewer.campRole);
  const items: TeamListItem[] = [];
  for (const t of teams) {
    const on = seats.filter((s) => s.teamId === t.id);
    const mine = on.find((s) => s.userId === input.viewerUserId);
    const seat = mine ? { isLead: mine.isLead } : null;
    const archived = t.archivedAt !== null;
    if (archived && !campLead && !seat) continue;
    items.push({
      id: t.id,
      name: t.name,
      joinMode: t.joinMode,
      archived,
      memberCount: on.length,
      leads: on
        .filter((s) => s.isLead)
        .map(personView)
        .sort(byName),
      viewerOnTeam: seat !== null,
      canJoin: decideJoinTeam(viewer, { joinMode: t.joinMode, archived }, seat)
        .ok,
    });
  }
  return { camp, canCreate: canCreateTeam(viewer), teams: items };
}

/** One team's page for one viewer (frame T2): who is on it and what the
 * viewer may do there. */
export interface CampTeamView {
  camp: TeamCamp;
  id: string;
  name: string;
  description: string | null;
  joinMode: TeamJoinMode;
  archived: boolean;
  leads: TeamPersonView[];
  members: TeamPersonView[];
  viewerOnTeam: boolean;
  viewerIsTeamLead: boolean;
  canJoin: boolean;
  canManage: boolean;
  canArchive: boolean;
  /** The team chat's conversation id — only for someone on the team (the
   * chat's own gate still decides every read). */
  chatConversationId: string | null;
}

/**
 * One team's page for a current member of its camp, or null — for everyone
 * else, for another camp's team, and for an archived team the viewer may not
 * see, identically.
 */
export async function getCampTeam(input: {
  slug: string;
  teamId: string;
  viewerUserId: string;
}): Promise<CampTeamView | null> {
  if (!isDatabaseConfigured()) return null;
  const camp = await findCamp(input.slug);
  if (!camp) return null;
  const viewer: TeamViewer = {
    userId: input.viewerUserId,
    campRole: await viewerRole(camp.id, input.viewerUserId),
  };
  if (!canSeeCampTeams(viewer)) return null;
  const [team] = await db()
    .select({
      id: schema.shiftTeams.id,
      name: schema.shiftTeams.name,
      description: schema.shiftTeams.description,
      joinMode: schema.shiftTeams.joinMode,
      archivedAt: schema.shiftTeams.archivedAt,
    })
    .from(schema.shiftTeams)
    .where(
      and(
        eq(schema.shiftTeams.id, input.teamId),
        eq(schema.shiftTeams.groupId, camp.id),
      ),
    )
    .limit(1);
  if (!team) return null;
  const seats = await loadSeats(camp.id, [team.id]);
  const mine = seats.find((s) => s.userId === input.viewerUserId);
  const seat = mine ? { isLead: mine.isLead } : null;
  const facts: TeamFacts = {
    joinMode: team.joinMode,
    archived: team.archivedAt !== null,
  };
  if (facts.archived && !isCampLeadRole(viewer.campRole) && !seat) return null;
  const people = seats.map(personView).sort(byName);
  const [chat] = seat
    ? await db()
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.teamId, team.id))
        .limit(1)
    : [];
  return {
    camp,
    id: team.id,
    name: team.name,
    description: team.description,
    joinMode: team.joinMode,
    archived: facts.archived,
    leads: people.filter((p) => p.isLead),
    members: people,
    viewerOnTeam: seat !== null,
    viewerIsTeamLead: seat?.isLead === true,
    canJoin: decideJoinTeam(viewer, facts, seat).ok,
    canManage: canManageTeam(viewer, facts, seat),
    canArchive: canArchiveTeam(viewer),
    chatConversationId: chat?.id ?? null,
  };
}

/**
 * Who a manager may add: the camp's current members (accounts not erased)
 * who are not on the team, by name. Empty for anyone who cannot manage it.
 */
export async function listTeamCandidates(input: {
  slug: string;
  teamId: string;
  viewerUserId: string;
}): Promise<TeamPersonView[]> {
  const team = await getCampTeam(input);
  if (!team || !team.canManage) return [];
  const onTeam = new Set(team.members.map((m) => m.userId));
  const rows = await db()
    .select({
      userId: schema.memberships.userId,
      username: schema.users.username,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, team.camp.id),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    );
  return rows
    .filter((r) => !onTeam.has(r.userId))
    .map((r) => ({
      userId: r.userId,
      displayName: publicMemberName(r.username),
      isLead: false,
    }))
    .sort(byName);
}

/**
 * Who a camp lead may name as a new team's leads: the camp's current members
 * (accounts not erased), by name. Empty for anyone who may not create a team
 * — the create write re-checks every id under its own lock.
 */
export async function listNewTeamLeadCandidates(input: {
  slug: string;
  viewerUserId: string;
}): Promise<TeamPersonView[]> {
  if (!isDatabaseConfigured()) return [];
  const camp = await findCamp(input.slug);
  if (!camp) return [];
  const viewer: TeamViewer = {
    userId: input.viewerUserId,
    campRole: await viewerRole(camp.id, input.viewerUserId),
  };
  if (!canCreateTeam(viewer)) return [];
  const rows = await db()
    .select({
      userId: schema.memberships.userId,
      username: schema.users.username,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, camp.id),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    );
  return rows
    .map((r) => ({
      userId: r.userId,
      displayName: publicMemberName(r.username),
      isLead: false,
    }))
    .sort(byName);
}

// --- Writes: teams -------------------------------------------------------------

/**
 * Create a team (camp leads). Its chat is created with it, and any leads
 * named go on it (and into its chat) as team leads, told "You were added".
 */
export async function createCampTeam(
  viewerUserId: string,
  raw: unknown,
): Promise<TeamResult<{ id: string }>> {
  const parsed = CreateTeamInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withTeamWrite(
    input.slug,
    viewerUserId,
    input.leadUserIds,
    async (tx, { camp, viewer, people, notices, now }) => {
      if (!canCreateTeam(viewer)) {
        return refused({ ok: false, reason: "not_manager" });
      }
      const leads = [...new Set(input.leadUserIds)];
      if (leads.some((id) => !people.has(id))) {
        return refused({ ok: false, reason: "target_not_member" });
      }
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.shiftTeams)
        .where(eq(schema.shiftTeams.groupId, camp.id));
      if ((count?.n ?? 0) >= SHIFT_MAX_TEAMS) {
        return {
          ok: false,
          error: `A camp can have up to ${SHIFT_MAX_TEAMS} teams.`,
        };
      }
      const [row] = await tx
        .insert(schema.shiftTeams)
        .values({
          groupId: camp.id,
          name: input.name,
          nameNormalized: normalizeTeamName(input.name),
          description: input.description,
          joinMode: input.joinMode,
          sort: count?.n ?? 0,
        })
        .returning({ id: schema.shiftTeams.id });
      if (!row) return { ok: false, error: INVALID };
      // Making a team is editing the list: the shifts starter list must not
      // be added on top of it later (shifts-store `ensureStarterTeams`).
      await tx
        .update(schema.groups)
        .set({ shiftTeamsSeededAt: now })
        .where(
          and(
            eq(schema.groups.id, camp.id),
            isNull(schema.groups.shiftTeamsSeededAt),
          ),
        );
      const conversationId = await ensureTeamConversation(
        tx,
        row.id,
        viewerUserId,
      );
      if (leads.length > 0) {
        await tx.insert(schema.teamMembers).values(
          leads.map((userId) => ({
            teamId: row.id,
            userId,
            isLead: true,
            addedByUserId: viewerUserId,
            createdAt: now,
            updatedAt: now,
          })),
        );
        await addTeamChatParticipants(tx, conversationId, leads, now);
      }
      await audit(tx, viewerUserId, TEAM_AUDIT.create, row.id, {
        groupId: camp.id,
        joinMode: input.joinMode,
        leads: leads.length,
      });
      notices.push(
        ...addedNotices(
          camp,
          { id: row.id, name: input.name },
          leads.filter((id) => id !== viewerUserId),
        ),
      );
      return { ok: true, id: row.id };
    },
  );
}

/** Edit a team's name, description and join mode (team leads, camp leads). */
export async function updateCampTeam(
  viewerUserId: string,
  raw: unknown,
): Promise<TeamResult> {
  const parsed = UpdateTeamInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withTeamWrite(
    input.slug,
    viewerUserId,
    [],
    async (tx, { camp, viewer }) => {
      const team = await lockTeam(tx, camp.id, input.teamId);
      if (!team) return { ok: false, error: MISSING };
      if (
        !canManageTeam(viewer, team.facts, team.seats.get(viewerUserId) ?? null)
      ) {
        return refused({ ok: false, reason: "not_manager" });
      }
      await tx
        .update(schema.shiftTeams)
        .set({
          name: input.name,
          nameNormalized: normalizeTeamName(input.name),
          description: input.description,
          joinMode: input.joinMode,
        })
        .where(eq(schema.shiftTeams.id, team.id));
      await audit(tx, viewerUserId, TEAM_AUDIT.update, team.id, {
        groupId: camp.id,
        joinMode: input.joinMode,
      });
      return { ok: true };
    },
  );
}

/** Archive or restore a team (camp leads). Archived: off the list, its chat
 * read-only. Its members, shifts and chat are kept. */
export async function setCampTeamArchived(
  viewerUserId: string,
  raw: unknown,
): Promise<TeamResult> {
  const parsed = ArchiveTeamInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withTeamWrite(
    input.slug,
    viewerUserId,
    [],
    async (tx, { camp, viewer, now }) => {
      const team = await lockTeam(tx, camp.id, input.teamId);
      if (!team) return { ok: false, error: MISSING };
      if (!canArchiveTeam(viewer)) {
        return refused({ ok: false, reason: "not_manager" });
      }
      await tx
        .update(schema.shiftTeams)
        .set({ archivedAt: input.archived ? now : null })
        .where(eq(schema.shiftTeams.id, team.id));
      await audit(
        tx,
        viewerUserId,
        input.archived ? TEAM_AUDIT.archive : TEAM_AUDIT.restore,
        team.id,
        { groupId: camp.id },
      );
      return { ok: true };
    },
  );
}

// --- Writes: who is on a team ----------------------------------------------------

/** Join an open team yourself (camp leads: any team). Into its chat from now
 * on — never the history before. Sends no notice. */
export async function joinCampTeam(
  viewerUserId: string,
  raw: unknown,
): Promise<TeamResult> {
  const parsed = TeamSelfInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withTeamWrite(
    input.slug,
    viewerUserId,
    [],
    async (tx, { camp, viewer, now }) => {
      const team = await lockTeam(tx, camp.id, input.teamId);
      if (!team) return { ok: false, error: MISSING };
      const decision = decideJoinTeam(
        viewer,
        team.facts,
        team.seats.get(viewerUserId) ?? null,
      );
      if (!decision.ok) return refused(decision);
      await tx.insert(schema.teamMembers).values({
        teamId: team.id,
        userId: viewerUserId,
        isLead: false,
        addedByUserId: null,
        createdAt: now,
        updatedAt: now,
      });
      const conversationId = await ensureTeamConversation(
        tx,
        team.id,
        viewerUserId,
      );
      await addTeamChatParticipants(tx, conversationId, [viewerUserId], now);
      return { ok: true };
    },
  );
}

/** Leave a team. Out of its chat, keeping nothing of it; shifts are kept. */
export async function leaveCampTeam(
  viewerUserId: string,
  raw: unknown,
): Promise<TeamResult> {
  const parsed = TeamSelfInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withTeamWrite(
    input.slug,
    viewerUserId,
    [],
    async (tx, { camp, viewer }) => {
      const team = await lockTeam(tx, camp.id, input.teamId);
      if (!team) return { ok: false, error: MISSING };
      const decision = decideLeaveTeam(
        viewer,
        team.seats.get(viewerUserId) ?? null,
      );
      if (!decision.ok) return refused(decision);
      await takeOffTeam(tx, team.id, viewerUserId);
      return { ok: true };
    },
  );
}

/** Delete one person's team row and chat participation, together. */
async function takeOffTeam(
  tx: Tx,
  teamId: string,
  userId: string,
): Promise<void> {
  await tx
    .delete(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, userId),
      ),
    );
  await removeTeamChatParticipants(tx, [teamId], userId);
}

/**
 * Add camp members to a team (team leads, camp leads). All or nothing: one
 * person who is not a current camp member, or already on it, refuses the
 * whole add. Each person added is told "You were added to {team}".
 */
export async function addCampTeamMembers(
  viewerUserId: string,
  raw: unknown,
): Promise<TeamResult<{ added: number }>> {
  const parsed = AddTeamMembersInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  const targets = [...new Set(input.userIds)];
  return withTeamWrite(
    input.slug,
    viewerUserId,
    targets,
    async (tx, { camp, viewer, people, notices, now }) => {
      const team = await lockTeam(tx, camp.id, input.teamId);
      if (!team) return { ok: false, error: MISSING };
      const viewerSeat = team.seats.get(viewerUserId) ?? null;
      for (const userId of targets) {
        const decision = decideAddTeamMember({
          viewer,
          team: team.facts,
          viewerSeat,
          targetIsCampMember: people.has(userId),
          targetSeat: team.seats.get(userId) ?? null,
        });
        if (!decision.ok) return refused(decision);
      }
      await tx.insert(schema.teamMembers).values(
        targets.map((userId) => ({
          teamId: team.id,
          userId,
          isLead: false,
          addedByUserId: viewerUserId,
          createdAt: now,
          updatedAt: now,
        })),
      );
      const conversationId = await ensureTeamConversation(
        tx,
        team.id,
        viewerUserId,
      );
      await addTeamChatParticipants(tx, conversationId, targets, now);
      for (const userId of targets) {
        await audit(tx, viewerUserId, TEAM_AUDIT.add, userId, {
          groupId: camp.id,
          teamId: team.id,
        });
      }
      notices.push(
        ...addedNotices(
          camp,
          team,
          targets.filter((id) => id !== viewerUserId),
        ),
      );
      return { ok: true, added: targets.length };
    },
  );
}

/** Remove someone from a team (team leads, camp leads). They leave its chat;
 * their shifts stay as they are. */
export async function removeCampTeamMember(
  viewerUserId: string,
  raw: unknown,
): Promise<TeamResult> {
  const parsed = RemoveTeamMemberInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withTeamWrite(
    input.slug,
    viewerUserId,
    [],
    async (tx, { camp, viewer }) => {
      const team = await lockTeam(tx, camp.id, input.teamId);
      if (!team) return { ok: false, error: MISSING };
      const decision = decideRemoveTeamMember({
        viewer,
        team: team.facts,
        viewerSeat: team.seats.get(viewerUserId) ?? null,
        targetSeat: team.seats.get(input.userId) ?? null,
      });
      if (!decision.ok) return refused(decision);
      await takeOffTeam(tx, team.id, input.userId);
      await audit(tx, viewerUserId, TEAM_AUDIT.remove, input.userId, {
        groupId: camp.id,
        teamId: team.id,
      });
      return { ok: true };
    },
  );
}

/** Make someone on the team a team lead, or stop them being one (team leads,
 * camp leads). The person must still be a current camp member. */
export async function setCampTeamLead(
  viewerUserId: string,
  raw: unknown,
): Promise<TeamResult> {
  const parsed = SetTeamLeadInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withTeamWrite(
    input.slug,
    viewerUserId,
    [input.userId],
    async (tx, { camp, viewer, people, now }) => {
      const team = await lockTeam(tx, camp.id, input.teamId);
      if (!team) return { ok: false, error: MISSING };
      const decision = decideSetTeamLead({
        viewer,
        team: team.facts,
        viewerSeat: team.seats.get(viewerUserId) ?? null,
        targetSeat: people.has(input.userId)
          ? (team.seats.get(input.userId) ?? null)
          : null,
      });
      if (!decision.ok) return refused(decision);
      // The cap the create form enforces holds for appointments too. Counted
      // from the seats read under the team row's FOR UPDATE lock, so two
      // concurrent appointments cannot both slip under it.
      if (input.isLead && team.seats.get(input.userId)?.isLead !== true) {
        let leads = 0;
        for (const seat of team.seats.values()) if (seat.isLead) leads++;
        if (leads >= TEAM_MAX_LEADS) {
          return {
            ok: false,
            error: `A team can have up to ${TEAM_MAX_LEADS} leads.`,
          };
        }
      }
      await tx
        .update(schema.teamMembers)
        .set({ isLead: input.isLead, updatedAt: now })
        .where(
          and(
            eq(schema.teamMembers.teamId, team.id),
            eq(schema.teamMembers.userId, input.userId),
          ),
        );
      await audit(tx, viewerUserId, TEAM_AUDIT.lead, input.userId, {
        groupId: camp.id,
        teamId: team.id,
        isLead: input.isLead,
      });
      return { ok: true };
    },
  );
}

// --- Cleanup: leaving the camp, archive, erasure -----------------------------------

/**
 * Take a person off every team of ONE camp, and out of those teams' chats, in
 * the caller's transaction. Called when they leave the camp
 * (groups-store `leaveCamp`), are archived from it and restored
 * (member-archive-store). Shifts are untouched.
 */
export async function removeFromCampTeams(
  tx: Tx,
  where: { userId: string; groupId: string },
): Promise<void> {
  const campTeams: SQLWrapper = tx
    .select({ id: schema.shiftTeams.id })
    .from(schema.shiftTeams)
    .where(eq(schema.shiftTeams.groupId, where.groupId));
  await tx
    .delete(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.userId, where.userId),
        inArray(schema.teamMembers.teamId, campTeams),
      ),
    );
  await removeTeamChatParticipants(tx, campTeams, where.userId);
}

/**
 * Take an erased account off EVERY team in every camp, and out of every team
 * chat (account-sanitize.ts). Their messages are deleted there by sender.
 */
export async function removeFromAllTeams(
  tx: Tx,
  userId: string,
): Promise<void> {
  await tx
    .delete(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, userId));
  await tx
    .delete(schema.conversationParticipants)
    .where(
      and(
        eq(schema.conversationParticipants.userId, userId),
        inArray(
          schema.conversationParticipants.conversationId,
          tx
            .select({ id: schema.conversations.id })
            .from(schema.conversations)
            .where(eq(schema.conversations.kind, "team")),
        ),
      ),
    );
}

// --- Team chat: parse, resolve the camp, hand to the messages store ------------------

/** The team's chat for a current member of the team, or null. */
export async function loadTeamChat(input: {
  slug: string;
  teamId: string;
  viewerUserId: string;
}): Promise<TeamChatView | null> {
  if (!isDatabaseConfigured()) return null;
  const camp = await findCamp(input.slug);
  if (!camp) return null;
  return getTeamChat({
    groupId: camp.id,
    teamId: input.teamId,
    viewerUserId: input.viewerUserId,
  });
}

/** A team chat opened from the inbox, with the camp it belongs to. */
export interface TeamChatByConversation {
  campSlug: string;
  chat: TeamChatView;
}

/**
 * The team chat behind an inbox row's conversation id, for a current member
 * of the team — or null for everyone else, for a direct chat's id and for an
 * id that does not exist, identically. Resolving the id reads only the
 * conversation's team and camp; every gate is `getTeamChat`'s.
 */
export async function loadTeamChatByConversation(input: {
  conversationId: string;
  viewerUserId: string;
}): Promise<TeamChatByConversation | null> {
  if (!isDatabaseConfigured()) return null;
  const [row] = await db()
    .select({
      teamId: schema.shiftTeams.id,
      groupId: schema.shiftTeams.groupId,
      campSlug: schema.groups.slug,
    })
    .from(schema.conversations)
    .innerJoin(
      schema.shiftTeams,
      eq(schema.shiftTeams.id, schema.conversations.teamId),
    )
    .innerJoin(schema.groups, eq(schema.groups.id, schema.shiftTeams.groupId))
    .where(
      and(
        eq(schema.conversations.id, input.conversationId),
        eq(schema.conversations.kind, "team"),
      ),
    )
    .limit(1);
  if (!row) return null;
  const chat = await getTeamChat({
    groupId: row.groupId,
    teamId: row.teamId,
    viewerUserId: input.viewerUserId,
  });
  return chat ? { campSlug: row.campSlug, chat } : null;
}

const CHAT_MISSING = "That team chat isn't available.";

/** Post into a team chat (current members of the team). */
export async function postTeamMessage(
  viewerUserId: string,
  raw: unknown,
): Promise<DmResult<{ phoneHint: boolean }>> {
  const parsed = SendTeamMessageInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const camp = await findCamp(parsed.data.slug);
  if (!camp) return { ok: false, error: CHAT_MISSING };
  return sendTeamMessage({
    groupId: camp.id,
    teamId: parsed.data.teamId,
    viewerUserId,
    body: parsed.data.body,
  });
}

/** Change a team chat's timer (team leads and camp leads on the team). */
export async function changeTeamChatTimer(
  viewerUserId: string,
  raw: unknown,
): Promise<DmResult> {
  const parsed = SetTeamChatTimerInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const camp = await findCamp(parsed.data.slug);
  if (!camp) return { ok: false, error: CHAT_MISSING };
  return setTeamChatTimer({
    groupId: camp.id,
    teamId: parsed.data.teamId,
    viewerUserId,
    timer: parsed.data.timer,
  });
}

/** Report selected team-chat messages to the org safety queue. */
export async function reportTeamChatMessages(
  viewerUserId: string,
  raw: unknown,
): Promise<DmResult<{ reportId: string }>> {
  const parsed = ReportTeamMessagesInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const camp = await findCamp(parsed.data.slug);
  if (!camp) return { ok: false, error: CHAT_MISSING };
  return reportTeamMessages({
    groupId: camp.id,
    teamId: parsed.data.teamId,
    viewerUserId,
    messageIds: parsed.data.messageIds,
    reason: parsed.data.reason,
  });
}
