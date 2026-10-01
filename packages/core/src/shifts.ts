// Camp shifts and rotas (epic #57, App Spec §6 SHIFT-001–SHIFT-027). PURE — no
// I/O, no env, no DB. The store (apps/web/lib/shifts-store.ts) loads every fact
// these functions read from the database; a request names ids and nothing else.
//
// Decisions (Ryan, 27–28 Sep 2026, #57):
//
//   · Shifts live on the camp in apps/web (Decision 007).
//   · Teams are a STARTER LIST the lead edits — add, rename, remove.
//   · A shift's optional required skill is a CAMP ROLE (a project role). Only a
//     member holding it (an ACCEPTED assignment) can sign up or be assigned.
//   · Swapping needs NO approval from a lead. The holder either hands the shift
//     to a campmate (who accepts it — the S4 frame), or offers it up as "needs
//     a replacement" and any eligible member takes it. The holder stays on the
//     shift until the moment it moves, so a spot is never silently empty.
//   · Open shifts are shown for EVERY day of the burn, build and strike
//     included — never filtered by a member's travel plans.
//   · Members sign themselves up; leads can also assign.
//
// WHO MANAGES: the structural lead and co-leads (the irrevocable backstop,
// ./project-permissions). There is no `manage_shifts` custom-role privilege yet
// — that would be a new grant in the permission vocabulary, and adding one is
// Ryan's call. `canManageShifts` is the ONE place to widen it.
//
// TIME: a shift is a calendar DATE plus a start minute (0–1439) and a length in
// minutes. No time zone is stored or implied: the burn happens in one place, and
// "12:00 on Thu 29" is what a lead types and what every member reads. A shift
// that starts late and runs past midnight simply ends on the next day; overlap
// arithmetic is done on absolute minutes so that is handled exactly.

import { z } from "zod";
import type { NotificationPayload } from "@quagga/types";
import {
  isPermissionBackstop,
  type PermissionMembership,
} from "./project-permissions";

// --- Constants -------------------------------------------------------------

/** Build days before the edition's first day (the design's "build from 22
 * April" for a 26 April start). The edition row stores only the event dates. */
export const SHIFT_BUILD_DAYS = 4;
/** Strike days after the edition's last day ("strike on 3 May"). */
export const SHIFT_STRIKE_DAYS = 1;

/** The teams a camp starts with. The lead edits the list from there. */
export const SHIFT_STARTER_TEAMS = [
  "Kitchen",
  "Tea bar",
  "Sound",
  "Meal rota",
  "Build & strike",
  "MOOP",
] as const;

export const SHIFT_NAME_MAX = 80;
export const SHIFT_TEAM_NAME_MAX = 40;
export const SHIFT_MAX_TEAMS = 30;
export const SHIFT_MIN_DURATION = 15;
export const SHIFT_MAX_DURATION = 24 * 60;
export const SHIFT_MAX_CAPACITY = 50;
/** One "repeat on" submit can make at most this many shifts (one per day). */
export const SHIFT_MAX_REPEAT = 20;

/** Audit action names (written in the same transaction as the change). */
export const SHIFT_AUDIT = {
  create: "camp.shift.create",
  update: "camp.shift.update",
  delete: "camp.shift.delete",
  assign: "camp.shift.assign",
  unassign: "camp.shift.unassign",
} as const;

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// --- Days of the burn ------------------------------------------------------

export type ShiftPhase = "build" | "event" | "strike";

export interface ShiftDay {
  /** `YYYY-MM-DD`. */
  date: string;
  phase: ShiftPhase;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → UTC midnight in ms, or null for anything else. */
export function isoDateToMs(iso: string): number | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Reject rollovers ("2027-02-31" would otherwise land on 3 March).
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== Number(m[1]) ||
    d.getUTCMonth() !== Number(m[2]) - 1 ||
    d.getUTCDate() !== Number(m[3])
  ) {
    return null;
  }
  return ms;
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Every day a camp can run a shift on: build days, the event, strike. Empty
 * when the edition's dates are unusable (the page then says so rather than
 * inventing a week).
 */
export function shiftDays(edition: {
  startDate: string;
  endDate: string;
}): ShiftDay[] {
  const start = isoDateToMs(edition.startDate);
  const end = isoDateToMs(edition.endDate);
  if (start === null || end === null || end < start) return [];
  const days: ShiftDay[] = [];
  for (let i = SHIFT_BUILD_DAYS; i > 0; i--) {
    days.push({ date: msToIso(start - i * DAY_MS), phase: "build" });
  }
  for (let ms = start; ms <= end; ms += DAY_MS) {
    days.push({ date: msToIso(ms), phase: "event" });
  }
  for (let i = 1; i <= SHIFT_STRIKE_DAYS; i++) {
    days.push({ date: msToIso(end + i * DAY_MS), phase: "strike" });
  }
  return days;
}

/** Display pieces for a date: "Thu", 29, "Apr", "Thu 29", "Thursday 29 April". */
export function shiftDateLabel(iso: string): {
  weekday: string;
  day: number;
  month: string;
  short: string;
  medium: string;
  long: string;
  /** "22 April". */
  dayMonth: string;
} {
  const ms = isoDateToMs(iso);
  if (ms === null) {
    return {
      weekday: "",
      day: 0,
      month: "",
      short: iso,
      medium: iso,
      long: iso,
      dayMonth: iso,
    };
  }
  const d = new Date(ms);
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()]!;
  return {
    weekday,
    day,
    month,
    short: `${weekday} ${day}`,
    medium: `${weekday} ${day} ${month}`,
    long: `${WEEKDAYS_LONG[d.getUTCDay()]} ${day} ${MONTHS_LONG[d.getUTCMonth()]}`,
    dayMonth: `${day} ${MONTHS_LONG[d.getUTCMonth()]}`,
  };
}

// --- Time of day -----------------------------------------------------------

/** 0–1439 → "09:00". Values past midnight wrap ("24:00" reads "00:00"). */
export function formatClock(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "HH:MM" → minutes after midnight, or null. */
export function parseClock(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** An all-day shift is stored as 00:00 for 24 hours. */
export function isAllDay(startMinute: number, durationMinutes: number): boolean {
  return startMinute === 0 && durationMinutes === SHIFT_MAX_DURATION;
}

/** "12:00–15:00", "21:00–00:00", or "All day". */
export function formatShiftTime(
  startMinute: number,
  durationMinutes: number,
): string {
  if (isAllDay(startMinute, durationMinutes)) return "All day";
  return `${formatClock(startMinute)}–${formatClock(startMinute + durationMinutes)}`;
}

/** "3 h", "30 min", "1 h 30 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export interface ShiftSlot {
  date: string;
  startMinute: number;
  durationMinutes: number;
}

/** [start, end) in absolute minutes since the epoch — zone-free. */
export function shiftInterval(slot: ShiftSlot): [number, number] {
  const day = isoDateToMs(slot.date);
  const base = day === null ? 0 : day / 60_000;
  const start = base + slot.startMinute;
  return [start, start + slot.durationMinutes];
}

/** Do two shifts overlap in time? Touching ends (15:00 / 15:00) do not. */
export function shiftsOverlap(a: ShiftSlot, b: ShiftSlot): boolean {
  const [as, ae] = shiftInterval(a);
  const [bs, be] = shiftInterval(b);
  return as < be && bs < ae;
}

// --- Authority -------------------------------------------------------------

/**
 * May this member create, edit, delete and assign shifts? The structural lead
 * and co-leads only (see the header). `null` = not an active member of the
 * camp, which is always no.
 */
export function canManageShifts(
  membership: PermissionMembership | null,
): boolean {
  return membership !== null && isPermissionBackstop(membership.structuralRole);
}

/** Does the member hold the shift's required camp role (if it has one)? */
export function holdsShiftSkill(
  requiredRoleId: string | null,
  heldRoleIds: ReadonlySet<string>,
): boolean {
  return requiredRoleId === null || heldRoleIds.has(requiredRoleId);
}

// --- Decisions -------------------------------------------------------------

export type ShiftSignupMode = "open" | "assign";

/** One assignment on a shift, as stored. */
export interface ShiftAssignmentFacts {
  id: string;
  membershipId: string;
  /** Offered up as "needs a replacement". */
  offered: boolean;
  /** A pending hand-to request, to this membership. */
  handoverToMembershipId: string | null;
}

/** A shift, as stored — with only ACTIVE members' assignments. */
export interface ShiftFacts extends ShiftSlot {
  id: string;
  capacity: number;
  signupMode: ShiftSignupMode;
  requiredRoleId: string | null;
  assignments: readonly ShiftAssignmentFacts[];
}

/** The member a decision is about (the one joining, or the one it moves to). */
export interface ShiftMemberFacts {
  membershipId: string;
  /** Project roles they hold with an ACCEPTED assignment (baseline excluded). */
  heldRoleIds: ReadonlySet<string>;
  /** Every OTHER shift they are on in this edition. */
  otherShifts: readonly ShiftSlot[];
}

export type ShiftRefusal =
  | "not_member"
  | "not_manager"
  | "assign_only"
  | "full"
  | "already_on"
  | "needs_role"
  | "clash"
  | "not_on_shift"
  | "not_offered"
  | "no_request"
  | "self"
  | "not_a_day";

export type ShiftDecision = { ok: true } | { ok: false; reason: ShiftRefusal };

const refuse = (reason: ShiftRefusal): ShiftDecision => ({ ok: false, reason });

/** Spots nobody holds. Offered spots are still HELD (the holder stays on). */
export function openSpots(shift: {
  capacity: number;
  assignments: readonly unknown[];
}): number {
  return Math.max(0, shift.capacity - shift.assignments.length);
}

/** Would joining this shift clash with another shift the member is on? */
export function clashesWith(
  shift: ShiftSlot,
  member: Pick<ShiftMemberFacts, "otherShifts">,
): boolean {
  return member.otherShifts.some((s) => shiftsOverlap(s, shift));
}

/** Can this member be put on this shift at all (skill, not already on, time)? */
function eligibility(
  shift: ShiftFacts,
  member: ShiftMemberFacts,
): ShiftDecision {
  if (shift.assignments.some((a) => a.membershipId === member.membershipId)) {
    return refuse("already_on");
  }
  if (!holdsShiftSkill(shift.requiredRoleId, member.heldRoleIds)) {
    return refuse("needs_role");
  }
  if (clashesWith(shift, member)) return refuse("clash");
  return { ok: true };
}

/** A member signs themselves up for an open spot. */
export function decideSignUp(
  shift: ShiftFacts,
  member: ShiftMemberFacts | null,
): ShiftDecision {
  if (!member) return refuse("not_member");
  if (shift.signupMode !== "open") return refuse("assign_only");
  const eligible = eligibility(shift, member);
  if (!eligible.ok) return eligible;
  if (openSpots(shift) === 0) return refuse("full");
  return { ok: true };
}

/** A lead puts a member on a shift (any sign-up mode). */
export function decideAssign(
  shift: ShiftFacts,
  managerMayManage: boolean,
  member: ShiftMemberFacts | null,
): ShiftDecision {
  if (!managerMayManage) return refuse("not_manager");
  if (!member) return refuse("not_member");
  const eligible = eligibility(shift, member);
  if (!eligible.ok) return eligible;
  if (openSpots(shift) === 0) return refuse("full");
  return { ok: true };
}

/** The holder's assignment on this shift, or null. */
export function heldAssignment(
  shift: Pick<ShiftFacts, "assignments">,
  membershipId: string,
): ShiftAssignmentFacts | null {
  return shift.assignments.find((a) => a.membershipId === membershipId) ?? null;
}

/**
 * The holder asks a campmate to take their spot. The campmate still has to
 * accept; until then the holder stays on it.
 */
export function decideHandTo(
  shift: ShiftFacts,
  holderMembershipId: string,
  target: ShiftMemberFacts | null,
): ShiftDecision {
  if (!heldAssignment(shift, holderMembershipId)) return refuse("not_on_shift");
  if (!target) return refuse("not_member");
  if (target.membershipId === holderMembershipId) return refuse("self");
  return eligibility(shift, target);
}

/** The campmate a shift was handed to accepts it. Re-checked at accept time:
 * a role taken away or a clash booked since the request both refuse. */
export function decideAcceptHandover(
  shift: ShiftFacts,
  accepter: ShiftMemberFacts | null,
): ShiftDecision {
  if (!accepter) return refuse("not_member");
  const request = shift.assignments.find(
    (a) => a.handoverToMembershipId === accepter.membershipId,
  );
  if (!request) return refuse("no_request");
  return eligibility(shift, accepter);
}

/** Any eligible member takes a spot its holder offered up. */
export function decideTakeOffered(
  shift: ShiftFacts,
  assignmentId: string,
  taker: ShiftMemberFacts | null,
): ShiftDecision {
  if (!taker) return refuse("not_member");
  const offered = shift.assignments.find((a) => a.id === assignmentId);
  if (!offered || !offered.offered) return refuse("not_offered");
  if (offered.membershipId === taker.membershipId) return refuse("self");
  return eligibility(shift, taker);
}

/** Validate a lead's pick of days against the burn's days. */
export function decideShiftDays(
  days: readonly ShiftDay[],
  dates: readonly string[],
): ShiftDecision {
  const allowed = new Set(days.map((d) => d.date));
  return dates.length > 0 && dates.every((d) => allowed.has(d))
    ? { ok: true }
    : refuse("not_a_day");
}

/** The sentence a refused action shows. */
export function shiftRefusalMessage(
  reason: ShiftRefusal,
  roleName?: string | null,
): string {
  switch (reason) {
    case "not_member":
      return "Only members of this camp can be on its shifts.";
    case "not_manager":
      return "Only the camp's leads can change shifts.";
    case "assign_only":
      return "The camp's leads assign this shift — it isn't open for sign-up.";
    case "full":
      return "That shift is full.";
    case "already_on":
      return "They're already on that shift.";
    case "needs_role":
      return roleName
        ? `This shift needs the ${roleName} role.`
        : "This shift needs a camp role they don't hold.";
    case "clash":
      return "That clashes with another shift at the same time.";
    case "not_on_shift":
      return "You're not on that shift.";
    case "not_offered":
      return "Someone already took that shift, or it was taken back.";
    case "no_request":
      return "That request was withdrawn or already answered.";
    case "self":
      return "Pick someone other than yourself.";
    case "not_a_day":
      return "Pick at least one day of the burn.";
  }
}

// --- Summaries -------------------------------------------------------------

export interface ShiftCounts {
  date: string;
  capacity: number;
  filled: number;
}

export interface ShiftStats {
  shifts: number;
  spots: number;
  filled: number;
  open: number;
  /** Days with at least one open spot. */
  daysWithGaps: number;
  /** 0–100, rounded down; null when there are no spots. */
  percentFilled: number | null;
  firstDate: string | null;
  lastDate: string | null;
}

export function summariseShifts(shifts: readonly ShiftCounts[]): ShiftStats {
  let spots = 0;
  let filled = 0;
  const gapDays = new Set<string>();
  let first: string | null = null;
  let last: string | null = null;
  for (const s of shifts) {
    const held = Math.min(s.filled, s.capacity);
    spots += s.capacity;
    filled += held;
    if (held < s.capacity) gapDays.add(s.date);
    if (first === null || s.date < first) first = s.date;
    if (last === null || s.date > last) last = s.date;
  }
  return {
    shifts: shifts.length,
    spots,
    filled,
    open: spots - filled,
    daysWithGaps: gapDays.size,
    percentFilled: spots === 0 ? null : Math.floor((filled / spots) * 100),
    firstDate: first,
    lastDate: last,
  };
}

export interface ShiftDaySummary extends ShiftDay {
  shifts: number;
  open: number;
}

/** One entry per day of the burn: how many shifts and open spots it has. */
export function summariseDays(
  days: readonly ShiftDay[],
  shifts: readonly ShiftCounts[],
): ShiftDaySummary[] {
  return days.map((d) => {
    const on = shifts.filter((s) => s.date === d.date);
    return {
      ...d,
      shifts: on.length,
      open: on.reduce(
        (n, s) => n + Math.max(0, s.capacity - Math.min(s.filled, s.capacity)),
        0,
      ),
    };
  });
}

/** "Full" / "1 gap" / "3 gaps" / "No shifts". */
export function dayGapLabel(day: { shifts: number; open: number }): string {
  if (day.shifts === 0) return "No shifts";
  if (day.open === 0) return "Full";
  return `${day.open} gap${day.open === 1 ? "" : "s"}`;
}

/** "22 Apr – 3 May" / "29 Apr" / null. */
export function shiftRangeLabel(
  first: string | null,
  last: string | null,
): string | null {
  if (!first || !last) return null;
  const a = shiftDateLabel(first);
  const b = shiftDateLabel(last);
  if (first === last) return `${a.day} ${a.month}`;
  return `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

// --- Input -----------------------------------------------------------------

const Uuid = z.string().uuid();
const IsoDate = z
  .string()
  .regex(ISO_DATE, "Pick a day.")
  .refine((v) => isoDateToMs(v) !== null, "Pick a day.");

const ShiftFields = {
  slug: z.string().min(1).max(200),
  name: z
    .string()
    .trim()
    .min(1, "Give the shift a name.")
    .max(SHIFT_NAME_MAX, `Keep the name under ${SHIFT_NAME_MAX} characters.`),
  teamId: Uuid.nullable(),
  startMinute: z.number().int().min(0).max(1439),
  durationMinutes: z
    .number()
    .int()
    .min(SHIFT_MIN_DURATION, `A shift is at least ${SHIFT_MIN_DURATION} minutes.`)
    .max(SHIFT_MAX_DURATION, "A shift is at most a day long."),
  capacity: z
    .number()
    .int()
    .min(1, "A shift needs at least one person.")
    .max(SHIFT_MAX_CAPACITY, `At most ${SHIFT_MAX_CAPACITY} people per shift.`),
  requiredRoleId: Uuid.nullable(),
  signupMode: z.enum(["open", "assign"]),
};

/** New shift(s): one per picked day. */
export const ShiftCreateInput = z
  .object({
    ...ShiftFields,
    dates: z
      .array(IsoDate)
      .min(1, "Pick at least one day.")
      .max(SHIFT_MAX_REPEAT),
  })
  .strict();
export type ShiftCreateInput = z.infer<typeof ShiftCreateInput>;

/** Edit one shift. */
export const ShiftUpdateInput = z
  .object({ ...ShiftFields, id: Uuid, date: IsoDate })
  .strict();
export type ShiftUpdateInput = z.infer<typeof ShiftUpdateInput>;

export const ShiftTeamName = z
  .string()
  .trim()
  .min(1, "Give the team a name.")
  .max(
    SHIFT_TEAM_NAME_MAX,
    `Keep team names under ${SHIFT_TEAM_NAME_MAX} characters.`,
  );

/** Case/space-insensitive key for the per-camp unique team name. */
export function normalizeTeamName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Did an edit change what a member on the shift would need to know? */
export function shiftTimingChanged(
  before: ShiftSlot,
  after: ShiftSlot,
): boolean {
  return (
    before.date !== after.date ||
    before.startMinute !== after.startMinute ||
    before.durationMinutes !== after.durationMinutes
  );
}

// --- Notifications ---------------------------------------------------------
// Kind `shift`, origin `camp`, linked to the camp's Shifts page. Titles carry
// display names, shift names and times only — never a private field. The
// camp's name is the body, so a member of two camps knows which one it is.

export interface ShiftNoticeContext {
  campName: string;
  campSlug: string;
  shiftName: string;
  date: string;
  startMinute: number;
  durationMinutes: number;
}

function shiftLine(c: ShiftNoticeContext): string {
  return `${c.shiftName} on ${shiftDateLabel(c.date).medium}`;
}

function notice(c: ShiftNoticeContext, title: string): NotificationPayload {
  return {
    kind: "shift",
    title,
    body: c.campName,
    link: `/camps/${c.campSlug}/shifts/mine`,
  };
}

/** A lead put you on a shift. */
export function shiftAssignedNotification(
  c: ShiftNoticeContext,
  byName: string,
): NotificationPayload {
  return notice(
    c,
    `${byName} put you on ${shiftLine(c)}, ${formatShiftTime(c.startMinute, c.durationMinutes)}`,
  );
}

/** A lead took you off a shift. */
export function shiftUnassignedNotification(
  c: ShiftNoticeContext,
  byName: string,
): NotificationPayload {
  return notice(c, `${byName} took you off ${shiftLine(c)}`);
}

/** A campmate wants to hand you their shift. */
export function shiftHandoverRequestNotification(
  c: ShiftNoticeContext,
  fromName: string,
): NotificationPayload {
  return notice(
    c,
    `${fromName} wants to hand you ${shiftLine(c)}, ${formatShiftTime(c.startMinute, c.durationMinutes)}`,
  );
}

/** Your shift moved to someone (they accepted it, or took it from Open shifts). */
export function shiftHandedOnNotification(
  c: ShiftNoticeContext,
  toName: string,
  how: "accepted" | "took",
): NotificationPayload {
  return notice(
    c,
    how === "accepted"
      ? `${toName} accepted your ${shiftLine(c)} — it's theirs now`
      : `${toName} took your ${shiftLine(c)} from Open shifts — it's theirs now`,
  );
}

/** The campmate you asked declined — the shift is still yours. */
export function shiftHandoverDeclinedNotification(
  c: ShiftNoticeContext,
  byName: string,
): NotificationPayload {
  return notice(
    c,
    `${byName} declined ${shiftLine(c)} — it's still yours`,
  );
}

/** For the camp's leads: a shift changed hands (nobody approved it). */
export function shiftChangedHandsNotification(
  c: ShiftNoticeContext,
  fromName: string,
  toName: string,
): NotificationPayload {
  return {
    ...notice(c, `${shiftLine(c)} changed hands — ${fromName} to ${toName}`),
    link: `/camps/${c.campSlug}/shifts?day=${c.date}`,
  };
}

/** A lead changed the day or time of a shift you're on. */
export function shiftChangedNotification(
  before: ShiftNoticeContext,
  after: ShiftNoticeContext,
  byName: string,
): NotificationPayload {
  return notice(
    after,
    `${byName} moved ${shiftLine(before)} to ${shiftDateLabel(after.date).medium}, ${formatShiftTime(after.startMinute, after.durationMinutes)}`,
  );
}

/** A lead cancelled a shift you were on. */
export function shiftCancelledNotification(
  c: ShiftNoticeContext,
  byName: string,
): NotificationPayload {
  return notice(c, `${byName} cancelled ${shiftLine(c)}`);
}
