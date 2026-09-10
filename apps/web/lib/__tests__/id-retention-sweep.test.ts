import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { dbMock } from "@/test/db-mock";

vi.mock("@/lib/db", async () => (await import("@/test/db-mock")).dbModuleMock());
vi.mock("@/lib/config", () => ({ isDatabaseConfigured: () => true }));

const { sweepExpiredIdDocuments, ID_PURGE_AUDIT_ACTION } = await import(
  "../id-retention-sweep"
);

// WHAT THESE PROVE. The RULE — which editions have aged out — is already tested
// in packages/core (`id-retention.test.ts`). These cover the half that was
// missing entirely: that something calls it, that the purge patch reaches the
// database, and that a failure is reported rather than swallowed. Per the
// db-mock header, they assert the DECISION and the write issued, not the SQL;
// a wrong WHERE clause would still need the persona suite or a real database.

const EXPIRED_EDITION = "11111111-1111-1111-1111-111111111111";
const CURRENT_EDITION = "22222222-2222-2222-2222-222222222222";
const BIO_A = "aaaaaaaa-0000-0000-0000-000000000001";
const BIO_B = "aaaaaaaa-0000-0000-0000-000000000002";

/** 2027-02-01: well past the expired edition's 30-day grace, inside the current
 *  edition's. */
const NOW = new Date("2027-02-01T00:00:00Z");

const EDITIONS = [
  // ended 2026-05-03 → grace elapsed 2026-06-02
  { id: EXPIRED_EDITION, endDate: "2026-05-03" },
  // ends 2027-04-30 → nowhere near purgeable
  { id: CURRENT_EDITION, endDate: "2027-04-30" },
];

// A SOURCE ASSERTION, because the db-mock cannot answer this one. `db()` and the
// `tx` handle are the same proxy, and `RecordedQuery.tx` is set by WHEN a chain
// was built rather than by which handle built it — so a `db().insert(...)` sitting
// inside the `withTransaction` callback records as `tx: true` exactly like the
// real thing. Checked by mutation: swapping `tx.insert` for `db().insert` left
// all eight behavioural cases green. In real Drizzle that write would land on a
// different connection and survive a rollback, leaving an audit row claiming an
// erasure that did not happen. The repo already uses source assertions for
// guarantees a mock cannot reach (decision-reason-invariant, deletion-guards).
describe("the purge and its audit row cannot be split apart", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../id-retention-sweep.ts", import.meta.url)),
    "utf8",
  );

  it("issues every write inside the transaction through the `tx` handle", () => {
    const start = source.indexOf("await withTransaction(async (tx) => {");
    expect(start, "the sweep still wraps its writes in a transaction").toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\n    });", start));

    expect(body).toContain("tx\n        .update(schema.burnerBios)");
    expect(body).toContain("tx.insert(schema.auditEvents)");
    // The failure mode this exists for: a `db()` call inside the callback.
    expect(body, "a db() call inside the transaction escapes the rollback").not.toMatch(
      /\bdb\(\)/,
    );
  });
});

describe("sweepExpiredIdDocuments", () => {
  beforeEach(() => dbMock.reset());

  it("purges ID data belonging to an edition past its retention window", async () => {
    dbMock.queue(
      EDITIONS,
      [{ id: BIO_A, editionId: EXPIRED_EDITION, hasSaId: true, hasPassport: false }],
      [], // the update
      [], // the audit insert
    );

    const result = await sweepExpiredIdDocuments(NOW);

    expect(result.identified).toBe(1);
    expect(result.purged).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.editionIds).toEqual([EXPIRED_EDITION]);

    const writes = dbMock.writesTo(schema.burnerBios);
    expect(writes, "the bio row was updated").toHaveLength(1);
    // The patch is the one @quagga/core defines — both columns to null.
    expect(writes[0]?.arg("set")).toEqual({
      saIdEncrypted: null,
      passportEncrypted: null,
    });
  });

  it("leaves a current edition's ID data alone", async () => {
    dbMock.queue(EDITIONS, [
      { id: BIO_B, editionId: CURRENT_EDITION, hasSaId: true, hasPassport: true },
    ]);

    const result = await sweepExpiredIdDocuments(NOW);

    expect(result.identified).toBe(0);
    expect(result.purged).toBe(0);
    expect(dbMock.writesTo(schema.burnerBios)).toHaveLength(0);
  });

  it("never loads the ciphertext it is deleting", async () => {
    dbMock.queue(EDITIONS, [
      { id: BIO_A, editionId: EXPIRED_EDITION, hasSaId: true, hasPassport: false },
    ], [], []);

    await sweepExpiredIdDocuments(NOW);

    // The bio SELECT projects presence booleans, never the encrypted columns.
    const selects = dbMock.queriesOfKind("select");
    const projections = selects.map((q) => q.calls[0]?.args[0]);
    for (const p of projections) {
      if (p && typeof p === "object") {
        const keys = Object.keys(p as Record<string, unknown>);
        expect(keys).not.toContain("saIdEncrypted");
        expect(keys).not.toContain("passportEncrypted");
      }
    }
  });

  it("writes one audit row per run, naming no burner", async () => {
    dbMock.queue(
      EDITIONS,
      [
        { id: BIO_A, editionId: EXPIRED_EDITION, hasSaId: true, hasPassport: false },
        { id: BIO_B, editionId: EXPIRED_EDITION, hasSaId: false, hasPassport: true },
      ],
      [],
      [],
    );

    await sweepExpiredIdDocuments(NOW);

    const audits = dbMock.writesTo(schema.auditEvents);
    expect(audits, "exactly one audit row for the run").toHaveLength(1);
    const values = audits[0]?.arg("values") as Record<string, unknown>;
    expect(values.action).toBe(ID_PURGE_AUDIT_ACTION);
    // Two bios were purged, but the trail records counts and editions only —
    // a per-burner row would rebuild the association being erased.
    expect(JSON.stringify(values)).not.toContain(BIO_A);
    expect(JSON.stringify(values)).not.toContain(BIO_B);
    expect((values.meta as Record<string, unknown>).purgedBios).toBe(2);
  });

  it("opens exactly one transaction for the run", async () => {
    dbMock.queue(EDITIONS, [
      { id: BIO_A, editionId: EXPIRED_EDITION, hasSaId: true, hasPassport: false },
    ], [], []);

    await sweepExpiredIdDocuments(NOW);

    expect(dbMock.transactions).toBe(1);
  });

  it("reports a failed purge instead of returning a clean run", async () => {
    dbMock.queue(
      EDITIONS,
      [{ id: BIO_A, editionId: EXPIRED_EDITION, hasSaId: true, hasPassport: false }],
      new Error("connection reset"),
    );

    const result = await sweepExpiredIdDocuments(NOW);

    expect(result.purged).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.bioId).toBe(BIO_A);
    expect(result.failures[0]?.error).toContain("connection reset");
  });

  it("issues no write when nothing has aged out", async () => {
    dbMock.queue(EDITIONS, []);

    const result = await sweepExpiredIdDocuments(NOW);

    expect(result).toEqual({
      identified: 0,
      purged: 0,
      failures: [],
      editionIds: [],
    });
    expect(dbMock.queriesOfKind("update")).toHaveLength(0);
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("honours a caller-supplied grace window", async () => {
    // With a 3650-day grace nothing is expired, even the 2026 edition.
    dbMock.queue(EDITIONS, [
      { id: BIO_A, editionId: EXPIRED_EDITION, hasSaId: true, hasPassport: false },
    ]);

    const result = await sweepExpiredIdDocuments(NOW, 500, 3650);

    expect(result.identified).toBe(0);
    expect(dbMock.writesTo(schema.burnerBios)).toHaveLength(0);
  });
});
