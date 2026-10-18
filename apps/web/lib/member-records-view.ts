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

/** The member-notes export route for one member of one camp (#105). */
export function memberNotesExportHref(slug: string, userId: string): string {
  return `/camps/${encodeURIComponent(slug)}/member-notes/${encodeURIComponent(userId)}/export`;
}

/** The filename the export route named in Content-Disposition — only the
 * slugified shape it ever sends; anything else falls back. */
export function exportFilenameFrom(header: string | null): string {
  const match = header?.match(/filename="([a-z0-9-]{1,200}\.txt)"/);
  return match?.[1] ?? "member-notes.txt";
}

/** What the card toasts when the export is refused as "not found" (a lead
 * whose access changed since the page loaded). */
export const EXPORT_REFUSED = "These notes can't be exported.";

/**
 * Is this export response the FILE? Only a 200 that the route marked as an
 * attachment. Anything else — a refusal, a redirect (the questionnaire gate,
 * a lapsed session: fetched with `redirect: "manual"`, so it arrives as an
 * opaque status 0), an HTML page — is not saved as a file and not toasted as
 * a success.
 */
export function exportResponseOutcome(res: {
  status: number;
  contentDisposition: string | null;
}): "file" | "unavailable" | "refused" {
  if (
    res.status === 200 &&
    (res.contentDisposition ?? "").startsWith("attachment;")
  ) {
    return "file";
  }
  return res.status === 503 ? "unavailable" : "refused";
}

/** What a member-records action says when the call itself fails. */
export const ACTION_FAILED =
  "That didn't go through. Check your connection and try again.";

/**
 * Run a member-records server action so a REJECTED call (a dropped
 * connection, a server crash) comes back as an ordinary refusal the caller
 * toasts, instead of escaping the transition as an unhandled error with no
 * word to the person who clicked.
 */
export async function settleAction<T extends { ok: boolean }>(
  call: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    return await call();
  } catch {
    return { ok: false, error: ACTION_FAILED };
  }
}
