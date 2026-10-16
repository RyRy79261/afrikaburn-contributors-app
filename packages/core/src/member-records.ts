// Member records: lead notes and duplicate hints (docs/member-records-spec.md).
// PURE — no I/O, no env, no DB. The store (apps/web/lib/member-records-store.ts)
// loads every fact these functions read from the database; a request names a
// camp by slug and a person or a note by id, and nothing else.
//
// WHO KEEPS NOTES. A camp's structural leads and co-leads (the irrevocable
// backstop) and members holding the `member_notes` privilege — "note people".
// Nobody else in the camp, never the org (a god or org staff member holds no
// camp permission by being org), never public.
//
// WHO A NOTE IS ABOUT. A current or archived member of THIS camp — archive
// keeps notes because people come back. Anyone else (a stranger, a member of
// another camp, someone who left, an erased account) is refused exactly as
// an unknown id is: "not found". A note person never reads or writes notes
// about THEMSELVES: the member does not see notes about them (POPIA access
// is the working group's question, #105), and a lead is a member too.
//
// EDIT AND DELETE. The author edits and deletes their own notes while they are
// still a note person. Structural leads and co-leads may delete any note of
// their camp (a welfare lead who leaves the camp must not leave behind notes
// nobody may remove). Nobody edits another person's words.
//
// DUPLICATE HINTS. Two current members of one camp whose roster names are
// similar (`isSimilarName`, the pg_trgm-equivalent trigram similarity) are a
// "possible duplicate" — a hint only, computed on read and never stored. ONLY
// names are compared: phone, ID numbers, emergency contacts and every other
// hard-locked field are never read for this (./privacy). Hints are shown to,
// and dismissed by, roster viewers (`view_member_details`). A dismissal is
// stored per ordered pair per camp, so the same two people are not flagged
// again.
//
// PRIVACY. Notes never appear in the roster table (a COUNT for note people
// only), a CSV export, stats, search, the org console or a notification.
// Audit rows carry ids only, never the text.

import type { GroupKind } from "@quagga/types";
import { isProjectKind } from "@quagga/types";
import {
  hasProjectPermission,
  isPermissionBackstop,
  type PermissionMembership,
} from "./project-permissions";
import { isSimilarName } from "./name-dedupe";

// --- Constants ---------------------------------------------------------------

/** Audit action names, written in the same transaction as the change. The
 * row's `meta` holds ids only — never a note's text. */
export const MEMBER_RECORDS_AUDIT = {
  noteCreate: "camp.member_note.create",
  noteUpdate: "camp.member_note.update",
  noteDelete: "camp.member_note.delete",
  duplicateDismiss: "camp.member_duplicate.dismiss",
} as const;

/**
 * Every member-records audit action. Camp-private: the org console's audit
 * readers (`/audit`, the overview activity feed) exclude them IN THE QUERY,
 * whatever the reader's rank — "never the org console" (spec §Rules). Even
 * without the text, a row says that a named lead keeps notes, and when.
 */
export const MEMBER_RECORDS_AUDIT_ACTIONS: readonly string[] =
  Object.values(MEMBER_RECORDS_AUDIT);

/** The line the note form shows under the box (spec §Surfaces). */
export const MEMBER_NOTES_AUDIENCE_NOTE =
  "Only the camp's leads and note-keepers see these. The member can request them under POPIA.";

// --- Access ------------------------------------------------------------------

/** Member records belong to every project (theme camp, artwork, mutant
 * vehicle) — the kinds that have a roster — never to the org group. */
export function memberRecordsAvailableForGroup(kind: GroupKind): boolean {
  return isProjectKind(kind);
}

/**
 * May this member read and write the camp's private notes? Structural lead or
 * co-lead (the backstop), or a `member_notes` grant. `null` is "not a current
 * member of this camp", which is always no — so a lead of camp A gets nothing
 * in camp B, and an org account gets nothing anywhere.
 */
export function canManageMemberNotes(
  membership: PermissionMembership | null,
): boolean {
  return membership !== null && hasProjectPermission(membership, "member_notes");
}

/**
 * May the viewer see the "possible duplicate" hints on this camp's roster,
 * and dismiss one? A roster viewer (`view_member_details`; leads always).
 */
export function canSeeDuplicateHints(
  membership: PermissionMembership | null,
): boolean {
  return (
    membership !== null &&
    hasProjectPermission(membership, "view_member_details")
  );
}

/** The viewer, as the store resolved them for ONE camp. */
export interface MemberNotesViewer {
  userId: string;
  /** Null: not a current member (archived, erased or never joined). */
  membership: PermissionMembership | null;
}

/** The person a note is about, as the store found them in THIS camp. */
export interface MemberNoteSubject {
  userId: string;
  /** A membership row of this camp exists — current OR archived — on an
   * account that is not erased. False for everyone else. */
  inCamp: boolean;
}

/**
 * May the viewer read the notes about this person (and add one)? A note
 * person of the camp, about a current or archived member of it, who is not
 * themselves.
 */
export function canReadMemberNotes(
  viewer: MemberNotesViewer,
  subject: MemberNoteSubject,
): boolean {
  if (!canManageMemberNotes(viewer.membership)) return false;
  if (!subject.inCamp) return false;
  return subject.userId !== viewer.userId;
}

/** A stored note, as far as the edit/delete rules care. */
export interface MemberNoteFacts {
  authorUserId: string | null;
  subjectUserId: string;
}

/** May the viewer rewrite this note? Only its author, while a note person
 * of the camp. Nobody edits another person's words. */
export function canEditMemberNote(
  viewer: MemberNotesViewer,
  note: MemberNoteFacts,
): boolean {
  if (!canManageMemberNotes(viewer.membership)) return false;
  if (note.subjectUserId === viewer.userId) return false;
  return note.authorUserId !== null && note.authorUserId === viewer.userId;
}

/** May the viewer delete this note? Its author (while a note person), or a
 * structural lead or co-lead of the camp — never about themselves. */
export function canDeleteMemberNote(
  viewer: MemberNotesViewer,
  note: MemberNoteFacts,
): boolean {
  const m = viewer.membership;
  if (m === null || !canManageMemberNotes(m)) return false;
  if (note.subjectUserId === viewer.userId) return false;
  if (note.authorUserId !== null && note.authorUserId === viewer.userId)
    return true;
  return isPermissionBackstop(m.structuralRole);
}

// --- Decisions -----------------------------------------------------------------

/** Why a member-records write was refused. */
export type MemberRecordsRefusal =
  | "not_found"
  | "note_not_found"
  | "not_your_note"
  | "not_a_duplicate";

/** A write decision: go ahead, or one reason. */
export type MemberRecordsDecision =
  | { ok: true }
  | { ok: false; reason: MemberRecordsRefusal };

const refuse = (reason: MemberRecordsRefusal): MemberRecordsDecision => ({
  ok: false,
  reason,
});

/** The one sentence a refusal shows. "Not found" is the same answer a
 * person who is not in the camp, or a camp that does not exist, gets. */
export function memberRecordsRefusalMessage(
  reason: MemberRecordsRefusal,
): string {
  switch (reason) {
    case "not_found":
      return "That person isn't in this camp.";
    case "note_not_found":
      return "That note doesn't exist.";
    case "not_your_note":
      return "Only the person who wrote a note can change it.";
    case "not_a_duplicate":
      return "Those two aren't flagged as a possible duplicate.";
  }
}

/** Add a note about `subject`. */
export function decideAddMemberNote(
  viewer: MemberNotesViewer,
  subject: MemberNoteSubject,
): MemberRecordsDecision {
  return canReadMemberNotes(viewer, subject)
    ? { ok: true }
    : refuse("not_found");
}

/**
 * Edit a note. `note` is null when no note with that id exists IN THIS CAMP.
 * A viewer who is no note person gets "not found" whatever the id, so the
 * write is no oracle for which notes exist.
 */
export function decideEditMemberNote(
  viewer: MemberNotesViewer,
  note: MemberNoteFacts | null,
): MemberRecordsDecision {
  if (!canManageMemberNotes(viewer.membership)) return refuse("not_found");
  if (!note || note.subjectUserId === viewer.userId)
    return refuse("note_not_found");
  return canEditMemberNote(viewer, note) ? { ok: true } : refuse("not_your_note");
}

/** Delete a note; the same shape as {@link decideEditMemberNote}. */
export function decideDeleteMemberNote(
  viewer: MemberNotesViewer,
  note: MemberNoteFacts | null,
): MemberRecordsDecision {
  if (!canManageMemberNotes(viewer.membership)) return refuse("not_found");
  if (!note || note.subjectUserId === viewer.userId)
    return refuse("note_not_found");
  return canDeleteMemberNote(viewer, note)
    ? { ok: true }
    : refuse("not_your_note");
}

// --- Duplicate hints -----------------------------------------------------------

/** A current member as the duplicate check sees them: an id and the name the
 * roster shows. Nothing else is ever compared. */
export interface DuplicateCandidate {
  userId: string;
  name: string;
}

/** One possible-duplicate pair, ordered by user id. */
export interface DuplicatePair {
  userIds: [string, string];
  names: [string, string];
}

/**
 * The two ids in the order a dismissal stores them (`user_a < user_b`, the DB
 * CHECK). Lowercased first: Postgres orders uuids by their bytes, which is the
 * order of their lowercase hex.
 */
export function orderedUserPair(a: string, b: string): [string, string] {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? [x, y] : [y, x];
}

/** A stable key for an unordered pair of user ids. */
export function duplicatePairKey(a: string, b: string): string {
  const [x, y] = orderedUserPair(a, b);
  return `${x}:${y}`;
}

/** Names that say nothing about who someone is (the placeholders
 * `publicMemberName` uses) are never compared. */
const PLACEHOLDER_NAMES = new Set(["unnamed burner", "departed burner"]);

function comparableName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (PLACEHOLDER_NAMES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/**
 * Every pair of current members whose names are similar, minus the pairs the
 * camp dismissed. The caller passes CURRENT members of ONE camp on accounts
 * that are not erased; a placeholder name is skipped. Pairs come back in a
 * stable order (by the first name, then the second).
 */
export function findDuplicatePairs(
  members: readonly DuplicateCandidate[],
  dismissed: Iterable<readonly [string, string]> = [],
): DuplicatePair[] {
  const hidden = new Set<string>();
  for (const [a, b] of dismissed) hidden.add(duplicatePairKey(a, b));
  const seen = new Set<string>();
  const people: { userId: string; name: string }[] = [];
  for (const m of members) {
    const name = comparableName(m.name);
    const id = m.userId.toLowerCase();
    if (!name || seen.has(id)) continue;
    seen.add(id);
    people.push({ userId: id, name });
  }
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const p = people[i]!;
      const q = people[j]!;
      if (hidden.has(duplicatePairKey(p.userId, q.userId))) continue;
      if (!isSimilarName(p.name, q.name)) continue;
      const [first, second] = p.userId < q.userId ? [p, q] : [q, p];
      pairs.push({
        userIds: [first.userId, second.userId],
        names: [first.name, second.name],
      });
    }
  }
  return pairs.sort(
    (x, y) =>
      x.names[0].localeCompare(y.names[0]) ||
      x.names[1].localeCompare(y.names[1]),
  );
}

/** For each flagged member, the other member(s) they may duplicate. */
export function duplicatesByUser(
  pairs: readonly DuplicatePair[],
): Map<string, DuplicateCandidate[]> {
  const out = new Map<string, DuplicateCandidate[]>();
  const add = (userId: string, other: DuplicateCandidate) => {
    const list = out.get(userId) ?? [];
    list.push(other);
    out.set(userId, list);
  };
  for (const { userIds, names } of pairs) {
    add(userIds[0], { userId: userIds[1], name: names[1] });
    add(userIds[1], { userId: userIds[0], name: names[0] });
  }
  return out;
}

/**
 * Dismiss a pair ("Not the same person"). A roster viewer may, and only for
 * two CURRENT members of the camp whose names are in fact similar — so a
 * dismissal row can never be planted about arbitrary people.
 */
export function decideDismissDuplicate(input: {
  membership: PermissionMembership | null;
  /** Both people, as found among the camp's current members (null = not). */
  pair: [DuplicateCandidate | null, DuplicateCandidate | null];
}): MemberRecordsDecision {
  if (!canSeeDuplicateHints(input.membership)) return refuse("not_found");
  const [a, b] = input.pair;
  if (!a || !b) return refuse("not_found");
  if (a.userId.toLowerCase() === b.userId.toLowerCase())
    return refuse("not_a_duplicate");
  return findDuplicatePairs([a, b]).length === 1
    ? { ok: true }
    : refuse("not_a_duplicate");
}
