import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// REGRESSION: the deletion path has to know about the rest of the product.
//
// Every case below is a live-data finding from 31 Jul 2026 on a DEPLOYED
// product, reachable through the participant app with no new code. They are
// source assertions because `lib/account.ts` and `lib/account-sanitize.ts` are
// `server-only` modules that talk to a database — the behaviour they encode is
// SQL, and the shape of that SQL is the guarantee.
//
// The common cause is one design decision: sanitization deliberately KEEPS the
// `users` row and every membership, so the camp's history survives. That is
// correct. What nobody carried through is that it makes two other things false:
// counting queries see tombstones as live people, and every `ON DELETE SET NULL`
// foreign key in the schema becomes a cascade that can never fire.

function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relative}`, import.meta.url)),
    "utf8",
  );
}

describe("the anti-lockout counts ignore tombstones", () => {
  const account = source("lib/account.ts");

  it("the sole-System-manager count excludes sanitized accounts", () => {
    // Gods A and B. A deletes — count is 2, allowed. A is sanitized, but A's
    // `god` MEMBERSHIP row survives by design, so the count is STILL 2 and B is
    // allowed too. Zero live System managers, a guard reporting two, and no
    // screen can recover it: the console is forbidden from ever granting `god`,
    // so the way back is an env change to GOD_EMAILS plus a fresh sign-up.
    const flat = account.replace(/\s+/g, " ");
    expect(flat).toContain(
      'eq(schema.memberships.role, "god"), isNull(schema.users.sanitizedAt)',
    );
    expect(flat).toContain(
      ".innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))",
    );
  });

  it("the sole-camp-lead count excludes sanitized accounts", () => {
    // The identical defect one level down, and it costs a camp rather than the
    // deployment: a camp whose only other lead was a tombstone read
    // `leadCount = 2`, so the last LIVE lead was never blocked.
    expect(account.replace(/\s+/g, " ")).toContain(
      "join ${schema.users} u2 on u2.id = m2.user_id where m2.group_id = ${schema.groups.id} and m2.role = 'lead' and u2.sanitized_at is null",
    );
  });
});

describe("sanitization releases what the account held for others", () => {
  const sanitize = source("lib/account-sanitize.ts");

  it("releases a claimed supplier listing", () => {
    // `suppliers.user_id` is `ON DELETE SET NULL` so the listing goes vacant —
    // except the FK never fires, because keeping the `users` row is the design.
    // The same human signing up again could then neither match by id (new uuid)
    // nor re-link by email overlap (the row is not unclaimed), so they were
    // `kind: 'unlinked'` forever while the console showed the supplier as
    // account-linked. Only a manual UPDATE fixed it.
    expect(sanitize).toContain(".update(schema.suppliers)");
    expect(sanitize.replace(/\s+/g, " ")).toContain(
      "set({ userId: null, updatedAt: now }) .where(eq(schema.suppliers.userId, userId))",
    );
  });

  it("vacates any wrangler assignment", () => {
    // schema.ts promises "the board shows it vacant, which is a thing someone
    // has to act on". It did not — the camp kept a non-null wrangler rendering
    // as "Departed Burner", and the (group, edition) unique index still read as
    // filled, so nothing flagged the camp as needing a new one.
    expect(sanitize.replace(/\s+/g, " ")).toContain(
      "set({ wranglerUserId: null, updatedAt: now })",
    );
  });

  it("revokes console access rather than leaving it on a dead account", () => {
    // `org_role_assignments` is keyed by MEMBERSHIP, so the memberships are
    // resolved first. The membership row itself stays — like every other
    // membership, the history is the point — demoted to `member`, the rank that
    // grants nothing.
    expect(sanitize).toContain(".delete(schema.orgRoleAssignments)");
    expect(sanitize).toContain("orgMembershipIds");
    expect(sanitize.replace(/\s+/g, " ")).toContain(
      '.update(schema.memberships) .set({ role: "member" })',
    );
  });

  it("still preserves memberships, bios rows and the audit trail", () => {
    // The releases above must not have turned into a cascade. Deleting these
    // would be the damage sanitization exists to avoid.
    expect(sanitize).not.toContain(".delete(schema.memberships)");
    expect(sanitize).not.toContain(".delete(schema.auditEvents)");
    expect(sanitize).not.toContain(".delete(schema.users)");
  });
});

describe("a tombstone stays reachable from the console", () => {
  it("searchAccounts can match the internal id", () => {
    // Sanitization nulls `email` and `username`, which were the only two things
    // the search matched — so a departed account could not be found by ANY term
    // and surfaced only if it fell in the 50 newest rows of the unfiltered list.
    const queries = readFileSync(
      fileURLToPath(new URL("../../../org/lib/queries.ts", import.meta.url)),
      "utf8",
    );
    expect(queries).toContain("ilike(sql`${schema.users.id}::text`, like)");
  });
});

describe("the guard is re-checked at the moment of erasure", () => {
  const sanitize = source("lib/account-sanitize.ts");

  it("sanitizeAccount re-assesses eligibility before it erases anything", () => {
    // The tombstone filters alone do NOT close the lockout, and an adversarial
    // review is what established that. Eligibility was assessed once, when the
    // request was created, and nothing re-asked:
    //
    //   Day 0 — System manager A requests deletion. B is live, count 2, allowed.
    //   Day 1 — B requests deletion. A is still live (nothing is sanitized until
    //           the grace period elapses), count still 2, allowed.
    //   Day 14 — the sweeper erases both. Zero live System managers.
    //
    // The property is about the FINAL state, so only a check at erasure time can
    // hold it. This hole predates the tombstone fix; the fix narrows it to the
    // overlapping case and this closes that.
    const before = sanitize.indexOf("assessDeletionEligibility");
    const erase = sanitize.indexOf("withTransaction");
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(erase);
  });

  it("a blocked account is LEFT PENDING, not failed and not force-erased", () => {
    // The request stays and the grace period has already elapsed, so the next
    // sweep retries and it proceeds by itself the moment someone else is granted
    // god or made a lead. Erasing anyway strands the deployment; cancelling the
    // request silently overturns a person's erasure decision, which is theirs.
    expect(sanitize).toContain("Still blocked at sanitization time");
    expect(sanitize).not.toContain('status: "cancelled"');
  });

  it("does not re-apply the sign-in-method guard at sweep time", () => {
    // That guard exists so nobody deletes an account they can no longer prove is
    // theirs — already proved when they asked. Re-applying it here would strand
    // every request whose last social link was revoked in the meantime.
    expect(sanitize.replace(/\s+/g, " ")).toContain("signInMethodCount: 1");
  });
});

describe("what was released is reconstructable", () => {
  const sanitize = source("lib/account-sanitize.ts");

  it("records the org roles, supplier listings and wrangler camps it let go", () => {
    // An earlier version of this file ASSERTED IN A COMMENT that these were
    // "audited by the row written below". They were not: the plan's audit meta
    // is built before the transaction and carries only counts. A System manager
    // asking "who held what before they left?" got nothing.
    expect(sanitize).toContain('"account.released_holdings"');
    for (const key of ["orgRoleIds", "supplierIds", "wranglerGroupIds"]) {
      expect(sanitize).toContain(key);
    }
  });

  it("records ids only — recording the release must not undo the erasure", () => {
    const block = sanitize.slice(
      sanitize.indexOf('"account.released_holdings"'),
      sanitize.indexOf('"account.released_holdings"') + 600,
    );
    for (const k of ["email", "username", "name"]) {
      expect(block).not.toContain(`${k}:`);
    }
  });
});

describe("account search cannot be swamped by the id clause", () => {
  it("matches the internal id only for an id-shaped term", () => {
    // A v4 uuid is 32 hex characters. Measured over 200k generated uuids: "a"
    // matches 89%, "e" 86%, and "4" matches 100% — it is the version nibble.
    // With ORDER BY created_at DESC LIMIT 50 and no ranking, searching "ab" for
    // "abbie" returned fifty unrelated newer accounts and not abbie, on the only
    // screen that can grant or revoke console access. Eight hex characters is
    // ~1 in 4 billion, and it is what someone types when they paste an id.
    const queries = readFileSync(
      fileURLToPath(new URL("../../../org/lib/queries.ts", import.meta.url)),
      "utf8",
    );
    expect(queries).toContain("const looksLikeId = /^[0-9a-f-]{8,}$/i.test(q)");
    // Both branches — the personal one and the username-only one.
    expect(queries.split("looksLikeId").length - 1).toBeGreaterThanOrEqual(3);
  });
});
