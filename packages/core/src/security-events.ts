// Security events — display mapping for the account "recent security events" feed
// (docs/accounts-security-spec.md §"recent security events").
//
// PURITY CONTRACT (as with the rest of @quagga/core): no I/O, no env, no DB. The
// `security_events` table stores only the typed `kind` (plus request context);
// the human-readable title lives HERE so the DB carries no display strings and a
// wording change never needs a migration. The app composes any device/IP detail
// line itself (it owns the user-agent parser) — this module owns the title only.

import type { SecurityEventLogKind } from "@quagga/types";

/**
 * The one-line title shown for each security event kind. Plain, past-tense, and
 * account-owner-facing — these describe something that already happened.
 */
export const SECURITY_EVENT_TITLES: Readonly<
  Record<SecurityEventLogKind, string>
> = {
  password_changed: "Password changed",
  password_reset_completed: "Password reset completed",
  session_revoked: "A device was signed out",
  sessions_revoked_others: "Signed out of all other devices",
  email_change_requested: "Sign-in email change requested",
  email_change_confirmed: "Sign-in email change confirmed",
  email_change_revoked: "Sign-in email change reversed",
  deletion_requested: "Account deletion requested",
  deletion_cancelled: "Account deletion cancelled",
};

/** The display title for a security event kind. */
export function describeSecurityEvent(kind: SecurityEventLogKind): string {
  return SECURITY_EVENT_TITLES[kind];
}
