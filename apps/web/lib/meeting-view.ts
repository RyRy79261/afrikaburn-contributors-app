import {
  formatClock,
  formatDuration,
  isInMeetingAudience,
  isPermissionBackstop,
  shiftDateLabel,
  type ShiftPhase,
} from "@quagga/core";
import type { MembershipRole } from "@quagga/types";

// Presentation helpers for the camp meetings pages (docs/camp-meetings-spec.md,
// frames G1–G4). Pure: no data access, no authorisation — what a viewer may
// see is decided by the store before any of this runs. The reach count is a
// GUIDE on the form; the store resolves the real audience on every write.

/** The schedule form's "Duration" choices, in minutes (frame G3). */
export const MEETING_DURATION_OPTIONS = [
  15, 30, 45, 60, 90, 120, 180, 240,
] as const;

/** "1 hour", "30 minutes", "1 hour 30 minutes". */
export function meetingDurationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? "" : `${h} ${h === 1 ? "hour" : "hours"}`;
  const mins = m === 0 ? "" : `${m} ${m === 1 ? "minute" : "minutes"}`;
  return [hours, mins].filter(Boolean).join(" ") || formatDuration(minutes);
}

/** "19:00 – 20:00" — the end may run past midnight ("23:30 – 00:30"). */
export function meetingTimeRange(
  startMinute: number,
  durationMinutes: number,
): string {
  return `${formatClock(startMinute)} – ${formatClock(startMinute + durationMinutes)}`;
}

/** "Sun 21 Mar · 19:00 – 20:00" — the camp page's next-meeting line. */
export function meetingWhenLine(m: {
  date: string;
  startMinute: number;
  durationMinutes: number;
}): string {
  return `${shiftDateLabel(m.date).medium} · ${meetingTimeRange(m.startMinute, m.durationMinutes)}`;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const MONTH_NAMES = [
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

/** "Sunday 21 March 2027" — the meeting page's When block. Built by hand,
 * not by the runtime's locale data, so server and browser always agree. */
export function meetingLongDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return date;
  return `${WEEKDAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "meet.example.com/mad-hatters" — a call link without its scheme, for
 * display only (the href is always the stored https link). */
export function displayLink(url: string): string {
  return url.replace(/^https:\/\//i, "").replace(/\/$/, "");
}

/** The audience chip: "Whole camp", or the chosen roles' names. */
export function audienceChipLabel(audience: {
  mode: "everyone" | "roles";
  roleNames: readonly string[];
}): string {
  if (audience.mode === "everyone") return "Whole camp";
  if (audience.roleNames.length === 0) return "Chosen roles";
  return audience.roleNames.join(", ");
}

/** One current member, as the form's reach count sees them. */
export interface ReachMember {
  role: MembershipRole;
  /** Role ids held with ACCEPTED consent. */
  roleIds: readonly string[];
}

/**
 * How many current members a meeting for this audience shows to — the same
 * rule as `canViewMeeting`: the chosen roles' holders plus the camp's leads
 * and co-leads (who see every meeting). An empty role list reaches only the
 * leads.
 */
export function meetingReach(
  members: readonly ReachMember[],
  audience: { mode: "everyone" | "roles"; roleIds: readonly string[] },
  baselineRoleId: string | null,
): { total: number; leads: number } {
  const leads = members.filter((m) => isPermissionBackstop(m.role)).length;
  if (audience.mode === "everyone") return { total: members.length, leads };
  const stored = {
    kind: "project" as const,
    groupId: "",
    mode: "roles" as const,
    roleIds: [...audience.roleIds],
  };
  const total = members.filter(
    (m) =>
      isPermissionBackstop(m.role) ||
      isInMeetingAudience(stored, new Set(m.roleIds), baselineRoleId),
  ).length;
  return { total, leads };
}

/** The calendar legend and day bands (frame G4). */
export const PHASE_LABEL: Record<ShiftPhase, string> = {
  build: "Build",
  event: "Event",
  strike: "Strike",
};

/** Tailwind classes for a phase band, one colour per phase. */
export const PHASE_BAND: Record<ShiftPhase, string> = {
  build: "bg-success/20 text-success",
  event: "bg-primary/20 text-primary",
  strike: "bg-warning/20 text-warning",
};

/** "April 2027" for `2027-04`. */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const name = m ? MONTH_NAMES[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : month;
}

/**
 * Which month the calendar opens on: `?month=` when it is one of the months
 * the switcher offers, else today's month when offered, else the first.
 */
export function pickCalendarMonth(
  months: readonly string[],
  requested: string | string[] | undefined,
  today: string,
): string {
  const want = typeof requested === "string" ? requested : null;
  if (want && months.includes(want)) return want;
  const current = today.slice(0, 7);
  if (months.includes(current)) return current;
  return months[0] ?? current;
}
