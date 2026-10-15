// Camp meetings and calendar (docs/camp-meetings-spec.md). PURE — no I/O, no
// env, no DB. The store (apps/web/lib/camp-meetings-store.ts) loads every fact
// these functions read from the database; a request names a camp by slug and
// a meeting by id, and nothing else.
//
// WHO SEES A MEETING. Non-members get the camp's 404 before anything here is
// asked. A current member sees a meeting when it is meant for them — the whole
// camp, or a camp role they hold (an ACCEPTED assignment) — and the camp's
// structural leads and co-leads see every meeting (frames G1/G2: "A meeting
// for chosen roles shows only to people in those roles and the camp's
// leads"). Whoever scheduled a meeting also keeps seeing it. Everyone else
// gets the meeting's 404, the same answer an id that does not exist gets.
//
// TEAMS (docs/team-audiences-spec.md). A meeting may be for chosen camp
// teams: its members see it (an archived team still counts; a deleted one
// reaches nobody), plus the leads and whoever scheduled it, as for roles. A
// TEAM LEAD without `schedule_meetings` may schedule, edit, move and cancel
// meetings for the teams they lead — and only those: the audience before AND
// after an edit must be within their teams.
//
// WHO SCHEDULES. Leads and co-leads (the irrevocable backstop) and members
// holding `schedule_meetings`. They edit, move and cancel any meeting they can
// see, and write its notes and "who came". The member who scheduled a meeting
// may still write its notes after losing the privilege, while they are a
// member who can see it.
//
// TIME has no zone, like shifts: a date, minutes after midnight and a length,
// shown exactly as typed. Two places need a real instant, and both read the
// typed time as SOUTH AFRICAN time (SAST, UTC+02:00 all year — South Africa
// has had no daylight saving since 1944):
//   · the upcoming/past split, which compares against "now";
//   · the .ics file. It uses `TZID=Africa/Johannesburg` with the zone's
//     definition embedded (one STANDARD block, +0200, no DST rules), which
//     RFC 5545 §3.6.5 requires whenever a TZID is named. A FLOATING time was
//     rejected: a camp has members flying in from Europe, and a floating
//     19:00 lands at 19:00 in whatever zone their phone is in. A bare UTC
//     time (`Z`) would be exact too, but calendar apps then show and edit the
//     event in the reader's zone; the named zone keeps "19:00 SAST" visible.
//
// PRIVACY. A meeting carries no personal data beyond the names of who
// scheduled it, who wrote the notes and who came. Notices carry the camp's
// name, the meeting's title and its time — never a link, a place or a note.

import type {
  MeetingAudience,
  NotificationPayload,
  GroupKind,
} from "@quagga/types";
import { isProjectKind } from "@quagga/types";
import {
  hasProjectPermission,
  isPermissionBackstop,
  type PermissionMembership,
} from "./project-permissions";
import {
  resolveCampAnnouncementRecipients,
  type CampAnnouncementAudienceContext,
} from "./announcements";
import {
  audienceTeamIds,
  decideTeamAudienceTargets,
  hasCampWideMeetingReach,
  teamsWithinReach,
  type TeamAudienceReach,
} from "./team-audience";
import {
  formatClock,
  formatShiftTime,
  isoDateToMs,
  shiftDateLabel,
  shiftDays,
  shiftInterval,
  type ShiftPhase,
} from "./shifts";

// --- Constants -------------------------------------------------------------

/** Audit action names (written in the same transaction as the change). */
export const MEETING_AUDIT = {
  create: "camp.meeting.create",
  update: "camp.meeting.update",
  cancel: "camp.meeting.cancel",
  notes: "camp.meeting.notes",
} as const;

/** South African Standard Time, UTC+02:00, all year (no DST). */
export const SAST_OFFSET_MINUTES = 120;
/** The IANA zone the .ics file names. */
export const MEETING_TZID = "Africa/Johannesburg";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

// --- Access ----------------------------------------------------------------

/** Meetings belong to any project (theme camp, artwork, mutant vehicle),
 * never to the org group. */
export function meetingsAvailableForGroup(kind: GroupKind): boolean {
  return isProjectKind(kind);
}

/** Leads and co-leads (the backstop) or a `schedule_meetings` grant. `null`
 * is "not a current member", which is always no. */
export function canScheduleMeetings(
  membership: PermissionMembership | null,
): boolean {
  return (
    membership !== null && hasProjectPermission(membership, "schedule_meetings")
  );
}

/** The viewer, as the store resolved them for ONE camp. */
export interface MeetingViewer {
  userId: string;
  /** Null: not a current member (archived, erased or never joined). */
  membership: PermissionMembership | null;
  /** The camp role ids this member holds with ACCEPTED consent. The baseline
   * role need not be listed: everyone holds it. */
  heldRoleIds: ReadonlySet<string>;
  /** Every team of this camp the viewer is on (archived teams included).
   * Absent = none. */
  teamIds?: ReadonlySet<string>;
  /** The live teams of this camp the viewer leads. Absent = none. */
  ledTeamIds?: ReadonlySet<string>;
}

/** What access is decided on, read from the stored meeting row. */
export interface MeetingAccessFacts {
  groupId: string;
  audience: MeetingAudience;
  createdByUserId: string | null;
}

/**
 * Is a member with these roles (and teams) in the meeting's audience? The
 * whole camp, any one of the chosen roles, or any one of the chosen teams.
 * Naming the baseline role is naming everyone (the shared audience resolver
 * says the same). An empty role or team list reaches nobody.
 */
export function isInMeetingAudience(
  audience: MeetingAudience,
  heldRoleIds: ReadonlySet<string>,
  baselineRoleId: string | null,
  teamIds: ReadonlySet<string> = new Set<string>(),
): boolean {
  if (audience.mode === "everyone") return true;
  if (audience.mode === "teams") {
    return audienceTeamIds(audience).some((id) => teamIds.has(id));
  }
  return audience.roleIds.some(
    (id) => id === baselineRoleId || heldRoleIds.has(id),
  );
}

/**
 * May this viewer see this meeting at all — its time, link, agenda and notes?
 * Fails closed: a meeting whose stored audience is not a project audience for
 * its own camp is seen by nobody (the DB CHECK makes that impossible; this
 * does not rely on it).
 */
export function canViewMeeting(
  viewer: MeetingViewer,
  meeting: MeetingAccessFacts,
  baselineRoleId: string | null,
): boolean {
  if (viewer.membership === null) return false;
  if (
    meeting.audience.kind !== "project" ||
    meeting.audience.groupId !== meeting.groupId
  ) {
    return false;
  }
  if (isPermissionBackstop(viewer.membership.structuralRole)) return true;
  if (
    meeting.createdByUserId !== null &&
    meeting.createdByUserId === viewer.userId
  ) {
    return true;
  }
  return isInMeetingAudience(
    meeting.audience,
    viewer.heldRoleIds,
    baselineRoleId,
    viewer.teamIds,
  );
}

/** What this viewer may address by team: any team with `schedule_meetings`
 * (or as a lead), else only the live teams they lead. */
export function meetingTeamReach(viewer: MeetingViewer): TeamAudienceReach {
  return {
    campWide:
      viewer.membership !== null && hasCampWideMeetingReach(viewer.membership),
    ledTeamIds: viewer.ledTeamIds ?? new Set<string>(),
  };
}

/**
 * May this viewer open "Schedule a meeting" at all? A scheduler, or a team
 * lead of at least one live team (who then picks only their teams).
 */
export function canScheduleAnyMeeting(viewer: MeetingViewer): boolean {
  if (viewer.membership === null) return false;
  if (canScheduleMeetings(viewer.membership)) return true;
  return (viewer.ledTeamIds?.size ?? 0) > 0;
}

/**
 * A team lead's hold over THIS meeting: it is for teams, and every one of
 * them is a live team they lead now. Never true for a whole-camp or by-role
 * meeting.
 */
function teamLeadCoversMeeting(
  viewer: MeetingViewer,
  meeting: MeetingAccessFacts,
): boolean {
  if (meeting.audience.mode !== "teams") return false;
  return teamsWithinReach(audienceTeamIds(meeting.audience), {
    campWide: false,
    ledTeamIds: viewer.ledTeamIds ?? new Set<string>(),
  });
}

/** Edit the details, move or cancel: someone who sees the meeting AND may
 * schedule meetings now — or a team lead, on a meeting for their teams. */
export function canEditMeeting(
  viewer: MeetingViewer,
  meeting: MeetingAccessFacts,
  baselineRoleId: string | null,
): boolean {
  if (!canViewMeeting(viewer, meeting, baselineRoleId)) return false;
  return (
    canScheduleMeetings(viewer.membership) ||
    teamLeadCoversMeeting(viewer, meeting)
  );
}

/** Write the notes and tick who came: a scheduler who sees the meeting, a
 * team lead on a meeting for their teams, or the member who scheduled it. */
export function canEditMeetingNotes(
  viewer: MeetingViewer,
  meeting: MeetingAccessFacts,
  baselineRoleId: string | null,
): boolean {
  if (!canViewMeeting(viewer, meeting, baselineRoleId)) return false;
  if (canScheduleMeetings(viewer.membership)) return true;
  if (teamLeadCoversMeeting(viewer, meeting)) return true;
  return (
    meeting.createdByUserId !== null &&
    meeting.createdByUserId === viewer.userId
  );
}

// --- Audience on a write ---------------------------------------------------

export type MeetingAudienceDecision =
  | { ok: true; audience: MeetingAudience }
  | {
      ok: false;
      reason:
        | "no_roles"
        | "unknown_role"
        | "no_teams"
        | "unknown_team"
        | "not_your_team"
        | "not_scheduler";
    };

/** The camp's teams, as a meeting audience decision reads them. */
export interface MeetingTeamFacts {
  /** This camp's teams that are not archived. */
  liveTeamIds: ReadonlySet<string>;
  /** On an edit: the teams already on the stored audience, kept acceptable
   * even if archived since. */
  keepTeamIds?: ReadonlySet<string>;
}

/**
 * Turn the form's "who it's for" into the stored audience for THIS camp.
 * By-role needs at least one role, and every role must be one of this camp's
 * (a role from another camp is refused, never silently resolved to nobody).
 * Naming the baseline role is stored as the whole camp. Duplicates go.
 *
 * By-team (docs/team-audiences-spec.md) needs at least one of the camp's live
 * teams; a scheduler without camp-wide reach (a team lead) may name only the
 * teams they lead, and may not pick the whole camp or roles at all. `reach`
 * absent is camp-wide — the caller has already checked `schedule_meetings`.
 */
export function decideMeetingAudience(
  input: {
    mode: "everyone" | "roles" | "teams";
    roleIds: readonly string[];
    teamIds?: readonly string[];
  },
  camp: {
    groupId: string;
    campRoleIds: ReadonlySet<string>;
    baselineRoleId: string | null;
    teams?: MeetingTeamFacts;
  },
  reach: TeamAudienceReach = { campWide: true, ledTeamIds: new Set() },
): MeetingAudienceDecision {
  const everyone: MeetingAudience = {
    kind: "project",
    groupId: camp.groupId,
    mode: "everyone",
    roleIds: [],
  };
  if (input.mode === "teams") {
    const decided = decideTeamAudienceTargets(
      input.teamIds ?? [],
      camp.teams ?? { liveTeamIds: new Set<string>() },
      reach,
    );
    if (!decided.ok) return decided;
    return {
      ok: true,
      audience: {
        kind: "project",
        groupId: camp.groupId,
        mode: "teams",
        roleIds: [],
        teamIds: decided.teamIds,
      },
    };
  }
  // The whole camp and chosen roles need camp-wide reach.
  if (!reach.campWide) return { ok: false, reason: "not_scheduler" };
  if (input.mode === "everyone") return { ok: true, audience: everyone };
  const roleIds = [...new Set(input.roleIds)];
  if (roleIds.length === 0) return { ok: false, reason: "no_roles" };
  if (!roleIds.every((id) => camp.campRoleIds.has(id))) {
    return { ok: false, reason: "unknown_role" };
  }
  if (camp.baselineRoleId !== null && roleIds.includes(camp.baselineRoleId)) {
    return { ok: true, audience: everyone };
  }
  return {
    ok: true,
    audience: {
      kind: "project",
      groupId: camp.groupId,
      mode: "roles",
      roleIds: roleIds.sort(),
    },
  };
}

/**
 * The people a meeting notice goes to: everyone who can see the meeting
 * (canViewMeeting) among this camp's current members — the audience the
 * announcements resolver gives for the same roles or teams, plus, for a
 * chosen-roles or chosen-teams meeting, the camp's leads and co-leads and whoever scheduled it — never the
 * person who made the change, never an erased account. Sorted, de-duplicated.
 */
export function resolveMeetingRecipients(
  meeting: Pick<MeetingAccessFacts, "audience" | "createdByUserId">,
  ctx: CampAnnouncementAudienceContext,
  actorUserId: string | null,
): string[] {
  const { audience } = meeting;
  if (audience.kind !== "project" || audience.groupId !== ctx.groupId) {
    return [];
  }
  const ids = new Set(resolveCampAnnouncementRecipients(audience, ctx, null));
  if (audience.mode !== "everyone") {
    for (const m of ctx.memberships) {
      if (m.groupId !== ctx.groupId) continue;
      if (
        isPermissionBackstop(m.role) ||
        (meeting.createdByUserId !== null &&
          m.userId === meeting.createdByUserId)
      ) {
        ids.add(m.userId);
      }
    }
  }
  return [...ids]
    .filter(
      (id) => id !== actorUserId && !(ctx.excludedUserIds?.has(id) ?? false),
    )
    .sort();
}

/**
 * Who hears about an edit. People newly in the audience are told it was
 * scheduled (to them, it is new); people who were in it already are told it
 * moved, and only when the day, time or length changed. People taken out of
 * the audience hear nothing. A title, place, link or agenda fix sends nothing.
 */
export function meetingUpdateNotices(input: {
  before: readonly string[];
  after: readonly string[];
  timingChanged: boolean;
}): { scheduled: string[]; moved: string[] } {
  const before = new Set(input.before);
  const scheduled: string[] = [];
  const moved: string[] = [];
  for (const id of new Set(input.after)) {
    if (!before.has(id)) scheduled.push(id);
    else if (input.timingChanged) moved.push(id);
  }
  return { scheduled, moved };
}

// --- Refusals --------------------------------------------------------------

export type MeetingRefusal =
  | "not_found"
  | "not_scheduler"
  | "not_note_taker"
  | "cancelled"
  | "stale"
  | "no_roles"
  | "unknown_role"
  | "no_teams"
  | "unknown_team"
  | "not_your_team"
  | "not_attendee";

/** The sentence a refused writer reads. */
export function meetingRefusalMessage(reason: MeetingRefusal): string {
  switch (reason) {
    case "not_found":
      return "That meeting doesn't exist.";
    case "not_scheduler":
      return "Only the camp's leads and members who can schedule meetings can change this meeting.";
    case "not_note_taker":
      return "Only the person who scheduled this meeting, the camp's leads and members who can schedule meetings can write its notes.";
    case "cancelled":
      return "This meeting was cancelled, so it can't be changed.";
    case "stale":
      return "Someone else saved this meeting while you were editing. Reload to see their changes.";
    case "no_roles":
      return "Pick at least one role, or choose the whole camp.";
    case "unknown_role":
      return "One of those roles doesn't exist any more. Reload and pick again.";
    case "no_teams":
      return "Pick at least one team.";
    case "unknown_team":
      return "One of those teams doesn't exist any more. Reload and pick again.";
    case "not_your_team":
      return "You can only schedule meetings for the teams you lead.";
    case "not_attendee":
      return "That person isn't a member this meeting is for.";
  }
}

/** Editing details or cancelling: seen, allowed, live and not stale. */
export function decideMeetingEdit(input: {
  canView: boolean;
  canEdit: boolean;
  cancelled: boolean;
  currentVersion: number;
  expectedVersion: number;
}): MeetingRefusal | null {
  if (!input.canView) return "not_found";
  if (!input.canEdit) return "not_scheduler";
  if (input.cancelled) return "cancelled";
  if (input.currentVersion !== input.expectedVersion) return "stale";
  return null;
}

/** Saving notes: seen, allowed and not stale. A cancelled meeting's notes may
 * still be written — "we moved this to Sunday" belongs on it. */
export function decideMeetingNotesSave(input: {
  canView: boolean;
  canEditNotes: boolean;
  currentVersion: number;
  expectedVersion: number;
}): MeetingRefusal | null {
  if (!input.canView) return "not_found";
  if (!input.canEditNotes) return "not_note_taker";
  if (input.currentVersion !== input.expectedVersion) return "stale";
  return null;
}

/**
 * The retry of a notes save that committed but whose response was lost: the
 * row is one version on, holds exactly the sent notes, and this writer wrote
 * them. Answer "saved", not "someone else saved first".
 */
export function isRetryOfStoredNotes(input: {
  currentVersion: number;
  expectedVersion: number;
  storedNotes: string;
  sentNotes: string;
  notesUpdatedByUserId: string | null;
  actorUserId: string;
}): boolean {
  return (
    input.currentVersion === input.expectedVersion + 1 &&
    input.storedNotes === input.sentNotes &&
    input.notesUpdatedByUserId === input.actorUserId
  );
}

/** Did an edit change what someone planning to come needs to know? */
export function meetingTimingChanged(
  before: MeetingSlot,
  after: MeetingSlot,
): boolean {
  return (
    before.date !== after.date ||
    before.startMinute !== after.startMinute ||
    before.durationMinutes !== after.durationMinutes
  );
}

// --- Upcoming and past -----------------------------------------------------

export interface MeetingSlot {
  /** `YYYY-MM-DD`. */
  date: string;
  startMinute: number;
  durationMinutes: number;
}

export interface MeetingTiming extends MeetingSlot {
  cancelledAt: Date | null;
}

/** "Now" on a South African wall clock: the date and minute after midnight. */
export function sastWallClock(now: Date): { date: string; minute: number } {
  const shifted = new Date(now.getTime() + SAST_OFFSET_MINUTES * MINUTE_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Wall-clock minutes for "now" on the same zone-free scale `shiftInterval`
 * uses, so a typed meeting and the present compare directly. */
function nowOnWallScale(now: Date): number {
  const wall = sastWallClock(now);
  const [start] = shiftInterval({
    date: wall.date,
    startMinute: wall.minute,
    durationMinutes: 0,
  });
  return start;
}

/** Still to come (or happening now) and not cancelled. A meeting that has
 * started but not ended is upcoming: its call link is still wanted. */
export function isMeetingUpcoming(m: MeetingTiming, now: Date): boolean {
  if (m.cancelledAt !== null) return false;
  const [, end] = shiftInterval(m);
  return end > nowOnWallScale(now);
}

/** Earlier first; ties by start minute, then by the caller's order. */
function compareSlots(a: MeetingSlot, b: MeetingSlot): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.startMinute - b.startMinute;
}

/**
 * The meetings list's two sections (frame G1): "Upcoming", soonest first, and
 * "Past and cancelled", most recent first. A cancelled meeting is in the
 * second whenever it was meant to happen.
 */
export function splitMeetings<T extends MeetingTiming>(
  meetings: readonly T[],
  now: Date,
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const m of meetings) {
    if (isMeetingUpcoming(m, now)) upcoming.push(m);
    else past.push(m);
  }
  upcoming.sort(compareSlots);
  past.sort((a, b) => compareSlots(b, a));
  return { upcoming, past };
}

/** The camp page's "Next meeting" line: the soonest upcoming, or null. */
export function nextMeeting<T extends MeetingTiming>(
  meetings: readonly T[],
  now: Date,
): T | null {
  return splitMeetings(meetings, now).upcoming[0] ?? null;
}

// --- Calendar --------------------------------------------------------------

export type CalendarEntry =
  | {
      kind: "meeting";
      id: string;
      title: string;
      startMinute: number;
      durationMinutes: number;
      cancelled: boolean;
    }
  | {
      kind: "shift";
      id: string;
      title: string;
      startMinute: number;
      durationMinutes: number;
    };

export interface CalendarDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Build, the event or strike — null on an ordinary day. */
  phase: ShiftPhase | null;
  entries: CalendarEntry[];
}

export interface CalendarMeetingInput extends MeetingSlot {
  id: string;
  title: string;
  cancelledAt: Date | null;
}

export interface CalendarShiftInput extends MeetingSlot {
  id: string;
  name: string;
}

/**
 * The camp calendar for one viewer (frame G4), derived and read-only: the
 * edition's build, event and strike days (the same days the shifts board
 * uses), the meetings the caller has ALREADY filtered to this viewer, and the
 * viewer's own shifts. Only days with something on are returned, earliest
 * first; each day's entries are in time order (meetings before shifts at the
 * same minute). An entry sits on the day it starts.
 */
export function buildCampCalendar(input: {
  edition: { startDate: string; endDate: string } | null;
  meetings: readonly CalendarMeetingInput[];
  shifts: readonly CalendarShiftInput[];
}): CalendarDay[] {
  const days = new Map<string, CalendarDay>();
  const day = (date: string): CalendarDay => {
    let d = days.get(date);
    if (!d) {
      d = { date, phase: null, entries: [] };
      days.set(date, d);
    }
    return d;
  };
  if (input.edition) {
    for (const d of shiftDays(input.edition)) day(d.date).phase = d.phase;
  }
  for (const m of input.meetings) {
    if (isoDateToMs(m.date) === null) continue;
    day(m.date).entries.push({
      kind: "meeting",
      id: m.id,
      title: m.title,
      startMinute: m.startMinute,
      durationMinutes: m.durationMinutes,
      cancelled: m.cancelledAt !== null,
    });
  }
  for (const s of input.shifts) {
    if (isoDateToMs(s.date) === null) continue;
    day(s.date).entries.push({
      kind: "shift",
      id: s.id,
      title: s.name,
      startMinute: s.startMinute,
      durationMinutes: s.durationMinutes,
    });
  }
  const order = (e: CalendarEntry) => (e.kind === "meeting" ? 0 : 1);
  for (const d of days.values()) {
    d.entries.sort(
      (a, b) =>
        a.startMinute - b.startMinute ||
        order(a) - order(b) ||
        a.title.localeCompare(b.title),
    );
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** `YYYY-MM` of a `YYYY-MM-DD`. */
function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * The months the calendar's switcher steps through: from the earlier of
 * today and the first day with something on, to the later of today and the
 * last. Always at least today's month.
 */
export function calendarMonths(
  days: readonly CalendarDay[],
  today: string,
): string[] {
  let first = monthOf(today);
  let last = first;
  for (const d of days) {
    const m = monthOf(d.date);
    if (m < first) first = m;
    if (m > last) last = m;
  }
  const out: string[] = [];
  let [y, mo] = first.split("-").map(Number) as [number, number];
  for (let i = 0; i < 240; i++) {
    const key = `${y}-${String(mo).padStart(2, "0")}`;
    out.push(key);
    if (key >= last) break;
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return out;
}

export interface CalendarCell {
  date: string;
  /** False for the spill-over days of the months either side. */
  inMonth: boolean;
  day: CalendarDay | null;
}

/**
 * The desktop month view (frame G4): six Monday-first weeks that contain the
 * month, so the grid never changes height. `month` is `YYYY-MM`; an invalid
 * month gives no weeks.
 */
export function calendarMonthGrid(
  month: string,
  days: readonly CalendarDay[],
): CalendarCell[][] {
  const first = isoDateToMs(`${month}-01`);
  if (first === null || !/^\d{4}-\d{2}$/.test(month)) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  // getUTCDay: Sunday 0 … Saturday 6 → days back to the Monday.
  const back = (new Date(first).getUTCDay() + 6) % 7;
  const start = first - back * DAY_MS;
  const weeks: CalendarCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: CalendarCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(start + (w * 7 + i) * DAY_MS)
        .toISOString()
        .slice(0, 10);
      week.push({
        date,
        inMonth: monthOf(date) === month,
        day: byDate.get(date) ?? null,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

/** The phone agenda (frame G4 at 360): the month's days with something on. */
export function calendarAgenda(
  month: string,
  days: readonly CalendarDay[],
): CalendarDay[] {
  return days.filter((d) => monthOf(d.date) === month);
}

// --- Add to my calendar (.ics) ---------------------------------------------

export interface MeetingIcsInput extends MeetingSlot {
  meetingId: string;
  /** The row's version; the event's SEQUENCE is version − 1, so a calendar
   * app that imported an earlier copy takes the newer one. */
  version: number;
  title: string;
  campName: string;
  location: string | null;
  videoLink: string | null;
  /** Absolute URL of the meeting page, or null. */
  pageUrl: string | null;
  /** The right-hand side of the UID (a host name). */
  uidDomain: string;
  /** DTSTAMP — when the file was made. */
  now: Date;
}

/** RFC 5545 §3.3.11 TEXT escaping. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * RFC 5545 §3.1 line folding: no line longer than 75 octets; a continuation
 * starts with one space. Folds on UTF-8 byte counts without splitting a
 * character.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // The first line holds 75 octets; continuations hold 74 after the space.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** A local (wall-clock) date-time in iCalendar's basic form. */
function icsLocal(dateMs: number, minute: number): string {
  const d = new Date(dateMs + minute * MINUTE_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`
  );
}

/** A UTC instant in iCalendar's basic form (`…Z`). */
function icsUtc(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * One meeting as an iCalendar file (RFC 5545) for "Add to my calendar". The
 * time is the typed time in Africa/Johannesburg (see the header); the zone's
 * definition is embedded. CRLF line ends, folded lines, escaped text. Null
 * when the stored date is unusable. The caller never offers it for a
 * cancelled meeting (frame G2).
 */
export function buildMeetingIcs(input: MeetingIcsInput): string | null {
  const dateMs = isoDateToMs(input.date);
  if (dateMs === null) return null;
  const description = [
    `${input.campName} meeting.`,
    input.videoLink ? `Join the call: ${input.videoLink}` : null,
    input.pageUrl ? `Agenda and notes: ${input.pageUrl}` : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
  const location = input.location ?? (input.videoLink ? "Online" : null);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AfrikaBurn//Contributors App//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    `TZID:${MEETING_TZID}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0200",
    "TZNAME:SAST",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:meeting-${input.meetingId}@${input.uidDomain}`,
    `DTSTAMP:${icsUtc(input.now)}`,
    `SEQUENCE:${Math.max(0, input.version - 1)}`,
    `DTSTART;TZID=${MEETING_TZID}:${icsLocal(dateMs, input.startMinute)}`,
    `DTEND;TZID=${MEETING_TZID}:${icsLocal(dateMs, input.startMinute + input.durationMinutes)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    location ? `LOCATION:${escapeIcsText(location)}` : null,
    `DESCRIPTION:${escapeIcsText(description)}`,
    input.videoLink ? `URL:${input.videoLink}` : null,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** A safe download name: `2027-03-21-camp-call.ics`. */
export function meetingIcsFilename(title: string, date: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${date}-${slug || "meeting"}.ics`;
}

// --- Notifications ---------------------------------------------------------
// Kind `meeting`, origin `camp`, linked to the meeting's page. The camp's name
// is the body, so a member of two camps knows which one it is.

export interface MeetingNoticeContext extends MeetingSlot {
  campName: string;
  campSlug: string;
  meetingId: string;
  title: string;
}

/** "Sun 21 Mar, 19:00–20:00". */
export function meetingWhen(slot: MeetingSlot): string {
  return `${shiftDateLabel(slot.date).medium}, ${formatShiftTime(slot.startMinute, slot.durationMinutes)}`;
}

/** The in-app path of a meeting's page. */
export function meetingPath(campSlug: string, meetingId: string): string {
  return `/camps/${campSlug}/meetings/${meetingId}`;
}

function meetingNotice(
  c: MeetingNoticeContext,
  title: string,
): NotificationPayload {
  return {
    kind: "meeting",
    title,
    body: c.campName,
    link: meetingPath(c.campSlug, c.meetingId),
  };
}

/** A meeting meant for you was scheduled (or you were added to its audience). */
export function meetingScheduledNotification(
  c: MeetingNoticeContext,
  byName: string,
): NotificationPayload {
  return meetingNotice(c, `${byName} scheduled ${c.title}: ${meetingWhen(c)}`);
}

/** A meeting meant for you moved to another day, time or length. */
export function meetingMovedNotification(
  before: MeetingNoticeContext,
  after: MeetingNoticeContext,
  byName: string,
): NotificationPayload {
  return meetingNotice(
    after,
    `${byName} moved ${before.title} (was ${shiftDateLabel(before.date).medium} ${formatClock(before.startMinute)}) to ${meetingWhen(after)}`,
  );
}

/** A meeting meant for you was cancelled. */
export function meetingCancelledNotification(
  c: MeetingNoticeContext,
  byName: string,
): NotificationPayload {
  return meetingNotice(
    c,
    `${byName} cancelled ${c.title} on ${shiftDateLabel(c.date).medium}`,
  );
}
