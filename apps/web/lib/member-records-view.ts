import type { DuplicateCandidate } from "@quagga/core";

// Pure shaping helpers for the member-records surfaces
// (docs/member-records-spec.md): the Private notes card (frame R1) and the
// roster's chips (frame R2). No React, no I/O — so the wording has a test.

/** "12 Oct 2026" — a note's calendar day in South African time. */
export function memberNoteDateLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

/** The note fields the card needs, from the store's view of a note. */
export interface MemberNoteLike {
  id: string;
  body: string;
  unreadable: boolean;
  authorName: string;
  createdAt: Date;
  edited: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/** One note as the client card receives it: the server's verdicts and a
 * formatted day — no author id, no subject id, nothing the card could use to
 * decide anything for itself. */
export interface PrivateNoteItemView {
  id: string;
  body: string;
  /** Stored but undecryptable: the card says so instead of showing text. */
  unreadable: boolean;
  authorName: string;
  dateLabel: string;
  edited: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/** Shape the store's notes for the Private notes card, keeping their order
 * (newest first, as loaded). */
export function toPrivateNoteItems(
  notes: readonly MemberNoteLike[],
): PrivateNoteItemView[] {
  return notes.map((n) => ({
    id: n.id,
    body: n.body,
    unreadable: n.unreadable,
    authorName: n.authorName,
    dateLabel: memberNoteDateLabel(n.createdAt),
    edited: n.edited,
    canEdit: n.canEdit,
    canDelete: n.canDelete,
  }));
}

/** The popover's sentence for one flagged pair (frame R2):
 * "Thandi Mokoena and Thandi Mokoena-Dube have similar names. They may be one
 * person with two accounts." */
export function duplicateHintSentence(
  name: string,
  other: DuplicateCandidate,
): string {
  return `${other.name} and ${name} have similar names. They may be one person with two accounts.`;
}
