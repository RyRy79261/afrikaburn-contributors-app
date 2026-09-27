import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { activeMembership, formerMembership } from "../membership-archive";

// FORMER MEMBERS (CDB-036): the one SQL predicate every access-deciding
// membership query filters through. Rendered, not executed — the
// real-database proof is `pnpm e2e:local` — but the rendering pins which
// column and which direction: a CURRENT member is `archived_at is null`.

describe("activeMembership / formerMembership", () => {
  const dialect = new PgDialect();

  it("a current membership is one with no archived_at", () => {
    expect(dialect.sqlToQuery(activeMembership()).sql).toBe(
      '"memberships"."archived_at" is null',
    );
  });

  it("a former membership is one with an archived_at", () => {
    expect(dialect.sqlToQuery(formerMembership()).sql).toBe(
      '"memberships"."archived_at" is not null',
    );
  });

  it("binds nothing — there is no clock or input to get wrong", () => {
    expect(dialect.sqlToQuery(activeMembership()).params).toEqual([]);
  });
});
