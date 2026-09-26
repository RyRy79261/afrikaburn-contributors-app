import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { liveOrgRoleAssignment } from "../org-role-expiry";

// ACCESS EXPIRY (SEC-019): the one SQL predicate every capability-resolving
// loader filters `org_role_assignments` through. Rendered, not executed — the
// real-database proof is `pnpm e2e:local` — but the rendering pins the three
// things that matter: a null expiry still grants, the comparison is STRICTLY
// greater (at exactly `expires_at` the grant is gone, as in @quagga/core), and
// the clock is the caller's parameter rather than the connection's `now()`.

describe("liveOrgRoleAssignment", () => {
  const asOf = new Date("2027-05-02T22:00:00.000Z");
  const query = new PgDialect().sqlToQuery(liveOrgRoleAssignment(asOf));

  it("keeps rows with no expiry, and rows expiring strictly after the clock", () => {
    expect(query.sql).toBe(
      '("org_role_assignments"."expires_at" is null or "org_role_assignments"."expires_at" > $1)',
    );
  });

  it("binds the caller's clock, not the database's", () => {
    expect(query.sql).not.toMatch(/now\(\)/i);
    expect(query.params).toHaveLength(1);
    expect(String(query.params[0])).toContain("2027-05-02");
  });
});
