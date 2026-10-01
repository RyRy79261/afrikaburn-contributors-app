import "server-only";

import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  canManageShifts,
  decideAcceptHandover,
  decideAssign,
  decideHandTo,
  decideShiftDays,
  decideSignUp,
  decideTakeOffered,
  heldAssignment,
  normalizeTeamName,
  publicMemberName,
  SHIFT_AUDIT,
  SHIFT_MAX_TEAMS,
  SHIFT_STARTER_TEAMS,
  shiftAssignedNotification,
  shiftCancelledNotification,
  shiftChangedHandsNotification,
  shiftChangedNotification,
  shiftDays,
  shiftHandedOnNotification,
  shiftHandoverDeclinedNotification,
  shiftHandoverRequestNotification,
  shiftRefusalMessage,
  shiftTimingChanged,
  shiftUnassignedNotification,
  type NotificationPayload,
  type NotificationRow,
  type ShiftCreateInput,
  type ShiftFacts,
  type ShiftMemberFacts,
  type ShiftNoticeContext,
  type ShiftRefusal,
  type ShiftSignupMode,
  type ShiftSlot,
  type ShiftUpdateInput,
} from "@quagga/core";
import type { MembershipRole } from "@quagga/types";
import { activeMembership } from "@quagga/db";
import { db, schema, withTransaction, type Tx } from "./db";
import { insertNotifications } from "./notifications";

// Camp shifts (epic #57). Every rule is a pure @quagga/core function
// (packages/core/src/shifts.ts); this file loads the facts those functions
// read — from the database, never from the request — and performs the writes.
//
// SCOPING. A request names a camp by slug and then only ids: a shift, an
// assignment, a membership, a team, a role. Every one of them is resolved
// INSIDE the camp the caller's membership was resolved for (`groupId`) and
// inside the active edition, so an id from another camp answers exactly like
// one that does not exist.
//
// FORMER MEMBERS. Every membership read goes through `activeMembership()`: an
// archived member is on no shift, can be handed nothing, and is refused every
// write here (their membership resolves to null). The archive transaction also
// deletes their assignments (lib/member-archive-store.ts).
//
// RACES. Every write that depends on who is on a shift runs in one transaction
// that first locks the memberships it moves a spot to (`lockParties`), then
// takes the shift row `FOR UPDATE`, then re-reads the facts and re-decides.
// Two people taking the last spot, or the same offered spot, are serialised on
// the shift lock; one member going onto two overlapping shifts at once, or
// being archived mid-write, on the membership lock. The loser re-reads and is
// refused.
//
// NOTIFICATIONS are inserted AFTER the transaction commits, best effort — a
// failed notice never un-does a shift change (docs/notifications-spec.md).

export type ShiftResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

type Handle = Tx | ReturnType<typeof db>;

const STALE = "That shift changed while you were looking — refresh and try again.";
const MISSING = "That shift doesn't exist.";

// --- Views -----------------------------------------------------------------

export interface ShiftTeamView {
  id: string;
  name: string;
}

export interface ShiftMemberView {
  membershipId: string;
  userId: string;
  role: MembershipRole;
  displayName: string;
  /** Project roles held with an ACCEPTED assignment. */
  heldRoleIds: string[];
}

export interface ShiftAssignmentView {
  id: string;
  membershipId: string;
  userId: string;
  displayName: string;
  offered: boolean;
  /** A pending hand-to request, to an ACTIVE member (else null). */
  handoverTo: { membershipId: string; displayName: string } | null;
}

export interface ShiftView extends ShiftSlot {
  id: string;
  name: string;
  capacity: number;
  signupMode: ShiftSignupMode;
  teamId: string | null;
  teamName: string | null;
  requiredRoleId: string | null;
  requiredRoleName: string | null;
  assignments: ShiftAssignmentView[];
}

export interface ShiftBoard {
  shifts: ShiftView[];
  members: ShiftMemberView[];
  teams: ShiftTeamView[];
}

/** A view → the facts @quagga/core decides over. */
export function toShiftFacts(s: ShiftView): ShiftFacts {
  return {
    id: s.id,
    date: s.date,
    startMinute: s.startMinute,
    durationMinutes: s.durationMinutes,
    capacity: s.capacity,
    signupMode: s.signupMode,
    requiredRoleId: s.requiredRoleId,
    assignments: s.assignments.map((a) => ({
      id: a.id,
      membershipId: a.membershipId,
      offered: a.offered,
      handoverToMembershipId: a.handoverTo?.membershipId ?? null,
    })),
  };
}

/** A member → the facts @quagga/core decides over, relative to one shift. */
export function toMemberFacts(
  member: Pick<ShiftMemberView, "membershipId" | "heldRoleIds">,
  shifts: readonly ShiftView[],
  excludeShiftId: string,
): ShiftMemberFacts {
  return {
    membershipId: member.membershipId,
    heldRoleIds: new Set(member.heldRoleIds),
    otherShifts: shifts.filter(
      (s) =>
        s.id !== excludeShiftId &&
        s.assignments.some((a) => a.membershipId === member.membershipId),
    ),
  };
}

// --- Reads -----------------------------------------------------------------

/** The camp's active members, with the camp roles they hold. */
async function loadMembers(
  handle: Handle,
  groupId: string,
): Promise<ShiftMemberView[]> {
  const rows = await handle
    .select({
      membershipId: schema.memberships.id,
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
        activeMembership(),
        // A deleted ("Departed Burner") account is nobody to put on a shift,
        // hand one to, or list — its spots went with the erasure.
        isNull(schema.users.sanitizedAt),
      ),
    );
  if (rows.length === 0) return [];

  const held = await handle
    .select({
      membershipId: schema.memberRoleAssignments.membershipId,
      projectRoleId: schema.memberRoleAssignments.projectRoleId,
    })
    .from(schema.memberRoleAssignments)
    .where(
      and(
        inArray(
          schema.memberRoleAssignments.membershipId,
          rows.map((r) => r.membershipId),
        ),
        eq(schema.memberRoleAssignments.consentStatus, "accepted"),
      ),
    );
  const byMember = new Map<string, string[]>();
  for (const h of held) {
    const list = byMember.get(h.membershipId) ?? [];
    list.push(h.projectRoleId);
    byMember.set(h.membershipId, list);
  }
  return rows
    .map((r) => ({
      membershipId: r.membershipId,
      userId: r.userId,
      role: r.role,
      displayName: publicMemberName(r.username, { sanitizedAt: r.sanitizedAt }),
      heldRoleIds: byMember.get(r.membershipId) ?? [],
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** The camp's shift teams, in the lead's order. */
export async function listShiftTeams(groupId: string): Promise<ShiftTeamView[]> {
  return db()
    .select({ id: schema.shiftTeams.id, name: schema.shiftTeams.name })
    .from(schema.shiftTeams)
    .where(eq(schema.shiftTeams.groupId, groupId))
    .orderBy(asc(schema.shiftTeams.sort), asc(schema.shiftTeams.createdAt));
}

/**
 * Write the starter team list ONCE per camp: a compare-and-set on
 * `groups.shift_teams_seeded_at` decides who writes it, so two leads opening
 * Shifts at once seed it once, and a lead who removed every team later is
 * never handed the list again. Called only for a viewer who manages shifts.
 */
export async function ensureStarterTeams(groupId: string): Promise<void> {
  const [group] = await db()
    .select({ seededAt: schema.groups.shiftTeamsSeededAt })
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .limit(1);
  if (!group || group.seededAt) return;
  await withTransaction(async (tx) => {
    const claimed = await tx
      .update(schema.groups)
      .set({ shiftTeamsSeededAt: new Date() })
      .where(
        and(
          eq(schema.groups.id, groupId),
          isNull(schema.groups.shiftTeamsSeededAt),
        ),
      )
      .returning({ id: schema.groups.id });
    if (!claimed[0]) return;
    await tx
      .insert(schema.shiftTeams)
      .values(
        SHIFT_STARTER_TEAMS.map((name, i) => ({
          groupId,
          name,
          nameNormalized: normalizeTeamName(name),
          sort: i,
        })),
      )
      .onConflictDoNothing();
  });
}

/** Every shift of this camp in this edition, with who is on each. */
async function loadShifts(
  handle: Handle,
  groupId: string,
  editionId: string,
  members: readonly ShiftMemberView[],
): Promise<ShiftView[]> {
  const rows = await handle
    .select({
      id: schema.shifts.id,
      name: schema.shifts.name,
      date: schema.shifts.shiftDate,
      startMinute: schema.shifts.startMinute,
      durationMinutes: schema.shifts.durationMinutes,
      capacity: schema.shifts.capacity,
      signupMode: schema.shifts.signupMode,
      teamId: schema.shifts.teamId,
      teamName: schema.shiftTeams.name,
      requiredRoleId: schema.shifts.requiredRoleId,
      requiredRoleName: schema.projectRoles.name,
    })
    .from(schema.shifts)
    .leftJoin(schema.shiftTeams, eq(schema.shiftTeams.id, schema.shifts.teamId))
    .leftJoin(
      schema.projectRoles,
      eq(schema.projectRoles.id, schema.shifts.requiredRoleId),
    )
    .where(
      and(
        eq(schema.shifts.groupId, groupId),
        eq(schema.shifts.editionId, editionId),
      ),
    )
    .orderBy(
      asc(schema.shifts.shiftDate),
      asc(schema.shifts.startMinute),
      asc(schema.shifts.name),
    );
  if (rows.length === 0) return [];

  const assigned = await handle
    .select({
      id: schema.shiftAssignments.id,
      shiftId: schema.shiftAssignments.shiftId,
      membershipId: schema.shiftAssignments.membershipId,
      offeredAt: schema.shiftAssignments.offeredAt,
      handoverTo: schema.shiftAssignments.handoverToMembershipId,
      createdAt: schema.shiftAssignments.createdAt,
    })
    .from(schema.shiftAssignments)
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.id, schema.shiftAssignments.membershipId),
    )
    .where(
      and(
        inArray(
          schema.shiftAssignments.shiftId,
          rows.map((r) => r.id),
        ),
        eq(schema.memberships.groupId, groupId),
        activeMembership(),
      ),
    )
    .orderBy(asc(schema.shiftAssignments.createdAt));

  // `members` is the ACTIVE member list: an assignment or a request naming
  // anyone outside it is invisible here, exactly as the SQL above excludes it.
  const byId = new Map(members.map((m) => [m.membershipId, m]));
  const byShift = new Map<string, ShiftAssignmentView[]>();
  for (const a of assigned) {
    const who = byId.get(a.membershipId);
    if (!who) continue;
    const target = a.handoverTo ? byId.get(a.handoverTo) : undefined;
    const list = byShift.get(a.shiftId) ?? [];
    list.push({
      id: a.id,
      membershipId: a.membershipId,
      userId: who.userId,
      displayName: who.displayName,
      offered: a.offeredAt !== null,
      handoverTo: target
        ? { membershipId: target.membershipId, displayName: target.displayName }
        : null,
    });
    byShift.set(a.shiftId, list);
  }
  return rows.map((r) => ({
    ...r,
    assignments: byShift.get(r.id) ?? [],
  }));
}

/** Everything the Shifts pages render, for one camp and edition. */
export async function loadShiftBoard(
  groupId: string,
  editionId: string,
): Promise<ShiftBoard> {
  const handle = db();
  const [members, teams] = await Promise.all([
    loadMembers(handle, groupId),
    listShiftTeams(groupId),
  ]);
  const shifts = await loadShifts(handle, groupId, editionId, members);
  return { shifts, members, teams };
}

/**
 * The camp page's Shifts tile: counts only. `open` is the spots THIS viewer
 * would see as open: a lead sees every gap, a member only the spots on shifts
 * they could sign up for (`open` mode) — a lead-only shift is never in a
 * member's Open shifts, so the tile must not count it for them either.
 * Filled spots are counted exactly as the board counts them: this camp's
 * active, non-deleted members only.
 */
export async function getShiftTileSummary(
  groupId: string,
  editionId: string,
  viewer: { canManage: boolean },
): Promise<{
  shifts: number;
  open: number;
  teams: string[];
  firstDate: string | null;
  lastDate: string | null;
}> {
  const rows = await db()
    .select({
      date: schema.shifts.shiftDate,
      capacity: schema.shifts.capacity,
      signupMode: schema.shifts.signupMode,
      teamName: schema.shiftTeams.name,
      filled: sql<number>`(
        select count(*)::int from ${schema.shiftAssignments}
        inner join ${schema.memberships}
          on ${schema.memberships.id} = ${schema.shiftAssignments.membershipId}
        inner join ${schema.users}
          on ${schema.users.id} = ${schema.memberships.userId}
        where ${schema.shiftAssignments.shiftId} = ${schema.shifts.id}
          and ${schema.memberships.groupId} = ${groupId}
          and ${activeMembership()}
          and ${schema.users.sanitizedAt} is null
      )`,
    })
    .from(schema.shifts)
    .leftJoin(schema.shiftTeams, eq(schema.shiftTeams.id, schema.shifts.teamId))
    .where(
      and(
        eq(schema.shifts.groupId, groupId),
        eq(schema.shifts.editionId, editionId),
      ),
    );
  let open = 0;
  let first: string | null = null;
  let last: string | null = null;
  const teams = new Set<string>();
  for (const r of rows) {
    if (viewer.canManage || r.signupMode === "open") {
      open += Math.max(0, r.capacity - Number(r.filled));
    }
    if (r.teamName) teams.add(r.teamName);
    if (first === null || r.date < first) first = r.date;
    if (last === null || r.date > last) last = r.date;
  }
  return {
    shifts: rows.length,
    open,
    teams: [...teams],
    firstDate: first,
    lastDate: last,
  };
}

// --- Write plumbing --------------------------------------------------------

interface ActorMembership {
  membershipId: string;
  userId: string;
  role: MembershipRole;
  displayName: string;
}

/** The caller's ACTIVE membership of this camp, read inside the write's
 * transaction and held `FOR SHARE` until it commits — a demotion or an archive
 * that committed first is what this sees. */
async function lockActor(
  tx: Tx,
  groupId: string,
  userId: string,
): Promise<ActorMembership | null> {
  const [row] = await tx
    .select({
      membershipId: schema.memberships.id,
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
        eq(schema.memberships.userId, userId),
        activeMembership(),
      ),
    )
    .limit(1)
    .for("share", { of: schema.memberships });
  if (!row) return null;
  return {
    membershipId: row.membershipId,
    userId: row.userId,
    role: row.role,
    displayName: publicMemberName(row.username, { sanitizedAt: row.sanitizedAt }),
  };
}

/**
 * Lock EVERY member a write moves a spot to — the caller and, for an
 * assignment or a hand-to, the person on the other end — `FOR NO KEY UPDATE`,
 * in ONE statement, BEFORE the shift row. Two reasons, both found in review:
 *
 *   · M1, ARCHIVE. A concurrent archive UPDATEs the membership row, so it now
 *     waits for this write (or this write waits for it, then re-reads the row
 *     under `activeMembership()` and finds no member). The foreign key alone
 *     takes only `FOR KEY SHARE`, which an archive's update does not conflict
 *     with — a spot could be inserted for someone archived a moment earlier.
 *   · M2, CLASHES. The clash check reads the member's other shifts. Two
 *     sign-ups for the same member (two tabs, or the member and a lead) on
 *     two overlapping shifts each lock a DIFFERENT shift row, so the shift
 *     lock alone lets both pass. `FOR NO KEY UPDATE` conflicts with itself,
 *     so the second waits here and — READ COMMITTED, a fresh snapshot per
 *     statement — reads the first one's spot when it goes on.
 *
 * `FOR SHARE` would serve M1 but not M2 (two shares never wait for each
 * other). `NO KEY` keeps foreign-key inserts elsewhere unblocked.
 *
 * Lock order is memberships (sorted by id, one statement) → shift, everywhere
 * in this file — `lockActor` takes one membership, then the shift — so no two
 * writes here can deadlock. Sanitised accounts are no member: nobody hands a
 * shift to a "Departed Burner".
 */
async function lockParties(
  tx: Tx,
  groupId: string,
  userId: string,
  otherMembershipIds: readonly string[] = [],
): Promise<{
  actor: ActorMembership | null;
  others: Map<string, ActorMembership>;
}> {
  const who =
    otherMembershipIds.length > 0
      ? or(
          eq(schema.memberships.userId, userId),
          inArray(schema.memberships.id, [...otherMembershipIds]),
        )
      : eq(schema.memberships.userId, userId);
  const rows = await tx
    .select({
      membershipId: schema.memberships.id,
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
        who,
        // Re-checked UNDER the lock: archived while we waited = gone.
        activeMembership(),
      ),
    )
    .orderBy(asc(schema.memberships.id))
    .for("no key update", { of: schema.memberships });
  let actor: ActorMembership | null = null;
  const others = new Map<string, ActorMembership>();
  for (const r of rows) {
    const party: ActorMembership = {
      membershipId: r.membershipId,
      userId: r.userId,
      role: r.role,
      displayName: publicMemberName(r.username, { sanitizedAt: r.sanitizedAt }),
    };
    if (r.userId === userId) {
      actor = party;
      continue;
    }
    if (r.sanitizedAt !== null) continue;
    others.set(r.membershipId, party);
  }
  return { actor, others };
}

function mayManage(actor: ActorMembership | null): boolean {
  return (
    actor !== null &&
    canManageShifts({ structuralRole: actor.role, rolePermissions: [] })
  );
}

interface LockedShift {
  facts: ShiftFacts;
  view: ShiftView;
  members: ShiftMemberView[];
  /** Every shift of the camp this edition (for clash checks). */
  all: ShiftView[];
}

/**
 * Take the shift row `FOR UPDATE` (scoped to this camp and edition), then read
 * the camp's members and shifts in the same transaction. Null when the shift
 * is not this camp's, not this edition's, or gone.
 */
async function lockShift(
  tx: Tx,
  groupId: string,
  editionId: string,
  shiftId: string,
): Promise<LockedShift | null> {
  const [locked] = await tx
    .select({ id: schema.shifts.id })
    .from(schema.shifts)
    .where(
      and(
        eq(schema.shifts.id, shiftId),
        eq(schema.shifts.groupId, groupId),
        eq(schema.shifts.editionId, editionId),
      ),
    )
    .limit(1)
    .for("update");
  if (!locked) return null;
  const members = await loadMembers(tx, groupId);
  const all = await loadShifts(tx, groupId, editionId, members);
  const view = all.find((s) => s.id === shiftId);
  if (!view) return null;
  return { facts: toShiftFacts(view), view, members, all };
}

function memberFactsFor(
  locked: LockedShift,
  membershipId: string,
): { member: ShiftMemberView; facts: ShiftMemberFacts } | null {
  const member = locked.members.find((m) => m.membershipId === membershipId);
  if (!member) return null;
  return { member, facts: toMemberFacts(member, locked.all, locked.view.id) };
}

async function campNotice(
  handle: Handle,
  groupId: string,
): Promise<{ name: string; slug: string } | null> {
  const [g] = await handle
    .select({ name: schema.groups.name, slug: schema.groups.slug })
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .limit(1);
  return g ?? null;
}

function noticeContext(
  camp: { name: string; slug: string },
  shift: Pick<ShiftView, "name" | "date" | "startMinute" | "durationMinutes">,
): ShiftNoticeContext {
  return {
    campName: camp.name,
    campSlug: camp.slug,
    shiftName: shift.name,
    date: shift.date,
    startMinute: shift.startMinute,
    durationMinutes: shift.durationMinutes,
  };
}

function toRow(userId: string, payload: NotificationPayload): NotificationRow {
  return { ...payload, userId, origin: "camp", linkApp: "web" };
}

/** Insert after commit. Best effort: a failed notice never fails the change. */
async function notifyAfterCommit(rows: NotificationRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await insertNotifications(db(), rows);
  } catch (err) {
    console.error("[notifications] shift notice failed", err);
  }
}

/** The camp's leads and co-leads, minus anyone already told personally. */
function leadRecipients(
  members: readonly ShiftMemberView[],
  exclude: readonly string[],
): string[] {
  const skip = new Set(exclude);
  return members
    .filter(
      (m) => (m.role === "lead" || m.role === "admin") && !skip.has(m.userId),
    )
    .map((m) => m.userId);
}

function refused(reason: ShiftRefusal, roleName?: string | null) {
  return { ok: false as const, error: shiftRefusalMessage(reason, roleName) };
}

/** Is this team id one of THIS camp's teams? */
async function teamBelongs(
  tx: Tx,
  groupId: string,
  teamId: string | null,
): Promise<boolean> {
  if (teamId === null) return true;
  const [t] = await tx
    .select({ id: schema.shiftTeams.id })
    .from(schema.shiftTeams)
    .where(
      and(eq(schema.shiftTeams.id, teamId), eq(schema.shiftTeams.groupId, groupId)),
    )
    .limit(1);
  return !!t;
}

/** Is this role id one of THIS camp's roles, and one a shift may require?
 * The baseline role is held by everyone, so "requiring" it means nothing. */
async function roleBelongs(
  tx: Tx,
  groupId: string,
  roleId: string | null,
): Promise<boolean> {
  if (roleId === null) return true;
  const [r] = await tx
    .select({ id: schema.projectRoles.id })
    .from(schema.projectRoles)
    .where(
      and(
        eq(schema.projectRoles.id, roleId),
        eq(schema.projectRoles.groupId, groupId),
        ne(schema.projectRoles.kind, "baseline"),
      ),
    )
    .limit(1);
  return !!r;
}

// --- Lead: create, edit, delete ---------------------------------------------

export async function createShifts(input: {
  actorUserId: string;
  groupId: string;
  edition: { id: string; startDate: string; endDate: string };
  fields: Omit<ShiftCreateInput, "slug">;
}): Promise<ShiftResult<{ created: number }>> {
  const { fields } = input;
  const days = decideShiftDays(shiftDays(input.edition), fields.dates);
  if (!days.ok) return refused(days.reason);
  const dates = [...new Set(fields.dates)];

  return withTransaction(async (tx) => {
    const actor = await lockActor(tx, input.groupId, input.actorUserId);
    if (!mayManage(actor)) return refused("not_manager");
    if (!(await teamBelongs(tx, input.groupId, fields.teamId))) {
      return { ok: false, error: "That team doesn't exist any more." };
    }
    if (!(await roleBelongs(tx, input.groupId, fields.requiredRoleId))) {
      return { ok: false, error: "That camp role doesn't exist any more." };
    }
    const inserted = await tx
      .insert(schema.shifts)
      .values(
        dates.map((date) => ({
          groupId: input.groupId,
          editionId: input.edition.id,
          teamId: fields.teamId,
          name: fields.name,
          shiftDate: date,
          startMinute: fields.startMinute,
          durationMinutes: fields.durationMinutes,
          capacity: fields.capacity,
          requiredRoleId: fields.requiredRoleId,
          signupMode: fields.signupMode,
          createdByUserId: input.actorUserId,
        })),
      )
      .returning({ id: schema.shifts.id });
    await tx.insert(schema.auditEvents).values({
      actorId: input.actorUserId,
      action: SHIFT_AUDIT.create,
      subject: input.groupId,
      meta: { groupId: input.groupId, shiftIds: inserted.map((r) => r.id) },
    });
    return { ok: true as const, created: inserted.length };
  });
}

export async function updateShift(input: {
  actorUserId: string;
  groupId: string;
  edition: { id: string; startDate: string; endDate: string };
  fields: Omit<ShiftUpdateInput, "slug">;
}): Promise<ShiftResult> {
  const { fields } = input;
  const day = decideShiftDays(shiftDays(input.edition), [fields.date]);
  if (!day.ok) return refused(day.reason);

  const notices: NotificationRow[] = [];
  const result = await withTransaction(async (tx): Promise<ShiftResult> => {
    const actor = await lockActor(tx, input.groupId, input.actorUserId);
    if (!mayManage(actor)) return refused("not_manager");
    const locked = await lockShift(tx, input.groupId, input.edition.id, fields.id);
    if (!locked) return { ok: false, error: MISSING };
    if (!(await teamBelongs(tx, input.groupId, fields.teamId))) {
      return { ok: false, error: "That team doesn't exist any more." };
    }
    if (!(await roleBelongs(tx, input.groupId, fields.requiredRoleId))) {
      return { ok: false, error: "That camp role doesn't exist any more." };
    }
    const on = locked.view.assignments.length;
    if (fields.capacity < on) {
      return {
        ok: false,
        error: `${on} people are on this shift — take someone off before making it smaller.`,
      };
    }
    await tx
      .update(schema.shifts)
      .set({
        name: fields.name,
        teamId: fields.teamId,
        shiftDate: fields.date,
        startMinute: fields.startMinute,
        durationMinutes: fields.durationMinutes,
        capacity: fields.capacity,
        requiredRoleId: fields.requiredRoleId,
        signupMode: fields.signupMode,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.shifts.id, fields.id),
          eq(schema.shifts.groupId, input.groupId),
        ),
      );
    await tx.insert(schema.auditEvents).values({
      actorId: input.actorUserId,
      action: SHIFT_AUDIT.update,
      subject: input.groupId,
      meta: { groupId: input.groupId, shiftId: fields.id },
    });

    const after = {
      name: fields.name,
      date: fields.date,
      startMinute: fields.startMinute,
      durationMinutes: fields.durationMinutes,
    };
    if (shiftTimingChanged(locked.view, after)) {
      const camp = await campNotice(tx, input.groupId);
      if (camp) {
        const payload = shiftChangedNotification(
          noticeContext(camp, locked.view),
          noticeContext(camp, after),
          actor!.displayName,
        );
        for (const a of locked.view.assignments) {
          if (a.userId !== input.actorUserId) notices.push(toRow(a.userId, payload));
        }
      }
    }
    return { ok: true };
  });
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

export async function deleteShift(input: {
  actorUserId: string;
  groupId: string;
  editionId: string;
  shiftId: string;
}): Promise<ShiftResult> {
  const notices: NotificationRow[] = [];
  const result = await withTransaction(async (tx): Promise<ShiftResult> => {
    const actor = await lockActor(tx, input.groupId, input.actorUserId);
    if (!mayManage(actor)) return refused("not_manager");
    const locked = await lockShift(tx, input.groupId, input.editionId, input.shiftId);
    if (!locked) return { ok: false, error: MISSING };
    await tx
      .delete(schema.shifts)
      .where(
        and(
          eq(schema.shifts.id, input.shiftId),
          eq(schema.shifts.groupId, input.groupId),
        ),
      );
    await tx.insert(schema.auditEvents).values({
      actorId: input.actorUserId,
      action: SHIFT_AUDIT.delete,
      subject: input.groupId,
      meta: { groupId: input.groupId, shiftId: input.shiftId },
    });
    const camp = await campNotice(tx, input.groupId);
    if (camp) {
      const payload = shiftCancelledNotification(
        noticeContext(camp, locked.view),
        actor!.displayName,
      );
      for (const a of locked.view.assignments) {
        if (a.userId !== input.actorUserId) notices.push(toRow(a.userId, payload));
      }
    }
    return { ok: true };
  });
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

// --- Lead: assign and take off ----------------------------------------------

export async function assignToShift(input: {
  actorUserId: string;
  groupId: string;
  editionId: string;
  shiftId: string;
  membershipId: string;
}): Promise<ShiftResult> {
  const notices: NotificationRow[] = [];
  const result = await withTransaction(async (tx): Promise<ShiftResult> => {
    // The lead AND the member they put on, locked before the shift (M1, M2).
    const { actor, others } = await lockParties(
      tx,
      input.groupId,
      input.actorUserId,
      [input.membershipId],
    );
    const locked = await lockShift(tx, input.groupId, input.editionId, input.shiftId);
    if (!locked) return { ok: false, error: MISSING };
    const lockedTarget =
      others.has(input.membershipId) || actor?.membershipId === input.membershipId;
    const target = lockedTarget ? memberFactsFor(locked, input.membershipId) : null;
    const decision = decideAssign(
      locked.facts,
      mayManage(actor),
      target?.facts ?? null,
    );
    if (!decision.ok) return refused(decision.reason, locked.view.requiredRoleName);
    await tx.insert(schema.shiftAssignments).values({
      shiftId: input.shiftId,
      membershipId: input.membershipId,
      assignedByUserId: input.actorUserId,
    });
    await tx.insert(schema.auditEvents).values({
      actorId: input.actorUserId,
      action: SHIFT_AUDIT.assign,
      subject: target!.member.userId,
      meta: {
        groupId: input.groupId,
        shiftId: input.shiftId,
        membershipId: input.membershipId,
      },
    });
    const camp = await campNotice(tx, input.groupId);
    if (camp && target!.member.userId !== input.actorUserId) {
      notices.push(
        toRow(
          target!.member.userId,
          shiftAssignedNotification(
            noticeContext(camp, locked.view),
            actor!.displayName,
          ),
        ),
      );
    }
    return { ok: true };
  });
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

export async function unassignFromShift(input: {
  actorUserId: string;
  groupId: string;
  editionId: string;
  shiftId: string;
  assignmentId: string;
}): Promise<ShiftResult> {
  const notices: NotificationRow[] = [];
  const result = await withTransaction(async (tx): Promise<ShiftResult> => {
    const actor = await lockActor(tx, input.groupId, input.actorUserId);
    if (!mayManage(actor)) return refused("not_manager");
    const locked = await lockShift(tx, input.groupId, input.editionId, input.shiftId);
    if (!locked) return { ok: false, error: MISSING };
    const row = locked.view.assignments.find((a) => a.id === input.assignmentId);
    if (!row) return { ok: false, error: STALE };
    await tx
      .delete(schema.shiftAssignments)
      .where(
        and(
          eq(schema.shiftAssignments.id, row.id),
          eq(schema.shiftAssignments.shiftId, input.shiftId),
        ),
      );
    await tx.insert(schema.auditEvents).values({
      actorId: input.actorUserId,
      action: SHIFT_AUDIT.unassign,
      subject: row.userId,
      meta: {
        groupId: input.groupId,
        shiftId: input.shiftId,
        membershipId: row.membershipId,
      },
    });
    const camp = await campNotice(tx, input.groupId);
    if (camp && row.userId !== input.actorUserId) {
      notices.push(
        toRow(
          row.userId,
          shiftUnassignedNotification(
            noticeContext(camp, locked.view),
            actor!.displayName,
          ),
        ),
      );
    }
    return { ok: true };
  });
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

// --- Member: sign up, leave -------------------------------------------------

export async function signUpForShift(input: {
  userId: string;
  groupId: string;
  editionId: string;
  shiftId: string;
}): Promise<ShiftResult> {
  return withTransaction(async (tx): Promise<ShiftResult> => {
    // Their own membership locked before the shift: the clash check (M2).
    const { actor } = await lockParties(tx, input.groupId, input.userId);
    const locked = await lockShift(tx, input.groupId, input.editionId, input.shiftId);
    if (!locked) return { ok: false, error: MISSING };
    const me = actor ? memberFactsFor(locked, actor.membershipId) : null;
    const decision = decideSignUp(locked.facts, me?.facts ?? null);
    if (!decision.ok) {
      // In the first person: it is the caller who lacks the role / is on it.
      if (decision.reason === "already_on") {
        return { ok: false, error: "You're already on that shift." };
      }
      if (decision.reason === "needs_role") {
        return {
          ok: false,
          error: locked.view.requiredRoleName
            ? `This shift needs the ${locked.view.requiredRoleName} role.`
            : "This shift needs a camp role you don't hold.",
        };
      }
      return refused(decision.reason);
    }
    await tx.insert(schema.shiftAssignments).values({
      shiftId: input.shiftId,
      membershipId: actor!.membershipId,
      assignedByUserId: null,
    });
    return { ok: true };
  });
}

/** Take yourself off a shift. Nobody is notified; the lead sees the gap. */
export async function leaveShift(input: {
  userId: string;
  groupId: string;
  editionId: string;
  shiftId: string;
}): Promise<ShiftResult> {
  return withTransaction(async (tx): Promise<ShiftResult> => {
    const actor = await lockActor(tx, input.groupId, input.userId);
    if (!actor) return refused("not_member");
    const locked = await lockShift(tx, input.groupId, input.editionId, input.shiftId);
    if (!locked) return { ok: false, error: MISSING };
    const mine = heldAssignment(locked.facts, actor.membershipId);
    if (!mine) return refused("not_on_shift");
    await tx
      .delete(schema.shiftAssignments)
      .where(
        and(
          eq(schema.shiftAssignments.id, mine.id),
          eq(schema.shiftAssignments.membershipId, actor.membershipId),
        ),
      );
    return { ok: true };
  });
}

// --- Member: hand on ---------------------------------------------------------

/** Offer your spot up as "needs a replacement". You stay on it meanwhile. */
export async function offerShift(input: {
  userId: string;
  groupId: string;
  editionId: string;
  shiftId: string;
}): Promise<ShiftResult> {
  return withTransaction(async (tx): Promise<ShiftResult> => {
    const actor = await lockActor(tx, input.groupId, input.userId);
    if (!actor) return refused("not_member");
    const locked = await lockShift(tx, input.groupId, input.editionId, input.shiftId);
    if (!locked) return { ok: false, error: MISSING };
    const mine = heldAssignment(locked.facts, actor.membershipId);
    if (!mine) return refused("not_on_shift");
    await tx
      .update(schema.shiftAssignments)
      .set({ offeredAt: new Date(), handoverToMembershipId: null })
      .where(
        and(
          eq(schema.shiftAssignments.id, mine.id),
          eq(schema.shiftAssignments.membershipId, actor.membershipId),
        ),
      );
    return { ok: true };
  });
}

/** Take it back: withdraw an offer or a pending hand-to request. */
export async function withdrawHandOn(input: {
  userId: string;
  groupId: string;
  editionId: string;
  shiftId: string;
}): Promise<ShiftResult> {
  return withTransaction(async (tx): Promise<ShiftResult> => {
    const actor = await lockActor(tx, input.groupId, input.userId);
    if (!actor) return refused("not_member");
    const locked = await lockShift(tx, input.groupId, input.editionId, input.shiftId);
    if (!locked) return { ok: false, error: MISSING };
    const mine = heldAssignment(locked.facts, actor.membershipId);
    if (!mine) return refused("not_on_shift");
    await tx
      .update(schema.shiftAssignments)
      .set({ offeredAt: null, handoverToMembershipId: null })
      .where(
        and(
          eq(schema.shiftAssignments.id, mine.id),
          eq(schema.shiftAssignments.membershipId, actor.membershipId),
        ),
      );
    return { ok: true };
  });
}

/** Ask one campmate to take your spot. They accept or decline. */
export async function handShiftTo(input: {
  userId: string;
  groupId: string;
  editionId: string;
  shiftId: string;
  toMembershipId: string;
}): Promise<ShiftResult> {
  const notices: NotificationRow[] = [];
  const result = await withTransaction(async (tx): Promise<ShiftResult> => {
    // The holder AND the campmate it is handed to, locked before the shift: a
    // request is never left pointing at someone archived meanwhile (M1).
    const { actor, others } = await lockParties(tx, input.groupId, input.userId, [
      input.toMembershipId,
    ]);
    if (!actor) return refused("not_member");
    const locked = await lockShift(tx, input.groupId, input.editionId, input.shiftId);
    if (!locked) return { ok: false, error: MISSING };
    const target =
      others.has(input.toMembershipId) ||
      input.toMembershipId === actor.membershipId
        ? memberFactsFor(locked, input.toMembershipId)
        : null;
    const decision = decideHandTo(
      locked.facts,
      actor.membershipId,
      target?.facts ?? null,
    );
    if (!decision.ok) return refused(decision.reason, locked.view.requiredRoleName);
    const mine = heldAssignment(locked.facts, actor.membershipId)!;
    await tx
      .update(schema.shiftAssignments)
      .set({ offeredAt: null, handoverToMembershipId: input.toMembershipId })
      .where(
        and(
          eq(schema.shiftAssignments.id, mine.id),
          eq(schema.shiftAssignments.membershipId, actor.membershipId),
        ),
      );
    const camp = await campNotice(tx, input.groupId);
    if (camp) {
      notices.push(
        toRow(
          target!.member.userId,
          shiftHandoverRequestNotification(
            noticeContext(camp, locked.view),
            actor.displayName,
          ),
        ),
      );
    }
    return { ok: true };
  });
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

/** Answer a hand-to request made to you. Accepting moves the spot to you. */
export async function respondToHandOn(input: {
  userId: string;
  groupId: string;
  editionId: string;
  shiftId: string;
  accept: boolean;
}): Promise<ShiftResult> {
  const notices: NotificationRow[] = [];
  const result = await withTransaction(async (tx): Promise<ShiftResult> => {
    // Their own membership locked before the shift: the clash check (M2).
    const { actor } = await lockParties(tx, input.groupId, input.userId);
    if (!actor) return refused("not_member");
    const locked = await lockShift(tx, input.groupId, input.editionId, input.shiftId);
    if (!locked) return { ok: false, error: MISSING };
    const request = locked.view.assignments.find(
      (a) => a.handoverTo?.membershipId === actor.membershipId,
    );
    if (!request) return refused("no_request");
    const camp = await campNotice(tx, input.groupId);
    const ctx = camp ? noticeContext(camp, locked.view) : null;

    if (!input.accept) {
      await tx
        .update(schema.shiftAssignments)
        .set({ handoverToMembershipId: null })
        .where(
          and(
            eq(schema.shiftAssignments.id, request.id),
            eq(schema.shiftAssignments.handoverToMembershipId, actor.membershipId),
          ),
        );
      if (ctx) {
        notices.push(
          toRow(
            request.userId,
            shiftHandoverDeclinedNotification(ctx, actor.displayName),
          ),
        );
      }
      return { ok: true };
    }

    const me = memberFactsFor(locked, actor.membershipId);
    const decision = decideAcceptHandover(locked.facts, me?.facts ?? null);
    if (!decision.ok) {
      if (decision.reason === "needs_role") {
        return {
          ok: false,
          error: locked.view.requiredRoleName
            ? `This shift needs the ${locked.view.requiredRoleName} role.`
            : "This shift needs a camp role you don't hold.",
        };
      }
      if (decision.reason === "clash") {
        return {
          ok: false,
          error: "You're on another shift at that time — hand that one on first.",
        };
      }
      return refused(decision.reason);
    }
    // The spot moves: the same row, now the accepter's. Compare-and-set on the
    // request still being to them.
    const moved = await tx
      .update(schema.shiftAssignments)
      .set({
        membershipId: actor.membershipId,
        handoverToMembershipId: null,
        offeredAt: null,
        assignedByUserId: null,
      })
      .where(
        and(
          eq(schema.shiftAssignments.id, request.id),
          eq(schema.shiftAssignments.handoverToMembershipId, actor.membershipId),
        ),
      )
      .returning({ id: schema.shiftAssignments.id });
    if (!moved[0]) return { ok: false, error: STALE };
    if (ctx) {
      notices.push(
        toRow(
          request.userId,
          shiftHandedOnNotification(ctx, actor.displayName, "accepted"),
        ),
      );
      const leads = shiftChangedHandsNotification(
        ctx,
        request.displayName,
        actor.displayName,
      );
      for (const id of leadRecipients(locked.members, [
        request.userId,
        actor.userId,
      ])) {
        notices.push(toRow(id, leads));
      }
    }
    return { ok: true };
  });
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

/** Take a spot someone offered up. First one wins (the shift row lock). */
export async function takeOfferedShift(input: {
  userId: string;
  groupId: string;
  editionId: string;
  shiftId: string;
  assignmentId: string;
}): Promise<ShiftResult> {
  const notices: NotificationRow[] = [];
  const result = await withTransaction(async (tx): Promise<ShiftResult> => {
    // Their own membership locked before the shift: the clash check (M2).
    const { actor } = await lockParties(tx, input.groupId, input.userId);
    const locked = await lockShift(tx, input.groupId, input.editionId, input.shiftId);
    if (!locked) return { ok: false, error: MISSING };
    const me = actor ? memberFactsFor(locked, actor.membershipId) : null;
    const decision = decideTakeOffered(
      locked.facts,
      input.assignmentId,
      me?.facts ?? null,
    );
    if (!decision.ok) {
      if (decision.reason === "already_on") {
        return { ok: false, error: "You're already on that shift." };
      }
      if (decision.reason === "needs_role") {
        return {
          ok: false,
          error: locked.view.requiredRoleName
            ? `This shift needs the ${locked.view.requiredRoleName} role.`
            : "This shift needs a camp role you don't hold.",
        };
      }
      if (decision.reason === "clash") {
        return {
          ok: false,
          error: "You're on another shift at that time.",
        };
      }
      return refused(decision.reason);
    }
    const from = locked.view.assignments.find((a) => a.id === input.assignmentId)!;
    const moved = await tx
      .update(schema.shiftAssignments)
      .set({
        membershipId: actor!.membershipId,
        offeredAt: null,
        handoverToMembershipId: null,
        assignedByUserId: null,
      })
      .where(
        and(
          eq(schema.shiftAssignments.id, from.id),
          eq(schema.shiftAssignments.shiftId, input.shiftId),
          sql`${schema.shiftAssignments.offeredAt} is not null`,
        ),
      )
      .returning({ id: schema.shiftAssignments.id });
    if (!moved[0]) return refused("not_offered");
    const camp = await campNotice(tx, input.groupId);
    if (camp) {
      const ctx = noticeContext(camp, locked.view);
      notices.push(
        toRow(from.userId, shiftHandedOnNotification(ctx, actor!.displayName, "took")),
      );
      const leads = shiftChangedHandsNotification(
        ctx,
        from.displayName,
        actor!.displayName,
      );
      for (const id of leadRecipients(locked.members, [
        from.userId,
        actor!.userId,
      ])) {
        notices.push(toRow(id, leads));
      }
    }
    return { ok: true };
  });
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

// --- Lead: teams --------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

const TEAM_TAKEN = "The camp already has a team with that name.";

export async function addShiftTeam(input: {
  actorUserId: string;
  groupId: string;
  name: string;
}): Promise<ShiftResult<{ id: string }>> {
  try {
    return await withTransaction(async (tx) => {
      const actor = await lockActor(tx, input.groupId, input.actorUserId);
      if (!mayManage(actor)) return refused("not_manager");
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.shiftTeams)
        .where(eq(schema.shiftTeams.groupId, input.groupId));
      if ((count?.n ?? 0) >= SHIFT_MAX_TEAMS) {
        return { ok: false, error: `A camp can have up to ${SHIFT_MAX_TEAMS} teams.` };
      }
      const [row] = await tx
        .insert(schema.shiftTeams)
        .values({
          groupId: input.groupId,
          name: input.name,
          nameNormalized: normalizeTeamName(input.name),
          sort: count?.n ?? 0,
        })
        .returning({ id: schema.shiftTeams.id });
      // Adding a team is editing the list: a camp whose lead built their own
      // list before opening Shifts must not have the starter list added on top.
      await tx
        .update(schema.groups)
        .set({ shiftTeamsSeededAt: new Date() })
        .where(
          and(
            eq(schema.groups.id, input.groupId),
            isNull(schema.groups.shiftTeamsSeededAt),
          ),
        );
      return { ok: true as const, id: row!.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: TEAM_TAKEN };
    throw err;
  }
}

export async function renameShiftTeam(input: {
  actorUserId: string;
  groupId: string;
  teamId: string;
  name: string;
}): Promise<ShiftResult> {
  try {
    return await withTransaction(async (tx): Promise<ShiftResult> => {
      const actor = await lockActor(tx, input.groupId, input.actorUserId);
      if (!mayManage(actor)) return refused("not_manager");
      const updated = await tx
        .update(schema.shiftTeams)
        .set({ name: input.name, nameNormalized: normalizeTeamName(input.name) })
        .where(
          and(
            eq(schema.shiftTeams.id, input.teamId),
            eq(schema.shiftTeams.groupId, input.groupId),
          ),
        )
        .returning({ id: schema.shiftTeams.id });
      if (!updated[0]) return { ok: false, error: "That team doesn't exist any more." };
      return { ok: true };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: TEAM_TAKEN };
    throw err;
  }
}

/** Remove a team. Its shifts stay, with no team (FK SET NULL). */
export async function removeShiftTeam(input: {
  actorUserId: string;
  groupId: string;
  teamId: string;
}): Promise<ShiftResult> {
  return withTransaction(async (tx): Promise<ShiftResult> => {
    const actor = await lockActor(tx, input.groupId, input.actorUserId);
    if (!mayManage(actor)) return refused("not_manager");
    const removed = await tx
      .delete(schema.shiftTeams)
      .where(
        and(
          eq(schema.shiftTeams.id, input.teamId),
          eq(schema.shiftTeams.groupId, input.groupId),
        ),
      )
      .returning({ id: schema.shiftTeams.id });
    if (!removed[0]) return { ok: false, error: "That team doesn't exist any more." };
    return { ok: true };
  });
}
