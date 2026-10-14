import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyLayoutDocument } from "@quagga/core";
import { fakeDb, type FakeDb } from "./support/fake-db";
import { GOD, NO_ROLES, READER, SUPPLIERS_LEAD } from "./support/actors";

/**
 * The camp layout AfrikaBurn's reviewers see (docs/camp-layout-spec.md
 * decision 10): the snapshot pinned at submit, on the registration-read
 * capability, and nothing about who pinned it.
 *
 * What this cannot prove: that the query picks the LATEST pin for THIS
 * registration — the fake ignores WHERE and ORDER BY. That is the e2e
 * suite's (specs/camp-lead/camp-layout-view.spec.ts).
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
  createPooledDb: () => ({ db, pool: { end: async () => {} } }),
}));

import {
  getLayoutSnapshotForReview,
  getPinnedLayoutPlots,
} from "@/lib/layout-snapshot";

const REG_ID = "11111111-1111-4111-8111-111111111111";
const PINNED = new Date("2027-03-02T08:00:00Z");

beforeEach(() => {
  db = fakeDb();
});

function seedSnapshot(document: unknown) {
  db.seed("camp_layout_snapshots", [
    {
      version: 12,
      pinnedAt: PINNED,
      document,
      pinnedByUserId: "22222222-2222-4222-8222-222222222222",
      layoutId: "33333333-3333-4333-8333-333333333333",
    },
  ]);
}

describe("getLayoutSnapshotForReview", () => {
  it("returns the pinned plan and its plot size to a registrations reader", async () => {
    seedSnapshot(createEmptyLayoutDocument(40, 30));
    const s = await getLayoutSnapshotForReview(REG_ID, 2027, READER);
    expect(s).not.toBeNull();
    expect(s?.version).toBe(12);
    expect(s?.pinnedAt).toEqual(PINNED);
    expect(s?.summary).toEqual({
      width: 40,
      depth: 30,
      areaM2: 1200,
      totalObjectCount: 0,
    });
    expect(s?.document.plot.boundary).toEqual({
      kind: "rect",
      width: 40,
      depth: 30,
    });
    expect(await getLayoutSnapshotForReview(REG_ID, 2027, GOD)).not.toBeNull();
  });

  it("never selects who pinned it", async () => {
    seedSnapshot(createEmptyLayoutDocument(40, 30));
    const s = await getLayoutSnapshotForReview(REG_ID, 2027, READER);
    expect(s).not.toBeNull();
    const [call] = db.recorded("select", "camp_layout_snapshots");
    expect(call?.columns).toEqual(["version", "pinnedAt", "document"]);
    expect(Object.keys(s ?? {})).not.toContain("pinnedByUserId");
  });

  it("refuses an account that cannot read registrations, before any query", async () => {
    seedSnapshot(createEmptyLayoutDocument(40, 30));
    expect(await getLayoutSnapshotForReview(REG_ID, 2027, NO_ROLES)).toBeNull();
    // A department lead whose department does not own registrations.
    expect(
      await getLayoutSnapshotForReview(REG_ID, 2027, SUPPLIERS_LEAD),
    ).toBeNull();
    expect(db.recorded("select", "camp_layout_snapshots")).toHaveLength(0);
  });

  it("is null when the camp has not submitted a layout", async () => {
    expect(await getLayoutSnapshotForReview(REG_ID, 2027, READER)).toBeNull();
  });

  it("draws nothing from a stored document that no longer parses", async () => {
    seedSnapshot({ schemaVersion: 99, plot: {} });
    expect(await getLayoutSnapshotForReview(REG_ID, 2027, READER)).toBeNull();
  });
});

describe("getPinnedLayoutPlots — the placement CSV's plot size (decision 10)", () => {
  const OTHER = "44444444-4444-4444-8444-444444444444";

  it("takes each registration's LATEST pin, whatever order the rows come in", async () => {
    db.seed("camp_layout_snapshots", [
      {
        registrationId: REG_ID,
        pinnedAt: new Date("2027-03-02T08:00:00Z"),
        document: createEmptyLayoutDocument(40, 30),
      },
      {
        registrationId: REG_ID,
        pinnedAt: new Date("2027-03-20T08:00:00Z"),
        document: createEmptyLayoutDocument(45, 30),
      },
      {
        registrationId: REG_ID,
        pinnedAt: new Date("2027-03-10T08:00:00Z"),
        document: createEmptyLayoutDocument(20, 20),
      },
      {
        registrationId: OTHER,
        pinnedAt: new Date("2027-03-05T08:00:00Z"),
        document: { schemaVersion: 99, plot: {} },
      },
    ]);
    const plots = await getPinnedLayoutPlots([REG_ID, OTHER], 2027, READER);
    expect(plots.get(REG_ID)).toEqual({ width: 45, depth: 30, areaM2: 1350 });
    // A stored document that no longer parses: no plot, never half a one.
    expect(plots.has(OTHER)).toBe(false);
    // Size and area only — nothing of the layout itself.
    const [call] = db.recorded("select", "camp_layout_snapshots");
    expect(call?.columns).toEqual(["registrationId", "pinnedAt", "document"]);
  });

  it("refuses an account that cannot read registrations, before any query", async () => {
    db.seed("camp_layout_snapshots", [
      {
        registrationId: REG_ID,
        pinnedAt: PINNED,
        document: createEmptyLayoutDocument(40, 30),
      },
    ]);
    expect((await getPinnedLayoutPlots([REG_ID], 2027, NO_ROLES)).size).toBe(0);
    expect(db.recorded("select", "camp_layout_snapshots")).toHaveLength(0);
  });
});

