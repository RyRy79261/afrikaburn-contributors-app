import { gt, isNull, or, type SQL } from "drizzle-orm";
import { orgRoleAssignments } from "./schema";

/**
 * THE SQL HALF OF ACCESS EXPIRY (App Spec SEC-019): an `org_role_assignments`
 * row that still grants at `asOf`. Every query that loads assignments in order
 * to RESOLVE capabilities (the org session, the participant app's medical-notes
 * path) filters through this, so an expired assignment never reaches a resolver
 * at all. `@quagga/core` ignores expired grants again on top
 * (`isOrgRoleAssignmentLive`), with the same exclusive boundary: at exactly
 * `expires_at` the grant is gone.
 *
 * The clock is a PARAMETER, not `now()`: the column is a `timestamp` without a
 * time zone, written from a JS Date, and comparing it against a Date encoded the
 * same way is the comparison that cannot drift with the connection's TimeZone
 * setting.
 *
 * Screens that DISPLAY assignments (the accounts table) deliberately do not use
 * this — an expired role must read as expired, so a System manager can renew it.
 */
export function liveOrgRoleAssignment(asOf: Date): SQL {
  return or(
    isNull(orgRoleAssignments.expiresAt),
    gt(orgRoleAssignments.expiresAt, asOf),
  ) as SQL;
}
