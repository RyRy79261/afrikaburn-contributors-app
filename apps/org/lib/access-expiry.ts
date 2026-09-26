// ACCESS EXPIRY, AS A PERSON TYPES IT (App Spec SEC-019).
//
// The column is an instant (`org_role_assignments.expires_at`); the assignment
// dialog asks for a DAY — "last day of access" — because that is how a seasonal
// grant is thought about ("until the end of build week"), and an instant would
// invite someone to give a colleague access until 00:00 on the day they meant
// to include.
//
// So a day is INCLUSIVE and read in South African time: "last day 10 May 2027"
// means the grant works through 23:59:59 SAST on 10 May and stops at 00:00 SAST
// on 11 May. SAST is a fixed UTC+2 with no daylight saving, which is what makes
// a constant offset correct rather than an approximation. The deployment, the
// event and the people granting access are all there.
//
// Pure and dependency-free on purpose: the server action validates with it and
// the client dialog renders with it, so the day a manager picks and the instant
// the server stores cannot be computed two ways. The clock is always passed in.

/** SAST — UTC+2, no daylight saving. */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar day as the `<input type="date">` value carries it. */
export const LAST_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The instant access STOPS for an inclusive last day, or null when the string
 * is not a real calendar day (`2027-02-30` is refused rather than rolled over
 * into March — a typo must not quietly grant two extra days).
 */
export function expiryFromLastDay(lastDay: string): Date | null {
  if (!LAST_DAY_PATTERN.test(lastDay)) return null;
  const startUtc = Date.parse(`${lastDay}T00:00:00Z`);
  if (Number.isNaN(startUtc)) return null;
  if (new Date(startUtc).toISOString().slice(0, 10) !== lastDay) return null;
  // Midnight SAST that STARTS the last day, plus one day.
  return new Date(startUtc - SAST_OFFSET_MS + DAY_MS);
}

/**
 * The inclusive last day (SAST) an expiry instant corresponds to — the inverse
 * of `expiryFromLastDay`. The last millisecond of access is what is dated, so
 * an expiry at exactly SAST midnight reads as the day before it.
 */
export function lastDayFromExpiry(expiresAt: Date): string {
  return new Date(expiresAt.getTime() - 1 + SAST_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/** Today's date in SAST, as a date input's `min`. */
export function todayInSast(now: Date): string {
  return new Date(now.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "10 May 2027" — how an expiry is shown. Fixed locale so server and client
 * render the same string. */
export function formatLastDay(lastDay: string): string {
  const d = new Date(`${lastDay}T00:00:00Z`);
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** One requested expiry, as the assignment dialog sends it. */
export interface RequestedExpiry {
  roleId: string;
  /** Inclusive last day of access, `YYYY-MM-DD`; null means no expiry. */
  lastDay: string | null;
}

/**
 * THE WRITE RULE for a set of assignment expiries. Returns the instant each
 * assigned role stops granting (null = never), or a caller-safe refusal.
 *
 *  · An expiry must be for a role actually being assigned.
 *  · A NEW or CHANGED expiry must lie in the future: granting access that has
 *    already ended is a mistake, not a grant, and saying so beats storing a row
 *    that silently does nothing.
 *  · An expiry that is UNCHANGED from what is stored is kept even when it has
 *    passed. That is what lets a System manager edit someone's other roles
 *    without being forced to either renew or delete an expired one they have
 *    not decided about yet — the expired row stays visible, as expired.
 */
export function resolveAssignmentExpiries(input: {
  roleIds: readonly string[];
  expiries: readonly RequestedExpiry[];
  /** What is stored now, per role id, for this membership. */
  stored: ReadonlyMap<string, Date | null>;
  now: Date;
}):
  | { ok: true; expiries: Map<string, Date | null> }
  | { ok: false; error: string } {
  const assigned = new Set(input.roleIds);
  const out = new Map<string, Date | null>();
  for (const id of assigned) out.set(id, null);

  for (const e of input.expiries) {
    if (!assigned.has(e.roleId)) {
      return {
        ok: false,
        error: "An expiry was set for a role that is not being assigned.",
      };
    }
    if (e.lastDay === null) {
      out.set(e.roleId, null);
      continue;
    }
    const expiresAt = expiryFromLastDay(e.lastDay);
    if (!expiresAt) {
      return { ok: false, error: `"${e.lastDay}" is not a date.` };
    }
    // Compared as the DAY the dialog showed, not as instants, so a stored value
    // that is not exactly SAST midnight (written by anything but this path)
    // still round-trips as unchanged — and is then kept exactly as stored.
    const previous = input.stored.get(e.roleId) ?? null;
    if (previous !== null && lastDayFromExpiry(previous) === e.lastDay) {
      out.set(e.roleId, previous);
      continue;
    }
    if (expiresAt.getTime() <= input.now.getTime()) {
      return {
        ok: false,
        error: `The last day of access (${formatLastDay(e.lastDay)}) has already passed. Pick a later day, or clear it for access with no end date.`,
      };
    }
    out.set(e.roleId, expiresAt);
  }
  return { ok: true, expiries: out };
}
