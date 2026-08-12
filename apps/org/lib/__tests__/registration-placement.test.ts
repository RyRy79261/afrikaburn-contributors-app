import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * The two console-side reads behind the R1 review-screen additions. Neither
 * touches `payments` — registration is free (AGENTS.md §Product laws).
 *
 * The distinction worth protecting here is the one in `getReviewComparison`:
 * "nothing changed" and "we can no longer tell what changed" are different
 * statements, and only the first is safe to show a reviewer as a diff.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
  createPooledDb: () => ({ db, pool: { end: async () => {} } }),
}));

import {
  getPlacementContext,
  getReviewComparison,
} from "@/lib/registration-placement";

const REG_ID = "11111111-1111-4111-8111-111111111111";
const PRIOR_ID = "99999999-9999-4999-8999-999999999999";
const EDITION_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  db = fakeDb();
});

describe("getPlacementContext", () => {
  it("returns the current assignment", async () => {
    db.seed("registrations", [
      [{ campCode: "MAH", erf: "K12" }], // this registration
      [], // taken codes in the edition
    ]);
    const context = await getPlacementContext({
      registrationId: REG_ID,
      editionId: EDITION_ID,
      campName: "Mad Hatters",
    });

    expect(context.campCode).toBe("MAH");
    expect(context.erf).toBe("K12");
  });

  it("suggests a code that avoids this edition's taken ones", async () => {
    // Computing the suggestion from the name alone would offer a colliding code
    // to every camp whose name starts the same way, and the staff member would
    // only find out on submit.
    db.seed("registrations", [
      [{ campCode: null, erf: null }],
      [{ campCode: "MAH" }, { campCode: "MAHA" }],
    ]);

    const context = await getPlacementContext({
      registrationId: REG_ID,
      editionId: EDITION_ID,
      campName: "Mad Hatters",
    });

    expect(context.suggestedCode).toBe("MAHB");
  });

  it("reports an unassigned camp as unassigned", async () => {
    db.seed("registrations", [[{ campCode: null, erf: null }], []]);

    const context = await getPlacementContext({
      registrationId: REG_ID,
      editionId: EDITION_ID,
      campName: "Mad Hatters",
    });
    expect(context.campCode).toBeNull();
  });
});

describe("getReviewComparison", () => {
  /** A registration row as the page hands it over. */
  function registration(overrides: Record<string, unknown> = {}) {
    return {
      id: REG_ID,
      carriedForwardFromId: PRIOR_ID,
      s4ExpectedPopulation: 60,
      s2LntPlan: "Sweep the grid daily.",
      ...overrides,
    } as never;
  }

  it("returns null for a registration that was never carried forward", async () => {
    const result = await getReviewComparison(
      registration({ carriedForwardFromId: null }),
      2027,
    );
    expect(result).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it("returns null when the source row has since been deleted", async () => {
    // NOT an empty diff: "nothing changed" would be a lie about a comparison we
    // can no longer make.
    db.seed("registrations", [[]]);
    const result = await getReviewComparison(registration(), 2027);
    expect(result).toBeNull();
  });

  it("diffs against the prior edition and reports its year", async () => {
    db.seed("registrations", [
      [
        {
          row: {
            id: PRIOR_ID,
            s4ExpectedPopulation: 42,
            s2LntPlan: "Sweep the grid daily.",
          },
          year: 2026,
        },
      ],
    ]);

    const result = await getReviewComparison(registration(), 2027);

    expect(result?.priorYear).toBe(2026);
    expect(result?.currentYear).toBe(2027);
    // Only the population moved; the unchanged LNT plan is not in the list.
    expect(result?.changes.map((c) => c.field)).toEqual([
      "s4ExpectedPopulation",
    ]);
    expect(result?.changes[0]?.prior).toBe(42);
    expect(result?.changes[0]?.current).toBe(60);
  });

  it("returns an empty change list when a carried-forward row is untouched", async () => {
    db.seed("registrations", [
      [
        {
          row: {
            id: PRIOR_ID,
            s4ExpectedPopulation: 60,
            s2LntPlan: "Sweep the grid daily.",
          },
          year: 2026,
        },
      ],
    ]);

    const result = await getReviewComparison(registration(), 2027);
    expect(result).not.toBeNull();
    expect(result?.changes).toEqual([]);
  });
});
