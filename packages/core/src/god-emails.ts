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

/**
 * Whether an authenticated session may be bootstrapped to `god`. The email must
 * be on the GOD_EMAILS list AND *verified* by the auth provider — a listed
 * address alone is not enough. Without the verified gate, any flow that lets a
 * user assert an unverified email (self-service sign-up, an unverified
 * email-change, or an OIDC provider asserting an attacker-controlled `email`
 * claim) matching a not-yet-registered god address would silently elevate an
 * attacker to the highest privilege in the system.
 */
export function canBootstrapGod(
  email: string | null | undefined,
  emailVerified: boolean,
  godEmails: readonly string[],
): boolean {
  if (!emailVerified) return false;
  return isGodEmailIn(email, godEmails);
}
