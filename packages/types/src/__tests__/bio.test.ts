import { describe, it, expect } from "vitest";
import {
  BioExtrasInput,
  CampHistoryEntry,
  VOLUNTEER_PORTFOLIOS,
  isVolunteerPortfolioKey,
  volunteerPortfolioLabel,
} from "../index";

// This file is the VALIDATION authority for the Burner Bio v3 extras;
// @quagga/core layers the field registry and public projection on top and has
// its own tests for that side. The refinement below is the only thing stopping
// a `freetext` camp-history row from carrying a groupId it does not own — and
// the store layer's "a stale link degrades to freetext" behaviour assumes the
// invariant already holds.

const GROUP_ID = "3f1d2c9e-5b7a-4c31-9f10-0a2b4c6d8e0f";

describe("volunteer portfolios", () => {
  it("holds the 15 real Quaggapedia portfolios under unique keys", () => {
    expect(VOLUNTEER_PORTFOLIOS).toHaveLength(15);
    const keys = VOLUNTEER_PORTFOLIOS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("recognises a real key and refuses an invented one", () => {
    for (const p of VOLUNTEER_PORTFOLIOS) {
      expect(isVolunteerPortfolioKey(p.key), p.key).toBe(true);
    }
    expect(isVolunteerPortfolioKey("chief_of_dust")).toBe(false);
  });

  it("labels a known key from the corpus and falls back to the key itself", () => {
    expect(volunteerPortfolioLabel("dmv")).toBe("DMV");
    expect(volunteerPortfolioLabel("die_hek")).toBe("Die Hek (Gate)");
    // The fallback is the point: a portfolio stored before a rename must never
    // render as "undefined" on someone's profile.
    expect(volunteerPortfolioLabel("chief_of_dust")).toBe("chief_of_dust");
  });
});

describe("camp history entry — linked vs freetext", () => {
  it("accepts a linked entry that references a group", () => {
    const parsed = CampHistoryEntry.safeParse({
      kind: "linked",
      groupId: GROUP_ID,
      label: "Camp 404",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a freetext entry with no group", () => {
    const parsed = CampHistoryEntry.safeParse({
      kind: "freetext",
      label: "Some camp at another burn",
      event: "Burning Man",
      years: "2018, 2019",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a linked entry with no group, and a freetext entry that claims one", () => {
    // Both halves of the refinement. The second is the load-bearing one: a
    // free-text row must not carry a reference to a platform group.
    const orphanLink = CampHistoryEntry.safeParse({
      kind: "linked",
      label: "Camp 404",
    });
    expect(orphanLink.success).toBe(false);
    expect(orphanLink.error?.issues[0]?.message).toBe(
      "Linked entries must reference a group; free-text entries must not.",
    );

    expect(
      CampHistoryEntry.safeParse({
        kind: "freetext",
        groupId: GROUP_ID,
        label: "Camp 404",
      }).success,
    ).toBe(false);
  });

  it("requires a real label and bounds the free-text fields", () => {
    expect(
      CampHistoryEntry.safeParse({ kind: "freetext", label: "   " }).success,
    ).toBe(false);
    expect(
      CampHistoryEntry.safeParse({ kind: "freetext", label: "x".repeat(121) })
        .success,
    ).toBe(false);
    expect(
      CampHistoryEntry.safeParse({
        kind: "freetext",
        label: "Camp 404",
        event: "x".repeat(121),
      }).success,
    ).toBe(false);
    expect(
      CampHistoryEntry.safeParse({
        kind: "freetext",
        label: "Camp 404",
        years: "x".repeat(61),
      }).success,
    ).toBe(false);
  });
});

describe("BioExtrasInput", () => {
  it("accepts an empty payload, because a partial save must not wipe untouched fields", () => {
    const parsed = BioExtrasInput.safeParse({});
    expect(parsed.success).toBe(true);
  });

  it("accepts a null about (clearing the field) and the boolean flags", () => {
    const parsed = BioExtrasInput.safeParse({
      about: null,
      rangerTraining: true,
      rangerCurious: false,
      greenDotTraining: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("caps the repeatable lists", () => {
    const entry = { kind: "freetext" as const, label: "Camp 404" };
    expect(
      BioExtrasInput.safeParse({ campHistory: Array(50).fill(entry) }).success,
    ).toBe(true);
    expect(
      BioExtrasInput.safeParse({ campHistory: Array(51).fill(entry) }).success,
    ).toBe(false);
    expect(
      BioExtrasInput.safeParse({
        volunteeringInterests: Array(31).fill("rangers"),
      }).success,
    ).toBe(false);
  });
});
