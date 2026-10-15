import { z } from "zod";
import { MeetingUrl } from "./notifications";

// Camp meetings and calendar (docs/camp-meetings-spec.md). This file is the
// VALIDATION authority for every meeting input crossing a server-action
// boundary; the storage authority is `camp_meetings` and
// `camp_meeting_attendees` in @quagga/db schema.ts, and the rules live in
// @quagga/core camp-meetings.ts.
//
// Every input names a camp by slug plus ids, a date, minutes and text. Who
// may act, and which meeting a viewer may see, is decided server-side from
// the session, never from the payload.
//
// TIME has no zone, exactly like shifts: a calendar date plus minutes after
// midnight plus a length, shown as the organiser typed it.

export const MEETING_TITLE_MAX = 120;
export const MEETING_LOCATION_MAX = 200;
export const MEETING_AGENDA_MAX = 20_000;
export const MEETING_NOTES_MAX = 50_000;
export const MEETING_MIN_DURATION = 5;
/** A meeting is at most a day long (the DB CHECK says the same). */
export const MEETING_MAX_DURATION = 24 * 60;
/** Roles one meeting may be addressed to. */
export const MEETING_MAX_ROLES = 100;

/**
 * Who a meeting is for, as stored on `camp_meetings.audience`. The
 * announcements shape (a `project` audience for the meeting's own camp,
 * `everyone` or chosen camp roles) without the narrowing filters: a meeting
 * is never addressed by tenure or structural role, so the stored value can
 * always be judged for one viewer from the roles they hold.
 */
export const MeetingAudience = z
  .object({
    kind: z.literal("project"),
    groupId: z.string().uuid(),
    mode: z.enum(["everyone", "roles"]),
    roleIds: z.array(z.string().uuid()).max(MEETING_MAX_ROLES),
  })
  .strict();
export type MeetingAudience = z.infer<typeof MeetingAudience>;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day written `YYYY-MM-DD` (no rollovers). */
export function isMeetingDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

const MeetingDate = z.string().refine(isMeetingDate, "Pick a day.");

/** Empty string from the form means "none". */
const OptionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));

const MeetingFields = {
  slug: z.string().min(1).max(200),
  title: z
    .string()
    .trim()
    .min(1, "Give the meeting a title.")
    .max(
      MEETING_TITLE_MAX,
      `Keep the title under ${MEETING_TITLE_MAX} characters.`,
    ),
  date: MeetingDate,
  startMinute: z.number().int().min(0).max(1439),
  durationMinutes: z
    .number()
    .int()
    .min(
      MEETING_MIN_DURATION,
      `A meeting is at least ${MEETING_MIN_DURATION} minutes.`,
    )
    .max(MEETING_MAX_DURATION, "A meeting is at most a day long."),
  location: OptionalText(MEETING_LOCATION_MAX, "That place is too long."),
  /** https only — never `javascript:`, `data:` or plain http. The scheme is
   * stored lower-case (`HTTPS://…` becomes `https://…`), so the DB's
   * `like 'https://%'` CHECK can never refuse a link this schema accepted. */
  videoLink: z
    .union([z.literal(""), MeetingUrl])
    .nullable()
    .default(null)
    .transform((v) => (v ? v.replace(/^https:/i, "https:") : null)),
  mode: z.enum(["everyone", "roles"]),
  roleIds: z.array(z.string().uuid()).max(MEETING_MAX_ROLES).default([]),
  agendaMd: z
    .string()
    .max(MEETING_AGENDA_MAX, "That agenda is too long.")
    .default(""),
};

/** Schedule a meeting. */
export const CreateMeetingInput = z.object(MeetingFields).strict();
export type CreateMeetingInput = z.input<typeof CreateMeetingInput>;

/** Edit a meeting's details: compare-and-set on the version it was read at. */
export const UpdateMeetingInput = z
  .object({
    ...MeetingFields,
    id: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export type UpdateMeetingInput = z.input<typeof UpdateMeetingInput>;

/** Cancel a meeting. It stays readable with its agenda and notes. */
export const CancelMeetingInput = z
  .object({
    slug: z.string().min(1).max(200),
    id: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export type CancelMeetingInput = z.input<typeof CancelMeetingInput>;

/** Save the meeting notes (markdown): compare-and-set on the version. */
export const SaveMeetingNotesInput = z
  .object({
    slug: z.string().min(1).max(200),
    id: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
    notesMd: z.string().max(MEETING_NOTES_MAX, "Those notes are too long."),
  })
  .strict();
export type SaveMeetingNotesInput = z.input<typeof SaveMeetingNotesInput>;

/**
 * Tick or untick one person on "Who came". A set operation, so two
 * note-takers ticking different people never conflict and needs no version.
 */
export const SetMeetingAttendanceInput = z
  .object({
    slug: z.string().min(1).max(200),
    id: z.string().uuid(),
    userId: z.string().uuid(),
    came: z.boolean(),
  })
  .strict();
export type SetMeetingAttendanceInput = z.input<
  typeof SetMeetingAttendanceInput
>;
