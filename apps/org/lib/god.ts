// GOD_EMAILS bootstrap (build-spec §Environment: "comma list — grants god on
// first login"). The pure parsing lives in @quagga/core (parseGodEmails,
// isGodEmailIn) so apps/web and apps/org share one implementation; this module
// keeps only the thin env-reading convenience (core must not touch process.env).
//
// The org app applies the bootstrap in `resolveOrgSession`: any signed-in user
// whose email is on this list is ensured a `god` membership on the seeded org
// group.

import { canBootstrapGod, isGodEmailIn, parseGodEmails } from "@quagga/core";

export { parseGodEmails, isGodEmailIn, canBootstrapGod };

/** Convenience: reads `process.env.GOD_EMAILS`. */
export function isGodEmail(email: string | null | undefined): boolean {
  return isGodEmailIn(email, parseGodEmails(process.env.GOD_EMAILS));
}

/**
 * Convenience: whether a session may be bootstrapped to god — the email must be
 * VERIFIED and on `process.env.GOD_EMAILS`. Gates the highest privilege in the
 * system against unverified / attacker-asserted email claims.
 */
export function canBootstrapGodEmail(
  email: string | null | undefined,
  emailVerified: boolean,
): boolean {
  return canBootstrapGod(
    email,
    emailVerified,
    parseGodEmails(process.env.GOD_EMAILS),
  );
}
