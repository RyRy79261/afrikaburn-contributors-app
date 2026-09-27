import { isNotNull, isNull, type SQL } from "drizzle-orm";
import { memberships } from "./schema";

/**
 * THE SQL HALF OF "ARCHIVING REVOKES CAMP ACCESS" (App Spec CDB-036, decided
 * 2026-09-27 on #55): a `memberships` row that still makes its user a member.
 *
 * An archived row is kept as the camp's history — roles held, logistics,
 * questionnaire responses — but it is NO membership to anything that decides
 * access or reach: the viewer's role, the roster, the camp page's member list,
 * announcement and questionnaire audiences, campmate and messaging rules, the
 * safety audience for medical notes, officer-slot counts, member counts. Every
 * such query filters through this, exactly as the org session filters role
 * assignments through `liveOrgRoleAssignment`.
 *
 * A query that deliberately reads former members too (ref-code allocation, the
 * unique-constraint lookups a re-invite depends on, account sanitisation, the
 * "Former members" list itself) says so in a `former members:` comment on the
 * query — `apps/web/lib/__tests__/membership-archive-guard.test.ts` fails the
 * build on any membership query that does neither.
 */
export function activeMembership(): SQL {
  return isNull(memberships.archivedAt);
}

/** The complement: a membership the camp has archived (a former member). */
export function formerMembership(): SQL {
  return isNotNull(memberships.archivedAt);
}
