import { describe, it, expect } from "vitest";

import {
  normalizeErf,
  isValidErf,
  normalizeCampCode,
  isValidCampCode,
  suggestCampCode,
  parsePlacementAssignment,
  MAX_ERF_LENGTH,
  MAX_CAMP_CODE_LENGTH,
} from "../placement-codes";

describe("normalizeErf", () => {
  it("trims, collapses inner whitespace and upper-cases", () => {
    expect(normalizeErf("  k12   north  ")).toBe("K12 NORTH");
  });

  it("treats blank and whitespace-only as unassigned", () => {
    expect(normalizeErf("")).toBeNull();
    expect(normalizeErf("   ")).toBeNull();
    expect(normalizeErf(null)).toBeNull();
    expect(normalizeErf(undefined)).toBeNull();
  });

  it("keeps whatever format AfrikaBurn happens to use", () => {
    // The point of the free-text column: we do not know the grammar yet, so we
    // must not reject a plausible one.
    expect(normalizeErf("binnekring 7ish")).toBe("BINNEKRING 7ISH");
    expect(normalizeErf("A-14/2")).toBe("A-14/2");
  });
});

describe("isValidErf", () => {
  it("accepts unassigned", () => {
    expect(isValidErf(null)).toBe(true);
  });

  it("accepts a normal label and rejects an overlong one", () => {
    expect(isValidErf("K12")).toBe(true);
    expect(isValidErf("X".repeat(MAX_ERF_LENGTH))).toBe(true);
    expect(isValidErf("X".repeat(MAX_ERF_LENGTH + 1))).toBe(false);
  });
});

describe("normalizeCampCode", () => {
  it("strips punctuation, accents and case", () => {
    expect(normalizeCampCode("mah-1")).toBe("MAH1");
    expect(normalizeCampCode("Café")).toBe("CAFE");
  });

  it("caps at the maximum length", () => {
    expect(normalizeCampCode("ABCDEFGHIJKL")).toHaveLength(
      MAX_CAMP_CODE_LENGTH,
    );
  });

  it("treats nothing usable as unassigned", () => {
    expect(normalizeCampCode("---")).toBeNull();
    expect(normalizeCampCode("")).toBeNull();
    expect(normalizeCampCode(null)).toBeNull();
  });
});

describe("isValidCampCode", () => {
  it("accepts unassigned and well-formed codes", () => {
    expect(isValidCampCode(null)).toBe(true);
    expect(isValidCampCode("MAH")).toBe(true);
    expect(isValidCampCode("MAH1")).toBe(true);
  });

  it("rejects a one-character code", () => {
    expect(isValidCampCode("M")).toBe(false);
  });
});

describe("suggestCampCode", () => {
  it("derives from the camp name", () => {
    expect(suggestCampCode("Mad Hatters", [])).toBe("MAH");
  });

  it("avoids a code already taken this edition", () => {
    expect(suggestCampCode("Mad Hatters", ["MAH"])).toBe("MAHA");
  });

  it("is deterministic for the same taken set", () => {
    const taken = ["MAH", "MAHA", "MAHB"];
    expect(suggestCampCode("Mad Hatters", taken)).toBe("MAHC");
    expect(suggestCampCode("Mad Hatters", taken)).toBe("MAHC");
  });

  it("normalizes the taken set before comparing", () => {
    // A stored code of "mah" must still block the suggestion "MAH".
    expect(suggestCampCode("Mad Hatters", ["mah"])).toBe("MAHA");
  });

  it("always returns something storable", () => {
    const code = suggestCampCode("!!!", []);
    expect(isValidCampCode(code)).toBe(true);
  });

  it("falls through to numbers once every letter suffix is taken", () => {
    const taken = [
      "MAH",
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => `MAH${c}`),
    ];
    const code = suggestCampCode("Mad Hatters", taken);
    expect(code).toBe("MAH2");
    expect(isValidCampCode(code)).toBe(true);
  });

  it("keeps walking the numbers when the low ones are taken too", () => {
    const taken = [
      "MAH",
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => `MAH${c}`),
      "MAH2",
      "MAH3",
    ];
    expect(suggestCampCode("Mad Hatters", taken)).toBe("MAH4");
  });
});

describe("parsePlacementAssignment", () => {
  it("normalizes both fields together", () => {
    expect(
      parsePlacementAssignment({ campCode: "mah-1", erf: "  k12  " }),
    ).toEqual({ campCode: "MAH1", erf: "K12" });
  });

  it("accepts clearing both", () => {
    expect(parsePlacementAssignment({ campCode: "", erf: "" })).toEqual({
      campCode: null,
      erf: null,
    });
  });

  it("refuses a camp code that normalizes to a single character", () => {
    expect(() => parsePlacementAssignment({ campCode: "-m-" })).toThrow(
      /2–8 letters or digits/,
    );
  });

  it("refuses an overlong erf", () => {
    expect(() =>
      parsePlacementAssignment({ erf: "X".repeat(MAX_ERF_LENGTH + 1) }),
    ).toThrow(/at most/);
  });
});
