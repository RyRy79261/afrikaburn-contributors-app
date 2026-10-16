import { z } from "zod";

// Member records: lead notes and duplicate hints (docs/member-records-spec.md).
// This file is the VALIDATION authority for every member-records input
// crossing a server-action boundary; the storage authority is `member_notes`
// and `member_duplicate_dismissals` in @quagga/db schema.ts, and the rules
// live in @quagga/core member-records.ts.
//
// Every input names a camp by slug plus ids. Who may act — and whether the
// person a note is about belongs to that camp — is decided server-side from
// the session and the database, never from the payload.

/** A note's longest body, in characters (the DB CHECK says the same). */
export const MEMBER_NOTE_MAX = 2000;

const Slug = z.string().min(1).max(200);

/** A note's text: trimmed, never empty, at most {@link MEMBER_NOTE_MAX}. */
export const MemberNoteBody = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(MEMBER_NOTE_MAX, `A note is at most ${MEMBER_NOTE_MAX} characters.`);

/** Add a note about a member of a camp. */
export const AddMemberNoteInput = z
  .object({
    slug: Slug,
    subjectUserId: z.string().uuid(),
    body: MemberNoteBody,
  })
  .strict();
export type AddMemberNoteInput = z.infer<typeof AddMemberNoteInput>;

/** Rewrite one of your own notes. */
export const EditMemberNoteInput = z
  .object({
    slug: Slug,
    noteId: z.string().uuid(),
    body: MemberNoteBody,
  })
  .strict();
export type EditMemberNoteInput = z.infer<typeof EditMemberNoteInput>;

/** Delete a note (your own, or any as a lead). */
export const DeleteMemberNoteInput = z
  .object({
    slug: Slug,
    noteId: z.string().uuid(),
  })
  .strict();
export type DeleteMemberNoteInput = z.infer<typeof DeleteMemberNoteInput>;

/** "Not the same person": hide one possible-duplicate pair for the camp. */
export const DismissDuplicateInput = z
  .object({
    slug: Slug,
    userIds: z
      .tuple([z.string().uuid(), z.string().uuid()])
      .refine(([a, b]) => a.toLowerCase() !== b.toLowerCase(), {
        message: "Pick two different people.",
      }),
  })
  .strict();
export type DismissDuplicateInput = z.infer<typeof DismissDuplicateInput>;
