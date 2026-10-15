import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { activeMembership } from "@quagga/db";
import {
  buildCampCalendar,
  buildMeetingIcs,
  canEditMeeting,
  canEditMeetingNotes,
  canScheduleAnyMeeting,
  canScheduleMeetings,
  canViewMeeting,
  decideMeetingAudience,
  decideMeetingEdit,
  decideMeetingNotesSave,
  enforceKindPermissions,
  isRetryOfStoredNotes,
  MEETING_AUDIT,
  meetingCancelledNotification,
  meetingIcsFilename,
  meetingMovedNotification,
  meetingPath,
  meetingRefusalMessage,
  meetingScheduledNotification,
  meetingsAvailableForGroup,
  meetingTeamReach,
  meetingTimingChanged,
  meetingUpdateNotices,
  nextMeeting,
  publicMemberName,
  resolveMeetingRecipients,
  splitMeetings,
  teamNamesFor,
  audienceTeamIds,
  type AudienceTeamMember,
  type CalendarDay,
  type MeetingAccessFacts,
  type MeetingNoticeContext,
  type MeetingRefusal,
  type MeetingViewer,
  type NotificationRow,
  type PermissionMembership,
} from "@quagga/core";
import {
  CancelMeetingInput,
  CreateMeetingInput,
  SaveMeetingNotesInput,
  SetMeetingAttendanceInput,
  UpdateMeetingInput,
  type GroupKind,
  type MeetingAudience,
  type MembershipRole,
  type NotificationPayload,
  type OfficerKey,
  type ProjectPermissions,
  type ProjectRoleKind,
} from "@quagga/types";
import { db, schema, withTransaction, type Tx } from "./db";
import { insertNotifications } from "./notifications";

// Camp meetings and calendar (docs/camp-meetings-spec.md). Every rule is a
// pure @quagga/core function (camp-meetings.ts); this file loads the facts
// those functions read — from the database, never from the request — and
// performs the writes.
//
// TEAMS (docs/team-audiences-spec.md). A meeting may be for chosen camp
// teams. Every viewer and every member a decision is made about carries the
// teams they are on; a team lead without `schedule_meetings` schedules and
// edits only for the live teams they lead, read from seats held FOR SHARE.
//
// SCOPING. A request names a camp by slug and a meeting by id. The viewer's
// ACTIVE membership of that camp is resolved first (`loadMeetingsAccess` for
// reads, `lockMeetingActor` inside every write); a non-member gets null from
// every read and "That meeting doesn't exist." from every write. A meeting is
// only ever found by (id, this camp, this edition), and a member outside its
// audience gets exactly what an unknown id gets.
//
// VALIDATION. Every write parses its whole input with the @quagga/types
// schema HERE, so a caller that forgot to validate cannot store a malformed
// meeting.
//
// RACES. Edits, cancels and notes saves are compare-and-set on
// `camp_meetings.version`: the UPDATE matches on the version the editor read,
// and zero rows is "someone else saved first". The actor's membership and
// users row are held `FOR SHARE` for the whole write, so a demotion, an
// archive or an erasure that committed first is what the write sees. "Who
// came" is a set (insert-if-absent / delete), so two note-takers ticking
// different people never conflict.
//
// AUDIT. Scheduling, editing, cancelling and saving notes write an
// `audit_events` row in the same transaction — ids, versions and counts only,
// never a title, a link or a note. Ticking who came is not audited.
//
// NOTICES (kind `meeting`, in-app only) are written AFTER the commit, best
// effort: a failed notice never undoes a change.

export type MeetingResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

/** A failed result carrying the refusal's user-facing sentence. */
function refused(reason: MeetingRefusal): { ok: false; error: string } {
  return { ok: false, error: meetingRefusalMessage(reason) };
}

const INVALID = "That meeting couldn't be saved. Check the form and try again.";

/** The edition meetings belong to (the active one). */
export interface MeetingEdition {
  id: string;
  startDate: string;
  endDate: string;
}

export interface MeetingCamp {
  id: string;
  name: string;
  slug: string;
}

/** One of the camp's roles, for the audience picker and the audience chip. */
export interface MeetingRoleOption {
  id: string;
  name: string;
  kind: ProjectRoleKind;
}

/** One of the camp's teams, for the audience picker and the chip. */
export interface MeetingTeamOption {
  id: string;
  name: string;
  /** Archived teams are never offered for a new pick, but still name the
   * chip of a meeting that was for them. */
  archived: boolean;
}

/** The viewer's standing in one camp, resolved for every meeting read. */
export interface MeetingsAccess {
  camp: MeetingCamp;
  viewer: MeetingViewer & { membership: PermissionMembership };
  baselineRoleId: string | null;
  /** Every role of the camp, baseline included. */
  roles: MeetingRoleOption[];
  /** Every team of the camp, archived included. */
  teams: MeetingTeamOption[];
  /** May open "Schedule a meeting": `schedule_meetings`, or a lead of a live
   * team (docs/team-audiences-spec.md). */
  canSchedule: boolean;
  /** Camp-wide: may pick the whole camp, roles, or any team. False for a team
   * lead without `schedule_meetings`, who may pick only `viewer.ledTeamIds`. */
  canScheduleCampWide: boolean;
}

type Handle = Tx | ReturnType<typeof db>;

/** The group with this slug, any kind, or null. */
async function findCamp(
  slug: string,
): Promise<(MeetingCamp & { kind: GroupKind }) | null> {
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
  return group ?? null;
}

interface CampRoleRow {
  id: string;
  name: string;
  kind: ProjectRoleKind;
  permissions: ProjectPermissions;
  officerKey: string | null;
}

/** Every role of the camp, with its stored permissions. */
async function loadCampRoles(
  handle: Handle,
  groupId: string,
): Promise<CampRoleRow[]> {
  return handle
    .select({
      id: schema.projectRoles.id,
      name: schema.projectRoles.name,
      kind: schema.projectRoles.kind,
      permissions: schema.projectRoles.permissions,
      officerKey: schema.projectRoles.officerKey,
    })
    .from(schema.projectRoles)
    .where(eq(schema.projectRoles.groupId, groupId));
}

/** The role ids a membership holds with ACCEPTED consent. */
async function loadHeldRoleIds(
  handle: Handle,
  membershipId: string,
): Promise<Set<string>> {
  const rows = await handle
    .select({ projectRoleId: schema.memberRoleAssignments.projectRoleId })
    .from(schema.memberRoleAssignments)
    .where(
      and(
        eq(schema.memberRoleAssignments.membershipId, membershipId),
        eq(schema.memberRoleAssignments.consentStatus, "accepted"),
      ),
    );
  return new Set(rows.map((r) => r.projectRoleId));
}

/** The baseline role's permissions plus every held role's, each clamped to
 * what its kind may grant. */
function permissionsFor(
  role: MembershipRole,
  roles: readonly CampRoleRow[],
  held: ReadonlySet<string>,
): PermissionMembership {
  const rolePermissions = roles
    .filter((r) => r.kind === "baseline" || held.has(r.id))
    .map((r) => enforceKindPermissions(r.kind, r.permissions));
  return { structuralRole: role, rolePermissions };
}

/** Every team of the camp, archived included. */
async function loadCampTeams(
  handle: Handle,
  groupId: string,
): Promise<MeetingTeamOption[]> {
  const rows = await handle
    .select({
      id: schema.shiftTeams.id,
      name: schema.shiftTeams.name,
      archivedAt: schema.shiftTeams.archivedAt,
      sort: schema.shiftTeams.sort,
    })
    .from(schema.shiftTeams)
    .where(eq(schema.shiftTeams.groupId, groupId))
    .orderBy(asc(schema.shiftTeams.sort), asc(schema.shiftTeams.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    archived: r.archivedAt !== null,
  }));
}

/**
 * One person's seats on this camp's teams: every team they are on (archived
 * included — a meeting for an archived team stays visible to its members) and
 * the live teams they lead. With `lock`, the seats and their team rows are
 * held `FOR SHARE` for the caller's transaction, as every person-keyed write
 * here holds what it decided on: a lead removed, or a team archived, while a
 * write is in flight waits for it or is what it sees.
 */
async function loadTeamSeats(
  handle: Handle,
  groupId: string,
  userId: string,
  lock: boolean,
): Promise<{ teamIds: Set<string>; ledTeamIds: Set<string> }> {
  const query = handle
    .select({
      teamId: schema.teamMembers.teamId,
      isLead: schema.teamMembers.isLead,
      archivedAt: schema.shiftTeams.archivedAt,
    })
    .from(schema.teamMembers)
    .innerJoin(
      schema.shiftTeams,
      eq(schema.shiftTeams.id, schema.teamMembers.teamId),
    )
    .where(
      and(
        eq(schema.shiftTeams.groupId, groupId),
        eq(schema.teamMembers.userId, userId),
      ),
    );
  const rows = lock
    ? await query.for("share", { of: [schema.shiftTeams, schema.teamMembers] })
    : await query;
  return {
    teamIds: new Set(rows.map((r) => r.teamId)),
    ledTeamIds: new Set(
      rows
        .filter((r) => r.isLead && r.archivedAt === null)
        .map((r) => r.teamId),
    ),
  };
}

/** Every seat on this camp's teams (archived teams included). */
async function loadCampTeamSeats(
  handle: Handle,
  groupId: string,
): Promise<AudienceTeamMember[]> {
  return handle
    .select({
      teamId: schema.teamMembers.teamId,
      groupId: schema.shiftTeams.groupId,
      userId: schema.teamMembers.userId,
    })
    .from(schema.teamMembers)
    .innerJoin(
      schema.shiftTeams,
      eq(schema.shiftTeams.id, schema.teamMembers.teamId),
    )
    .where(eq(schema.shiftTeams.groupId, groupId));
}

/**
 * Every seat on this camp's teams, archived teams included — the schedule
 * form's reach count. A read for the screen; every write re-decides.
 */
export async function listCampTeamSeats(
  groupId: string,
): Promise<AudienceTeamMember[]> {
  return loadCampTeamSeats(db(), groupId);
}

function campFacts(roles: readonly CampRoleRow[]): {
  baselineRoleId: string | null;
  campRoleIds: Set<string>;
} {
  return {
    baselineRoleId: roles.find((r) => r.kind === "baseline")?.id ?? null,
    campRoleIds: new Set(roles.map((r) => r.id)),
  };
}

// --- Access ------------------------------------------------------------------

/**
 * The viewer's standing in a camp's meetings, or null — not a project, not a
 * current member (archived or erased is not a member), or no such camp. Every
 * read below takes the result of this, never a slug on its own.
 */
export async function loadMeetingsAccess(
  slug: string,
  viewerUserId: string,
): Promise<MeetingsAccess | null> {
  const group = await findCamp(slug);
  if (!group || !meetingsAvailableForGroup(group.kind)) return null;
  const [m] = await db()
    .select({ id: schema.memberships.id, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, group.id),
        eq(schema.memberships.userId, viewerUserId),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .limit(1);
  if (!m) return null;
  const [roles, held] = await Promise.all([
    loadCampRoles(db(), group.id),
    loadHeldRoleIds(db(), m.id),
  ]);
  const teams = await loadCampTeams(db(), group.id);
  const seats = await loadTeamSeats(db(), group.id, viewerUserId, false);
  const membership = permissionsFor(m.role, roles, held);
  const viewer = {
    userId: viewerUserId,
    membership,
    heldRoleIds: held,
    teamIds: seats.teamIds,
    ledTeamIds: seats.ledTeamIds,
  };
  return {
    camp: { id: group.id, name: group.name, slug: group.slug },
    viewer,
    baselineRoleId: campFacts(roles).baselineRoleId,
    roles: roles.map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
    teams,
    canSchedule: canScheduleAnyMeeting(viewer),
    canScheduleCampWide: canScheduleMeetings(membership),
  };
}

// --- Reads -------------------------------------------------------------------

const meetingColumns = {
  id: schema.campMeetings.id,
  groupId: schema.campMeetings.groupId,
  title: schema.campMeetings.title,
  date: schema.campMeetings.meetingDate,
  startMinute: schema.campMeetings.startMinute,
  durationMinutes: schema.campMeetings.durationMinutes,
  location: schema.campMeetings.location,
  videoLink: schema.campMeetings.videoLink,
  audience: schema.campMeetings.audience,
  agendaMd: schema.campMeetings.agendaMd,
  notesMd: schema.campMeetings.notesMd,
  version: schema.campMeetings.version,
  cancelledAt: schema.campMeetings.cancelledAt,
  cancelledByUserId: schema.campMeetings.cancelledByUserId,
  notesUpdatedAt: schema.campMeetings.notesUpdatedAt,
  notesUpdatedByUserId: schema.campMeetings.notesUpdatedByUserId,
  createdByUserId: schema.campMeetings.createdByUserId,
};

/** A `camp_meetings` row as every read here selects it. */
interface MeetingRow {
  id: string;
  groupId: string;
  title: string;
  date: string;
  startMinute: number;
  durationMinutes: number;
  location: string | null;
  videoLink: string | null;
  audience: MeetingAudience;
  agendaMd: string;
  notesMd: string;
  version: number;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  notesUpdatedAt: Date | null;
  notesUpdatedByUserId: string | null;
  createdByUserId: string | null;
}

/** Who the meeting's audience is, as the list's chip shows it. */
export interface MeetingAudienceView {
  mode: "everyone" | "roles" | "teams";
  /** The chosen roles' names (roles deleted since are left out). */
  roleNames: string[];
  /** The chosen teams' names (archived kept, deleted left out). */
  teamNames: string[];
}

/** One row of the meetings list (frame G1). */
export interface MeetingListItem {
  id: string;
  title: string;
  date: string;
  startMinute: number;
  durationMinutes: number;
  location: string | null;
  videoLink: string | null;
  audience: MeetingAudienceView;
  cancelledAt: Date | null;
  attendeeCount: number;
  hasNotes: boolean;
}

function accessFacts(row: MeetingRow): MeetingAccessFacts {
  return {
    groupId: row.groupId,
    audience: row.audience,
    createdByUserId: row.createdByUserId,
  };
}

function audienceView(
  audience: MeetingAudience,
  roles: readonly MeetingRoleOption[],
  teams: readonly MeetingTeamOption[],
): MeetingAudienceView {
  if (audience.mode === "everyone") {
    return { mode: "everyone", roleNames: [], teamNames: [] };
  }
  if (audience.mode === "teams") {
    return {
      mode: "teams",
      roleNames: [],
      teamNames: teamNamesFor(audienceTeamIds(audience), teams),
    };
  }
  const byId = new Map(roles.map((r) => [r.id, r.name]));
  return {
    mode: "roles",
    roleNames: audience.roleIds
      .map((id) => byId.get(id))
      .filter((n): n is string => n !== undefined),
    teamNames: [],
  };
}

/** Every meeting of the camp this edition that the viewer may see. */
async function visibleMeetings(
  access: MeetingsAccess,
  edition: MeetingEdition,
): Promise<MeetingRow[]> {
  const rows: MeetingRow[] = await db()
    .select(meetingColumns)
    .from(schema.campMeetings)
    .where(
      and(
        eq(schema.campMeetings.groupId, access.camp.id),
        eq(schema.campMeetings.editionId, edition.id),
      ),
    )
    .orderBy(
      asc(schema.campMeetings.meetingDate),
      asc(schema.campMeetings.startMinute),
    );
  return rows.filter((r) =>
    canViewMeeting(access.viewer, accessFacts(r), access.baselineRoleId),
  );
}

/** Attendee counts per meeting. */
async function attendeeCounts(
  meetingIds: readonly string[],
): Promise<Map<string, number>> {
  if (meetingIds.length === 0) return new Map();
  const rows = await db()
    .select({
      meetingId: schema.campMeetingAttendees.meetingId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.campMeetingAttendees)
    .where(inArray(schema.campMeetingAttendees.meetingId, [...meetingIds]))
    .groupBy(schema.campMeetingAttendees.meetingId);
  return new Map(rows.map((r) => [r.meetingId, r.count]));
}

function toListItem(
  row: MeetingRow,
  access: Pick<MeetingsAccess, "roles" | "teams">,
  counts: ReadonlyMap<string, number>,
): MeetingListItem {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    startMinute: row.startMinute,
    durationMinutes: row.durationMinutes,
    location: row.location,
    videoLink: row.videoLink,
    audience: audienceView(row.audience, access.roles, access.teams),
    cancelledAt: row.cancelledAt,
    attendeeCount: counts.get(row.id) ?? 0,
    hasNotes: row.notesMd.trim().length > 0,
  };
}

/** The meetings list (frame G1): "Upcoming" soonest first, "Past and
 * cancelled" most recent first — only meetings meant for this viewer. */
export async function listCampMeetings(
  access: MeetingsAccess,
  edition: MeetingEdition,
  now: Date,
): Promise<{ upcoming: MeetingListItem[]; past: MeetingListItem[] }> {
  const rows = await visibleMeetings(access, edition);
  const counts = await attendeeCounts(rows.map((r) => r.id));
  const items = rows.map((r) => toListItem(r, access, counts));
  return splitMeetings(items, now);
}

/** The camp page's "Next meeting" line, or null. */
export async function getNextCampMeeting(
  access: MeetingsAccess,
  edition: MeetingEdition,
  now: Date,
): Promise<MeetingListItem | null> {
  const rows = await visibleMeetings(access, edition);
  const next = nextMeeting(rows, now);
  return next ? toListItem(next, access, new Map()) : null;
}

/** A person on the meeting page, by public name only. */
export interface MeetingPerson {
  userId: string;
  name: string;
}

/** The meeting page (frame G2). */
export interface MeetingDetail extends MeetingListItem {
  agendaMd: string;
  notesMd: string;
  version: number;
  /** The stored audience, for the edit form. */
  audienceRoleIds: string[];
  audienceTeamIds: string[];
  createdByName: string | null;
  cancelledByName: string | null;
  notesUpdatedAt: Date | null;
  notesUpdatedByName: string | null;
  canEdit: boolean;
  canEditNotes: boolean;
  /** Who came, by name (a former member who came stays on the record). */
  attendees: MeetingPerson[];
  /** For note-takers only: every current member who can see the meeting,
   * with a tick for those who came. Null for everyone else. */
  tickList: (MeetingPerson & { came: boolean })[] | null;
}

/** A user's public name, or null when the row is gone. */
async function namesOf(
  handle: Handle,
  userIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await handle
    .select({
      id: schema.users.id,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));
  return new Map(
    rows.map((r) => [
      r.id,
      publicMemberName(r.username, { sanitizedAt: r.sanitizedAt }),
    ]),
  );
}

/** A current member of the camp, with what deciding "can they see it" needs. */
interface CampMember {
  membershipId: string;
  userId: string;
  role: MembershipRole;
  name: string;
  sanitized: boolean;
  heldRoleIds: Set<string>;
  /** Every team of the camp they are on (archived included). */
  teamIds: Set<string>;
}

/** The camp's current members, the roles each holds (accepted) and the
 * teams each is on. */
async function loadCampMembers(
  handle: Handle,
  groupId: string,
): Promise<CampMember[]> {
  const [members, assignments] = await Promise.all([
    handle
      .select({
        membershipId: schema.memberships.id,
        userId: schema.memberships.userId,
        role: schema.memberships.role,
        username: schema.users.username,
        sanitizedAt: schema.users.sanitizedAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.groupId, groupId), activeMembership())),
    handle
      .select({
        membershipId: schema.memberRoleAssignments.membershipId,
        projectRoleId: schema.memberRoleAssignments.projectRoleId,
      })
      .from(schema.memberRoleAssignments)
      .innerJoin(
        schema.memberships,
        eq(schema.memberships.id, schema.memberRoleAssignments.membershipId),
      )
      .where(
        and(
          eq(schema.memberships.groupId, groupId),
          activeMembership(),
          eq(schema.memberRoleAssignments.consentStatus, "accepted"),
        ),
      ),
  ]);
  const seats = await loadCampTeamSeats(handle, groupId);
  const teamsOf = new Map<string, Set<string>>();
  for (const seat of seats) {
    const set = teamsOf.get(seat.userId) ?? new Set<string>();
    set.add(seat.teamId);
    teamsOf.set(seat.userId, set);
  }
  const held = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = held.get(a.membershipId) ?? new Set<string>();
    set.add(a.projectRoleId);
    held.set(a.membershipId, set);
  }
  return members.map((m) => ({
    membershipId: m.membershipId,
    userId: m.userId,
    role: m.role,
    name: publicMemberName(m.username, { sanitizedAt: m.sanitizedAt }),
    sanitized: m.sanitizedAt !== null,
    heldRoleIds: held.get(m.membershipId) ?? new Set<string>(),
    teamIds: teamsOf.get(m.userId) ?? new Set<string>(),
  }));
}

/** A camp member as a viewer of a meeting. Only the structural role matters
 * to who SEES a meeting, so no permissions are loaded for them. */
function memberAsViewer(m: CampMember): MeetingViewer {
  return {
    userId: m.userId,
    membership: { structuralRole: m.role, rolePermissions: [] },
    heldRoleIds: m.heldRoleIds,
    teamIds: m.teamIds,
  };
}

/** One meeting by id, scoped to this camp and edition. */
async function meetingById(
  handle: Handle,
  groupId: string,
  editionId: string,
  meetingId: string,
): Promise<MeetingRow | null> {
  const [row] = await handle
    .select(meetingColumns)
    .from(schema.campMeetings)
    .where(
      and(
        eq(schema.campMeetings.id, meetingId),
        eq(schema.campMeetings.groupId, groupId),
        eq(schema.campMeetings.editionId, editionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The meeting page, or null — an unknown id, another camp's or edition's
 * meeting, and a meeting outside the viewer's audience are all the same null
 * (the route's 404).
 */
export async function loadCampMeeting(
  access: MeetingsAccess,
  edition: MeetingEdition,
  meetingId: string,
): Promise<MeetingDetail | null> {
  if (!UUID.test(meetingId)) return null;
  const row = await meetingById(db(), access.camp.id, edition.id, meetingId);
  if (!row) return null;
  const facts = accessFacts(row);
  if (!canViewMeeting(access.viewer, facts, access.baselineRoleId)) return null;
  const canEditNotes = canEditMeetingNotes(
    access.viewer,
    facts,
    access.baselineRoleId,
  );

  const attendeeRows = await db()
    .select({ userId: schema.campMeetingAttendees.userId })
    .from(schema.campMeetingAttendees)
    .where(eq(schema.campMeetingAttendees.meetingId, row.id));
  const names = await namesOf(db(), [
    row.createdByUserId,
    row.cancelledByUserId,
    row.notesUpdatedByUserId,
    ...attendeeRows.map((a) => a.userId),
  ]);
  const attendees = attendeeRows
    .map((a) => ({ userId: a.userId, name: names.get(a.userId) ?? "" }))
    .filter((a) => a.name !== "")
    .sort((a, b) => a.name.localeCompare(b.name));

  let tickList: MeetingDetail["tickList"] = null;
  if (canEditNotes) {
    const came = new Set(attendees.map((a) => a.userId));
    const members = await loadCampMembers(db(), access.camp.id);
    tickList = members
      .filter(
        (m) =>
          !m.sanitized &&
          canViewMeeting(memberAsViewer(m), facts, access.baselineRoleId),
      )
      .map((m) => ({
        userId: m.userId,
        name: m.name,
        came: came.has(m.userId),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return {
    ...toListItem(row, access, new Map([[row.id, attendees.length]])),
    agendaMd: row.agendaMd,
    notesMd: row.notesMd,
    version: row.version,
    audienceRoleIds: row.audience.mode === "roles" ? row.audience.roleIds : [],
    audienceTeamIds: audienceTeamIds(row.audience),
    createdByName: nameOf(row.createdByUserId),
    cancelledByName: nameOf(row.cancelledByUserId),
    notesUpdatedAt: row.notesUpdatedAt,
    notesUpdatedByName: nameOf(row.notesUpdatedByUserId),
    canEdit: canEditMeeting(access.viewer, facts, access.baselineRoleId),
    canEditNotes,
    attendees,
    tickList,
  };
}

/**
 * The camp calendar (frame G4) for this viewer: the edition's build, event
 * and strike days, the meetings meant for them, and their own shifts — never
 * anyone else's.
 */
export async function loadCampCalendar(
  access: MeetingsAccess,
  edition: MeetingEdition,
): Promise<CalendarDay[]> {
  const [meetings, shifts] = await Promise.all([
    visibleMeetings(access, edition),
    db()
      .select({
        id: schema.shifts.id,
        name: schema.shifts.name,
        date: schema.shifts.shiftDate,
        startMinute: schema.shifts.startMinute,
        durationMinutes: schema.shifts.durationMinutes,
      })
      .from(schema.shifts)
      .innerJoin(
        schema.shiftAssignments,
        eq(schema.shiftAssignments.shiftId, schema.shifts.id),
      )
      .innerJoin(
        schema.memberships,
        eq(schema.memberships.id, schema.shiftAssignments.membershipId),
      )
      .where(
        and(
          eq(schema.shifts.groupId, access.camp.id),
          eq(schema.shifts.editionId, edition.id),
          eq(schema.memberships.groupId, access.camp.id),
          eq(schema.memberships.userId, access.viewer.userId),
          activeMembership(),
        ),
      ),
  ]);
  return buildCampCalendar({
    edition: { startDate: edition.startDate, endDate: edition.endDate },
    meetings: meetings.map((m) => ({
      id: m.id,
      title: m.title,
      date: m.date,
      startMinute: m.startMinute,
      durationMinutes: m.durationMinutes,
      cancelledAt: m.cancelledAt,
    })),
    shifts,
  });
}

/**
 * "Add to my calendar": the meeting as an .ics file, or null — not visible to
 * the viewer, cancelled (frame G2: no calendar file for a cancelled meeting),
 * or an unusable date. `origin` is the app's own origin (`https://host`).
 */
export async function buildCampMeetingIcs(
  access: MeetingsAccess,
  edition: MeetingEdition,
  meetingId: string,
  opts: { now: Date; origin: string },
): Promise<{ filename: string; body: string } | null> {
  if (!UUID.test(meetingId)) return null;
  const row = await meetingById(db(), access.camp.id, edition.id, meetingId);
  if (!row || row.cancelledAt !== null) return null;
  if (!canViewMeeting(access.viewer, accessFacts(row), access.baselineRoleId)) {
    return null;
  }
  let host: string | null = null;
  try {
    const url = new URL(opts.origin);
    if (url.protocol === "https:" || url.protocol === "http:") host = url.host;
  } catch {
    host = null;
  }
  const body = buildMeetingIcs({
    meetingId: row.id,
    version: row.version,
    title: row.title,
    campName: access.camp.name,
    date: row.date,
    startMinute: row.startMinute,
    durationMinutes: row.durationMinutes,
    location: row.location,
    videoLink: row.videoLink,
    pageUrl: host
      ? `${new URL(opts.origin).origin}${meetingPath(access.camp.slug, row.id)}`
      : null,
    uidDomain: host ?? "contributors.afrikaburn.invalid",
    now: opts.now,
  });
  if (body === null) return null;
  return { filename: meetingIcsFilename(row.title, row.date), body };
}

// --- Writes ------------------------------------------------------------------

interface MeetingActor {
  userId: string;
  name: string;
  viewer: MeetingViewer & { membership: PermissionMembership };
  baselineRoleId: string | null;
  campRoleIds: Set<string>;
  /** This camp's teams that are not archived. */
  liveTeamIds: Set<string>;
}

/**
 * The caller's ACTIVE membership of this camp, held `FOR SHARE` with their
 * users row — so an archive, a demotion or an account erasure that committed
 * first is what this sees — with their roles and permissions as of now. Null
 * when not a current member, erased, or the group has no meetings.
 */
async function lockMeetingActor(
  tx: Tx,
  groupId: string,
  userId: string,
): Promise<MeetingActor | null> {
  const [row] = await tx
    .select({
      membershipId: schema.memberships.id,
      role: schema.memberships.role,
      username: schema.users.username,
      groupKind: schema.groups.kind,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        eq(schema.memberships.userId, userId),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .limit(1)
    .for("share", { of: [schema.memberships, schema.users] });
  if (!row || !meetingsAvailableForGroup(row.groupKind)) return null;
  const [roles, held] = await Promise.all([
    loadCampRoles(tx, groupId),
    loadHeldRoleIds(tx, row.membershipId),
  ]);
  // After the membership lock, as in camp-teams-store.ts: team row, then seat.
  const seats = await loadTeamSeats(tx, groupId, userId, true);
  const teams = await loadCampTeams(tx, groupId);
  const { baselineRoleId, campRoleIds } = campFacts(roles);
  return {
    userId,
    name: publicMemberName(row.username),
    viewer: {
      userId,
      membership: permissionsFor(row.role, roles, held),
      heldRoleIds: held,
      teamIds: seats.teamIds,
      ledTeamIds: seats.ledTeamIds,
    },
    baselineRoleId,
    campRoleIds,
    liveTeamIds: new Set(teams.filter((t) => !t.archived).map((t) => t.id)),
  };
}

/** The meeting row, locked `FOR UPDATE`, scoped to this camp and edition. */
async function lockMeeting(
  tx: Tx,
  groupId: string,
  editionId: string,
  meetingId: string,
): Promise<MeetingRow | null> {
  const [row] = await tx
    .select(meetingColumns)
    .from(schema.campMeetings)
    .where(
      and(
        eq(schema.campMeetings.id, meetingId),
        eq(schema.campMeetings.groupId, groupId),
        eq(schema.campMeetings.editionId, editionId),
      ),
    )
    .limit(1)
    .for("update");
  return row ?? null;
}

/** Writes one meeting `audit_events` row in the caller's transaction. `meta`
 * holds ids, versions and counts only. */
async function audit(
  tx: Tx,
  actorId: string,
  action: string,
  meetingId: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await tx.insert(schema.auditEvents).values({
    actorId,
    action,
    subject: meetingId,
    meta: { meetingId, ...meta },
  });
}

/** Who a notice about this meeting goes to, read in the write's
 * transaction: current members who can see it (the audience, plus the leads
 * and whoever scheduled it), never the actor, never an erased account. */
async function recipientsFor(
  tx: Tx,
  groupId: string,
  meeting: Pick<MeetingAccessFacts, "audience" | "createdByUserId">,
  actorUserId: string,
): Promise<string[]> {
  const [members, roles] = await Promise.all([
    loadCampMembers(tx, groupId),
    loadCampRoles(tx, groupId),
  ]);
  // Seats of current members only (the resolver narrows to them regardless).
  const teamMembers: AudienceTeamMember[] = members.flatMap((m) =>
    [...m.teamIds].map((teamId) => ({ teamId, groupId, userId: m.userId })),
  );
  return resolveMeetingRecipients(
    meeting,
    {
      groupId,
      memberships: members.map((m) => ({
        membershipId: m.membershipId,
        userId: m.userId,
        groupId,
        role: m.role,
      })),
      roleAssignments: members.flatMap((m) =>
        [...m.heldRoleIds].map((projectRoleId) => ({
          membershipId: m.membershipId,
          projectRoleId,
        })),
      ),
      projectRoles: roles.map((r) => ({
        id: r.id,
        groupId,
        kind: r.kind,
        officerKey: (r.officerKey as OfficerKey | null) ?? null,
      })),
      teamMembers,
      excludedUserIds: new Set(
        members.filter((m) => m.sanitized).map((m) => m.userId),
      ),
    },
    actorUserId,
  );
}

function noticeContext(
  camp: MeetingCamp,
  meeting: {
    id: string;
    title: string;
    date: string;
    startMinute: number;
    durationMinutes: number;
  },
): MeetingNoticeContext {
  return {
    campName: camp.name,
    campSlug: camp.slug,
    meetingId: meeting.id,
    title: meeting.title,
    date: meeting.date,
    startMinute: meeting.startMinute,
    durationMinutes: meeting.durationMinutes,
  };
}

function toRows(
  userIds: readonly string[],
  payload: NotificationPayload,
): NotificationRow[] {
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
    console.error("[notifications] meeting notice failed", err);
  }
}

/** Shared front half of every write: find the camp, open the transaction,
 * lock the actor. Notices the callback queues go out after the commit. */
async function withMeetingWrite<T>(
  slug: string,
  viewerUserId: string,
  fn: (
    tx: Tx,
    ctx: { camp: MeetingCamp; actor: MeetingActor; notices: NotificationRow[] },
  ) => Promise<MeetingResult<T>>,
): Promise<MeetingResult<T>> {
  const camp = await findCamp(slug);
  if (!camp || !meetingsAvailableForGroup(camp.kind)) {
    return refused("not_found");
  }
  const notices: NotificationRow[] = [];
  const result = await withTransaction(async (tx) => {
    const actor = await lockMeetingActor(tx, camp.id, viewerUserId);
    if (!actor) return refused("not_found");
    return fn(tx, {
      camp: { id: camp.id, name: camp.name, slug: camp.slug },
      actor,
      notices,
    });
  });
  if (result.ok) await notifyAfterCommit(notices);
  return result;
}

/** Schedule a meeting; the people it is for are told. */
export async function createCampMeeting(
  viewerUserId: string,
  edition: MeetingEdition,
  raw: unknown,
): Promise<MeetingResult<{ id: string; version: number }>> {
  const parsed = CreateMeetingInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withMeetingWrite(
    input.slug,
    viewerUserId,
    async (tx, { camp, actor, notices }) => {
      // `schedule_meetings`, or a team lead — for the teams they lead only,
      // which decideMeetingAudience enforces against the seats locked above.
      if (!canScheduleAnyMeeting(actor.viewer)) {
        return refused("not_scheduler");
      }
      const audience = decideMeetingAudience(
        { mode: input.mode, roleIds: input.roleIds, teamIds: input.teamIds },
        { groupId: camp.id, ...actorCamp(actor) },
        meetingTeamReach(actor.viewer),
      );
      if (!audience.ok) return refused(audience.reason);
      const [row] = await tx
        .insert(schema.campMeetings)
        .values({
          groupId: camp.id,
          editionId: edition.id,
          title: input.title,
          meetingDate: input.date,
          startMinute: input.startMinute,
          durationMinutes: input.durationMinutes,
          location: input.location,
          videoLink: input.videoLink,
          audience: audience.audience,
          agendaMd: input.agendaMd,
          version: 1,
          createdByUserId: viewerUserId,
          updatedByUserId: viewerUserId,
        })
        .returning({ id: schema.campMeetings.id });
      if (!row) return { ok: false, error: INVALID };
      await audit(tx, viewerUserId, MEETING_AUDIT.create, row.id, {
        groupId: camp.id,
        editionId: edition.id,
        audience: audience.audience.mode,
        roles: audience.audience.roleIds.length,
        teams: audienceTeamIds(audience.audience).length,
      });
      const recipients = await recipientsFor(
        tx,
        camp.id,
        { audience: audience.audience, createdByUserId: viewerUserId },
        viewerUserId,
      );
      notices.push(
        ...toRows(
          recipients,
          meetingScheduledNotification(
            noticeContext(camp, { ...input, id: row.id }),
            actor.name,
          ),
        ),
      );
      return { ok: true, id: row.id, version: 1 };
    },
  );
}

function actorCamp(
  actor: MeetingActor,
  stored?: MeetingAudience,
): {
  campRoleIds: Set<string>;
  baselineRoleId: string | null;
  teams: { liveTeamIds: Set<string>; keepTeamIds: Set<string> };
} {
  return {
    campRoleIds: actor.campRoleIds,
    baselineRoleId: actor.baselineRoleId,
    teams: {
      liveTeamIds: actor.liveTeamIds,
      // On an edit, the teams already chosen stay valid even if archived.
      keepTeamIds: new Set(stored ? audienceTeamIds(stored) : []),
    },
  };
}

/** Edit a meeting's details: compare-and-set on the version. People newly in
 * the audience are told it was scheduled; people already in it are told it
 * moved, when the day, time or length changed. */
export async function updateCampMeeting(
  viewerUserId: string,
  edition: MeetingEdition,
  raw: unknown,
): Promise<MeetingResult<{ version: number }>> {
  const parsed = UpdateMeetingInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withMeetingWrite(
    input.slug,
    viewerUserId,
    async (tx, { camp, actor, notices }) => {
      const current = await lockMeeting(tx, camp.id, edition.id, input.id);
      if (!current) return refused("not_found");
      const facts = accessFacts(current);
      const refusal = decideMeetingEdit({
        canView: canViewMeeting(actor.viewer, facts, actor.baselineRoleId),
        canEdit: canEditMeeting(actor.viewer, facts, actor.baselineRoleId),
        cancelled: current.cancelledAt !== null,
        currentVersion: current.version,
        expectedVersion: input.expectedVersion,
      });
      if (refusal) return refused(refusal);
      // A team lead's edit stays within their teams: canEditMeeting held the
      // stored audience to that, and the reach here holds the new one to it.
      const audience = decideMeetingAudience(
        { mode: input.mode, roleIds: input.roleIds, teamIds: input.teamIds },
        { groupId: camp.id, ...actorCamp(actor, current.audience) },
        meetingTeamReach(actor.viewer),
      );
      if (!audience.ok) return refused(audience.reason);

      const before = await recipientsFor(tx, camp.id, current, viewerUserId);
      const updated = await tx
        .update(schema.campMeetings)
        .set({
          title: input.title,
          meetingDate: input.date,
          startMinute: input.startMinute,
          durationMinutes: input.durationMinutes,
          location: input.location,
          videoLink: input.videoLink,
          audience: audience.audience,
          agendaMd: input.agendaMd,
          version: input.expectedVersion + 1,
          updatedByUserId: viewerUserId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.campMeetings.id, current.id),
            eq(schema.campMeetings.version, input.expectedVersion),
          ),
        )
        .returning({ version: schema.campMeetings.version });
      if (updated.length === 0) return refused("stale");

      const timingChanged = meetingTimingChanged(current, input);
      await audit(tx, viewerUserId, MEETING_AUDIT.update, current.id, {
        groupId: camp.id,
        version: input.expectedVersion + 1,
        timingChanged,
        audience: audience.audience.mode,
        roles: audience.audience.roleIds.length,
        teams: audienceTeamIds(audience.audience).length,
      });
      const after = await recipientsFor(
        tx,
        camp.id,
        {
          audience: audience.audience,
          createdByUserId: current.createdByUserId,
        },
        viewerUserId,
      );
      const told = meetingUpdateNotices({ before, after, timingChanged });
      const was = noticeContext(camp, current);
      const now = noticeContext(camp, { ...input, id: current.id });
      notices.push(
        ...toRows(
          told.scheduled,
          meetingScheduledNotification(now, actor.name),
        ),
        ...toRows(told.moved, meetingMovedNotification(was, now, actor.name)),
      );
      return { ok: true, version: input.expectedVersion + 1 };
    },
  );
}

/** Cancel a meeting. It stays readable with its agenda and notes; the people
 * it was for are told. */
export async function cancelCampMeeting(
  viewerUserId: string,
  edition: MeetingEdition,
  raw: unknown,
): Promise<MeetingResult<{ version: number }>> {
  const parsed = CancelMeetingInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withMeetingWrite(
    input.slug,
    viewerUserId,
    async (tx, { camp, actor, notices }) => {
      const current = await lockMeeting(tx, camp.id, edition.id, input.id);
      if (!current) return refused("not_found");
      const facts = accessFacts(current);
      const refusal = decideMeetingEdit({
        canView: canViewMeeting(actor.viewer, facts, actor.baselineRoleId),
        canEdit: canEditMeeting(actor.viewer, facts, actor.baselineRoleId),
        cancelled: current.cancelledAt !== null,
        currentVersion: current.version,
        expectedVersion: input.expectedVersion,
      });
      if (refusal) return refused(refusal);
      const now = new Date();
      const updated = await tx
        .update(schema.campMeetings)
        .set({
          cancelledAt: now,
          cancelledByUserId: viewerUserId,
          version: input.expectedVersion + 1,
          updatedByUserId: viewerUserId,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.campMeetings.id, current.id),
            eq(schema.campMeetings.version, input.expectedVersion),
            isNull(schema.campMeetings.cancelledAt),
          ),
        )
        .returning({ version: schema.campMeetings.version });
      if (updated.length === 0) return refused("stale");
      await audit(tx, viewerUserId, MEETING_AUDIT.cancel, current.id, {
        groupId: camp.id,
        version: input.expectedVersion + 1,
      });
      const recipients = await recipientsFor(
        tx,
        camp.id,
        current,
        viewerUserId,
      );
      notices.push(
        ...toRows(
          recipients,
          meetingCancelledNotification(
            noticeContext(camp, current),
            actor.name,
          ),
        ),
      );
      return { ok: true, version: input.expectedVersion + 1 };
    },
  );
}

/** Save the notes: compare-and-set on the version. Notifies nobody. */
export async function saveCampMeetingNotes(
  viewerUserId: string,
  edition: MeetingEdition,
  raw: unknown,
): Promise<MeetingResult<{ version: number }>> {
  const parsed = SaveMeetingNotesInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withMeetingWrite(
    input.slug,
    viewerUserId,
    async (tx, { camp, actor }) => {
      const current = await lockMeeting(tx, camp.id, edition.id, input.id);
      if (!current) return refused("not_found");
      const facts = accessFacts(current);
      const canView = canViewMeeting(actor.viewer, facts, actor.baselineRoleId);
      const canEditNotes = canEditMeetingNotes(
        actor.viewer,
        facts,
        actor.baselineRoleId,
      );
      const refusal = decideMeetingNotesSave({
        canView,
        canEditNotes,
        currentVersion: current.version,
        expectedVersion: input.expectedVersion,
      });
      // The retry of a save that committed but whose response was lost.
      if (
        refusal === "stale" &&
        isRetryOfStoredNotes({
          currentVersion: current.version,
          expectedVersion: input.expectedVersion,
          storedNotes: current.notesMd,
          sentNotes: input.notesMd,
          notesUpdatedByUserId: current.notesUpdatedByUserId,
          actorUserId: viewerUserId,
        })
      ) {
        return { ok: true, version: current.version };
      }
      if (refusal) return refused(refusal);
      const now = new Date();
      const updated = await tx
        .update(schema.campMeetings)
        .set({
          notesMd: input.notesMd,
          notesUpdatedAt: now,
          notesUpdatedByUserId: viewerUserId,
          version: input.expectedVersion + 1,
        })
        .where(
          and(
            eq(schema.campMeetings.id, current.id),
            eq(schema.campMeetings.version, input.expectedVersion),
          ),
        )
        .returning({ version: schema.campMeetings.version });
      if (updated.length === 0) return refused("stale");
      await audit(tx, viewerUserId, MEETING_AUDIT.notes, current.id, {
        groupId: camp.id,
        version: input.expectedVersion + 1,
      });
      return { ok: true, version: input.expectedVersion + 1 };
    },
  );
}

/**
 * Tick or untick one person on "Who came". Only note-takers; only a current
 * member who can see the meeting can be ticked; a cancelled meeting gets no
 * new ticks (nobody came to it). Unticking always works, so a mistake can be
 * undone. Idempotent both ways.
 */
export async function setCampMeetingAttendance(
  viewerUserId: string,
  edition: MeetingEdition,
  raw: unknown,
): Promise<MeetingResult> {
  const parsed = SetMeetingAttendanceInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withMeetingWrite(
    input.slug,
    viewerUserId,
    async (tx, { camp, actor }) => {
      const current = await lockMeeting(tx, camp.id, edition.id, input.id);
      if (!current) return refused("not_found");
      const facts = accessFacts(current);
      if (!canViewMeeting(actor.viewer, facts, actor.baselineRoleId)) {
        return refused("not_found");
      }
      if (!canEditMeetingNotes(actor.viewer, facts, actor.baselineRoleId)) {
        return refused("not_note_taker");
      }
      if (!input.came) {
        await tx
          .delete(schema.campMeetingAttendees)
          .where(
            and(
              eq(schema.campMeetingAttendees.meetingId, current.id),
              eq(schema.campMeetingAttendees.userId, input.userId),
            ),
          );
        return { ok: true };
      }
      if (current.cancelledAt !== null) return refused("cancelled");
      // Hold the ticked person's membership and account rows FOR SHARE, as
      // account-sanitize.ts expects of every writer keyed by a person: an
      // erasure in flight holds `users` FOR UPDATE, so this waits for it and
      // then reads `sanitized_at` set, instead of inserting a tick its step 2g
      // has already cleared from a snapshot taken before it.
      const [locked] = await tx
        .select({ sanitizedAt: schema.users.sanitizedAt })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(
          and(
            eq(schema.memberships.groupId, camp.id),
            eq(schema.memberships.userId, input.userId),
            activeMembership(),
          ),
        )
        .limit(1)
        .for("share", { of: [schema.memberships, schema.users] });
      if (!locked || locked.sanitizedAt !== null) {
        return refused("not_attendee");
      }
      const members = await loadCampMembers(tx, camp.id);
      const target = members.find(
        (m) => m.userId === input.userId && !m.sanitized,
      );
      if (
        !target ||
        !canViewMeeting(memberAsViewer(target), facts, actor.baselineRoleId)
      ) {
        return refused("not_attendee");
      }
      await tx
        .insert(schema.campMeetingAttendees)
        .values({
          meetingId: current.id,
          userId: input.userId,
          markedByUserId: viewerUserId,
        })
        .onConflictDoNothing();
      return { ok: true };
    },
  );
}
