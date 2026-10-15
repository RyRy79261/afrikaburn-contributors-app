"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { meetingPath, meetingRefusalMessage } from "@quagga/core";
import { getActiveEdition } from "@/lib/edition";
import { requireCampUser } from "@/lib/session";
import {
  cancelCampMeeting,
  createCampMeeting,
  saveCampMeetingNotes,
  setCampMeetingAttendance,
  updateCampMeeting,
  type MeetingEdition,
} from "@/lib/camp-meetings-store";

// Camp meeting actions (docs/camp-meetings-spec.md). Thin on purpose: WHO the
// caller is comes from the session, and everything else — the Zod parse of
// the whole input, the caller's membership (locked), whether they may see and
// change the meeting, the compare-and-set — happens inside the store's
// transaction over facts it reads itself. A non-member, a former member, a
// member outside the audience and an unknown id all get "That meeting
// doesn't exist.".
//
// NOTES SAVES DO NOT REVALIDATE: they show nowhere but the meeting page,
// which is dynamic; the editor refreshes it itself once "Save notes" lands.

export type MeetingActionResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

/** A notes save's answer; `conflict` marks "someone else saved first". */
export type SaveNotesResult =
  | { ok: true; version: number }
  | { ok: false; error: string; conflict?: boolean };

const NO_EDITION = "No active edition is configured.";
const STALE = meetingRefusalMessage("stale");

const Target = z.object({
  slug: z.string().min(1).max(200),
  id: z.string().uuid().optional(),
});

/** The active edition as the store needs it, or null. */
async function activeEdition(): Promise<MeetingEdition | null> {
  const edition = await getActiveEdition();
  return edition
    ? {
        id: edition.id,
        startDate: edition.startDate,
        endDate: edition.endDate,
      }
    : null;
}

/** Refreshes the list, the calendar, the camp page tile and one meeting. */
function revalidate(raw: unknown, id?: string) {
  const t = Target.safeParse(raw);
  if (!t.success) return;
  const { slug } = t.data;
  revalidatePath(`/camps/${slug}`);
  revalidatePath(`/camps/${slug}/meetings`);
  revalidatePath(`/camps/${slug}/calendar`);
  const meetingId = id ?? t.data.id;
  if (meetingId) revalidatePath(meetingPath(slug, meetingId));
}

/** "Schedule meeting" — the people it is for get a notice. */
export async function createMeetingAction(
  raw: unknown,
): Promise<MeetingActionResult<{ id: string }>> {
  const user = await requireCampUser();
  const edition = await activeEdition();
  if (!edition) return { ok: false, error: NO_EDITION };
  const r = await createCampMeeting(user.id, edition, raw);
  if (!r.ok) return r;
  revalidate(raw, r.id);
  return { ok: true, id: r.id };
}

/** "Save changes" on the edit page — compare-and-set on the version. */
export async function updateMeetingAction(
  raw: unknown,
): Promise<MeetingActionResult<{ version: number }>> {
  const user = await requireCampUser();
  const edition = await activeEdition();
  if (!edition) return { ok: false, error: NO_EDITION };
  const r = await updateCampMeeting(user.id, edition, raw);
  if (!r.ok) return r;
  revalidate(raw);
  return { ok: true, version: r.version };
}

/** "Cancel meeting" — it stays readable; the people it was for are told. */
export async function cancelMeetingAction(
  raw: unknown,
): Promise<MeetingActionResult<{ version: number }>> {
  const user = await requireCampUser();
  const edition = await activeEdition();
  if (!edition) return { ok: false, error: NO_EDITION };
  const r = await cancelCampMeeting(user.id, edition, raw);
  if (!r.ok) return r;
  revalidate(raw);
  return { ok: true, version: r.version };
}

/** "Save notes": one compare-and-set write. "Someone else saved first" comes
 * back as a conflict, so the editor keeps the text and offers a reload. */
export async function saveMeetingNotesAction(
  raw: unknown,
): Promise<SaveNotesResult> {
  const user = await requireCampUser();
  const edition = await activeEdition();
  if (!edition) return { ok: false, error: NO_EDITION };
  const r = await saveCampMeetingNotes(user.id, edition, raw);
  if (r.ok) return { ok: true, version: r.version };
  if (r.error === STALE) {
    return { ok: false, error: r.error, conflict: true };
  }
  return r;
}

/** Tick or untick one person on "Who came". */
export async function setMeetingAttendanceAction(
  raw: unknown,
): Promise<MeetingActionResult> {
  const user = await requireCampUser();
  const edition = await activeEdition();
  if (!edition) return { ok: false, error: NO_EDITION };
  const r = await setCampMeetingAttendance(user.id, edition, raw);
  if (!r.ok) return r;
  revalidate(raw);
  return { ok: true };
}
