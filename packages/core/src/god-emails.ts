// GOD_EMAILS bootstrap parsing (build-spec §Environment: "comma list — grants
// god on first login"). Pure string logic so it is unit-testable without env
// and shareable across apps/web and apps/org. Reading process.env is an app
// concern (core must not touch process.env) — apps wrap these with a thin
// env-reading convenience.

/** Parse a comma-separated GOD_EMAILS list into normalised (trimmed, lowercased) emails. */
export function parseGodEmails(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/** Whether `email` is on the given god-email list (case-insensitive). */
export function isGodEmailIn(
  email: string | null | undefined,
  godEmails: readonly string[],
): boolean {
  if (!email) return false;
  return godEmails.includes(email.trim().toLowerCase());
}
