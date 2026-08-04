import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@/lib/db";
import { installFakeDb, type FakeDb } from "@/test/fakes/db";

// Issuance of `suppliers.code` — `SUP-2027-0416`, the number the depot and
// camps quote (lib/supplier-code.ts).
//
// TWO PROMISES, both easy to break by accident:
//
//  1. IDEMPOTENCE. A code that is already issued must come back unchanged. It
//     leaves the platform — depot gate lists, delivery manifests, the
//     supplier's own paperwork — so re-keying one silently invalidates paper
//     nobody can reissue.
//  2. THE RETRY IS BOUNDED, AND FAILURE IS NON-FATAL. The HTTP driver has no
//     transactions, so two suppliers registering in the same instant can
//     compute the same sequence; `suppliers.code` is UNIQUE, so the loser's
//     write fails and it recomputes. Returning null after the bound is what
//     keeps a pathological contention loop from hanging the request — and a
//     missing code never blocks onboarding, because it is backfillable.
//
// The UNIQUE constraint that arbitrates all of this is Postgres', not the
// fake's: what is proven here is the retry LOOP, not the collision itself.

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof DbModule>("@/lib/db");
  const { fakeDb: current } = await import("@/test/fakes/db");
  return { ...actual, getDb: () => current().handle };
});

const { assignSupplierCode } = await import("@/lib/supplier-code");

let db: FakeDb;

beforeEach(() => {
  db = installFakeDb();
});

describe("assignSupplierCode", () => {
  it("keeps an already-issued code and writes nothing", async () => {
    db.rows("suppliers", [{ code: "SUP-2027-0416" }]);

    expect(await assignSupplierCode(db.handle, "sup-1", 2027)).toBe(
      "SUP-2027-0416",
    );
    expect(db.matching('update "suppliers" set')).toEqual([]);
  });

  it("allocates the next sequence past the codes already taken", async () => {
    db.rows(
      "suppliers",
      [{ code: null }], // this supplier has none yet
      [{ code: "SUP-2027-0416" }, { code: "SUP-2027-0417" }], // …these are taken
      [{ code: "SUP-2027-0418" }], // the UPDATE … RETURNING
    );

    expect(await assignSupplierCode(db.handle, "sup-1", 2027)).toBe(
      "SUP-2027-0418",
    );
    expect(db.matching('update "suppliers" set')[0]!.params).toContain(
      "SUP-2027-0418",
    );
  });

  it("scopes the sequence to the edition year", async () => {
    db.rows(
      "suppliers",
      [{ code: null }],
      [{ code: "SUP-2026-0999" }], // last year's, and not this year's business
      [{ code: "SUP-2027-0001" }],
    );

    expect(await assignSupplierCode(db.handle, "sup-1", 2027)).toBe(
      "SUP-2027-0001",
    );
  });

  it("retries when the write loses a race, then succeeds", async () => {
    db.rows(
      "suppliers",
      [{ code: null }],
      [], // attempt 1: nothing taken…
      new Error("duplicate key value violates unique constraint"), // …lost
      [{ code: "SUP-2027-0001" }], // attempt 2: recompute against the larger set
      [{ code: "SUP-2027-0002" }], // …won
    );

    expect(await assignSupplierCode(db.handle, "sup-1", 2027)).toBe(
      "SUP-2027-0002",
    );
  });

  it("gives up after the bounded retries rather than looping forever", async () => {
    // Non-fatal by contract: the caller must still complete the registration.
    db.rows("suppliers", [{ code: null }]);
    // Every later read answers empty and every UPDATE … RETURNING yields no
    // row, so all five attempts fail to assign.

    expect(await assignSupplierCode(db.handle, "sup-1", 2027)).toBeNull();
    expect(db.matching('update "suppliers" set')).toHaveLength(5);
  });
});
