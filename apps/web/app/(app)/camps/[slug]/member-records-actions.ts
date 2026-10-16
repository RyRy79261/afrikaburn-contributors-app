"use server";

import { revalidatePath } from "next/cache";
import { requireCampUser } from "@/lib/session";
import {
  addMemberNote,
  deleteMemberNote,
  dismissDuplicate,
  editMemberNote,
  type MemberRecordsResult,
} from "@/lib/member-records-store";

// Member records server actions (docs/member-records-spec.md): the Private
// notes card on /burners/[id] and the roster's "Possible duplicate" popover.
//
// THIN ON PURPOSE. The session supplies the actor; everything else — the Zod
// parse, the camp, whether the actor is a note person (or a roster viewer for
// a dismissal), whether the person belongs to the camp — is decided by
// lib/member-records-store.ts from the database, under row locks, by the
// @quagga/core rules. Nothing in the payload is trusted for authority.

/** The roster's slug from an untrusted payload, for revalidation only. */
function slugOf(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const slug = (raw as { slug?: unknown }).slug;
  return typeof slug === "string" && /^[^/?#]{1,200}$/.test(slug) ? slug : null;
}

function revalidateRoster<T>(
  raw: unknown,
  result: MemberRecordsResult<T>,
): MemberRecordsResult<T> {
  const slug = slugOf(raw);
  if (result.ok && slug) revalidatePath(`/camps/${slug}/roster`);
  return result;
}

/** Add a private note about a member of the camp. */
export async function addMemberNoteAction(
  raw: unknown,
): Promise<MemberRecordsResult<{ noteId: string }>> {
  const user = await requireCampUser();
  return revalidateRoster(raw, await addMemberNote(user.id, raw));
}

/** Rewrite one of your own private notes. */
export async function editMemberNoteAction(
  raw: unknown,
): Promise<MemberRecordsResult> {
  const user = await requireCampUser();
  return revalidateRoster(raw, await editMemberNote(user.id, raw));
}

/** Delete a private note: your own, or any as a lead or co-lead. */
export async function deleteMemberNoteAction(
  raw: unknown,
): Promise<MemberRecordsResult> {
  const user = await requireCampUser();
  return revalidateRoster(raw, await deleteMemberNote(user.id, raw));
}

/** "Not the same person": hide a possible-duplicate pair for the camp. */
export async function dismissDuplicateAction(
  raw: unknown,
): Promise<MemberRecordsResult> {
  const user = await requireCampUser();
  return revalidateRoster(raw, await dismissDuplicate(user.id, raw));
}
