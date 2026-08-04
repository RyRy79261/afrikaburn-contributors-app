import { describe, it, expect } from "vitest";
import {
  SEEDED_ORG_DEPARTMENTS,
  SEEDED_ORG_ROLES,
  normalizeName,
} from "@quagga/core";
import { ensureSeededOrgRoles, ensureSeededOrgDepartments } from "../seed";
import { createFakeDb, type RecordedOp } from "./support/fake-db";

// These two helpers exist SOLELY to repair an already-seeded production
// database, which is the one path no local run ever takes: a fresh local DB has
// no edition, so migrate.ts always goes down the other branch. Nothing here has
// ever been exercised by a developer machine.
//
// Both take their `db` as a parameter, so the fake goes straight in — no module
// mocking. The statements themselves are not proven valid SQL here (see
// ./support/fake-db); what is proven is which writes happen and which do not.

type Answer = (op: RecordedOp) => unknown[];

/** Every insert reports "already there"; nothing is created. */
const SEEDED_ALREADY: Answer = (op) =>
  op.kind === "select" && op.table === "org_departments"
    ? [{ id: `existing-${op.where[0]?.value}` }]
    : [];

/** Every insert reports a fresh row; the database predates the feature. */
const EMPTY_DATABASE: Answer = (op) =>
  op.kind === "insert" ? [{ id: `new-${op.values[0]?.key ?? "row"}` }] : [];

function run(answer: Answer) {
  const fake = createFakeDb(answer);
  return { fake, db: fake.db as Parameters<typeof ensureSeededOrgRoles>[0] };
}

describe("ensureSeededOrgRoles", () => {
  it("INSERTS-IF-MISSING on `key` and never updates", async () => {
    // The org console's permissions ARE these rows. A System manager who has
    // re-righted the Engineer role must keep that edit — "idempotent" has to
    // mean "safe to run twice", not "reverts the org's own decisions on every
    // deploy". An `onConflictDoUpdate` here would be a silent, scheduled
    // rollback of somebody's deliberate change.
    const { fake, db } = run(EMPTY_DATABASE);
    await ensureSeededOrgRoles(db);

    const writes = fake.opsOn("org_roles");
    expect(writes).toHaveLength(SEEDED_ORG_ROLES.length);
    for (const write of writes) {
      expect(write.kind).toBe("insert");
      expect(write.conflictAction).toBe("nothing");
      expect(write.conflictTarget).toEqual(["key"]);
    }
    expect(fake.ops.filter((op) => op.kind === "update")).toHaveLength(0);
    expect(writes.map((w) => w.values[0]?.key)).toEqual(
      SEEDED_ORG_ROLES.map((r) => r.key),
    );
  });

  it("returns how many rows were ACTUALLY inserted", async () => {
    // migrate.ts logs on this number: a wrong count prints "org roles present"
    // about a database that has none — the fail-closed lockout of the whole org
    // team, reported as success.
    const fresh = run(EMPTY_DATABASE);
    await expect(ensureSeededOrgRoles(fresh.db)).resolves.toBe(
      SEEDED_ORG_ROLES.length,
    );

    const seeded = run(SEEDED_ALREADY);
    await expect(ensureSeededOrgRoles(seeded.db)).resolves.toBe(0);
    // Still attempted both — absence is what it restores, so it must always look.
    expect(seeded.fake.opsOn("org_roles")).toHaveLength(SEEDED_ORG_ROLES.length);
  });

  it("counts a PARTIAL restore, not all-or-nothing", async () => {
    // The realistic shape of the incident: one role survived a hand edit and
    // the other did not.
    const { db } = run((op) =>
      op.kind === "insert" && op.values[0]?.key === "engineer"
        ? [{ id: "new-engineer" }]
        : [],
    );
    await expect(ensureSeededOrgRoles(db)).resolves.toBe(1);
  });
});

describe("ensureSeededOrgDepartments", () => {
  it("files a department's DOMAINS only when it just created that department", async () => {
    // THE SILENT-PRIVILEGE INCIDENT. `org_department_domains` records ownership
    // by PRESENCE, so an org taking a domain away from a department looks
    // exactly like "nobody owns it" — and `onConflictDoNothing` protects only a
    // domain some OTHER department owns. Ungated, every deploy re-filed
    // `registrations` and `camp_categories` under Theme camps and `suppliers`
    // and `supplier_documents` under Suppliers, handing every holder of those
    // departments' LEAD roles `personal_information` over them again. No audit
    // row, no error, on a schedule nobody associated with a deploy.
    const seeded = run(SEEDED_ALREADY);
    await ensureSeededOrgDepartments(seeded.db);
    expect(seeded.fake.opsOn("org_department_domains")).toHaveLength(0);

    const fresh = run(EMPTY_DATABASE);
    await ensureSeededOrgDepartments(fresh.db);
    const filed = fresh.fake
      .opsOn("org_department_domains")
      .map((op) => op.values[0]?.domain);
    expect(filed).toEqual(SEEDED_ORG_DEPARTMENTS.flatMap((d) => [...d.domains]));
  });

  it("still ensures the lead/member role pair on a department that already exists", async () => {
    // The pair is what a System manager gets when they create a department. On
    // an old database the department is there and the pair may not be, so the
    // lookup-by-key path has to reach the same place the insert path does.
    const { fake, db } = run(SEEDED_ALREADY);
    await expect(ensureSeededOrgDepartments(db)).resolves.toBe(0);

    const lookups = fake.opsOn("org_departments", "select");
    expect(lookups.map((op) => op.where)).toEqual(
      SEEDED_ORG_DEPARTMENTS.map((d) => [{ column: "key", value: d.key }]),
    );

    const roles = fake.opsOn("org_roles");
    expect(roles).toHaveLength(SEEDED_ORG_DEPARTMENTS.length * 2);
    for (const role of roles) {
      expect(role.conflictAction).toBe("nothing");
      expect(role.conflictTarget).toEqual(["key"]);
    }
    // ...and hung off the row the LOOKUP returned, not off a null.
    expect(roles.map((r) => r.values[0]?.departmentId)).toEqual([
      "existing-theme_camps",
      "existing-theme_camps",
      "existing-suppliers",
      "existing-suppliers",
    ]);
  });

  it("moves on to the next department when neither the insert nor the lookup yields a row", async () => {
    // A throw here would abort the deploy's migration step over a department
    // that could not be resolved, which is a worse outcome than a missing pair.
    const { fake, db } = run(() => []);
    await expect(ensureSeededOrgDepartments(db)).resolves.toBe(0);
    expect(fake.opsOn("org_departments", "select")).toHaveLength(
      SEEDED_ORG_DEPARTMENTS.length,
    );
    expect(fake.opsOn("org_roles")).toHaveLength(0);
    expect(fake.opsOn("org_department_domains")).toHaveLength(0);
  });

  it("writes nameNormalized, not the raw name — dedupe is on the normalized column", async () => {
    // A raw name in that column makes "Theme Camps" and "theme camps" two
    // departments, which is a permission model split in half.
    const { fake, db } = run(EMPTY_DATABASE);
    await expect(ensureSeededOrgDepartments(db)).resolves.toBe(
      SEEDED_ORG_DEPARTMENTS.length,
    );

    const inserts = fake.opsOn("org_departments", "insert");
    expect(inserts).toHaveLength(SEEDED_ORG_DEPARTMENTS.length);
    for (const [i, op] of inserts.entries()) {
      const dept = SEEDED_ORG_DEPARTMENTS[i];
      expect(op.conflictTarget).toEqual(["key"]);
      expect(op.values[0]).toMatchObject({
        key: dept?.key,
        name: dept?.name,
        nameNormalized: normalizeName(dept?.name ?? ""),
        kind: "system",
        sort: dept?.sort,
      });
      expect(op.values[0]?.nameNormalized).not.toBe(dept?.name);
    }
  });
});
