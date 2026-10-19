import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, whereParams, type FakeDb } from "./support/fake-db";
import {
  CAMPS_LEAD,
  GOD,
  NO_ROLES,
  READER,
  SUPPLIERS_LEAD,
} from "./support/actors";

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
}));

import { getSavedGasFuelForReview } from "@/lib/gas-fuel";

// THE CAMP'S GAS & FUEL RECORD ON THE REVIEW PAGE (docs/registration-safety-spec.md
// §"Org review"). Two rules: whoever cannot read registrations is refused
// BEFORE any query, and a carried-forward DRAFT is never shown — a 2026 draft
// is nobody's 2027 plan. Paired, per the console's rule: the row is SEEDED, a
// granted actor receives it, a refused actor gets null and no query ran.

const REG_ID = "11111111-1111-4111-8111-111111111111";
const RECORD = {
  lpg: [{ sizeKg: 48, count: 2 }],
  jerryCans20l: 2,
  barrels200l: 1,
  fuelTrailers: 0,
  note: "",
};
const row = (isDraft: boolean) => ({
  record: RECORD,
  updatedAt: new Date("2027-01-14T10:00:00Z"),
  campNotifiedAt: null,
  wranglerNotifiedAt: null,
  isDraft,
});

beforeEach(() => {
  db = fakeDb();
});

describe("getSavedGasFuelForReview", () => {
  it("a reader of registrations sees the saved record", async () => {
    for (const actor of [GOD, READER, CAMPS_LEAD]) {
      db = fakeDb();
      db.seed("camp_gas_fuel_records", [row(false)]);
      const got = await getSavedGasFuelForReview(REG_ID, actor);
      expect(got?.record).toEqual(RECORD);
    }
  });

  it("refuses an actor who cannot read registrations, before any query", async () => {
    for (const actor of [NO_ROLES, SUPPLIERS_LEAD]) {
      db = fakeDb();
      db.seed("camp_gas_fuel_records", [row(false)]);
      expect(await getSavedGasFuelForReview(REG_ID, actor)).toBeNull();
      expect(db.calls).toHaveLength(0);
    }
  });

  it("never shows a draft, even if the query hands one back", async () => {
    db.seed("camp_gas_fuel_records", [row(true)]);
    expect(await getSavedGasFuelForReview(REG_ID, GOD)).toBeNull();
  });

  it("asks only for this registration's non-draft row", async () => {
    db.seed("camp_gas_fuel_records", [row(false)]);
    await getSavedGasFuelForReview(REG_ID, GOD);
    const [read] = db.recorded("select", "camp_gas_fuel_records");
    expect(whereParams(read!.where)).toEqual([REG_ID, false]);
  });
});
