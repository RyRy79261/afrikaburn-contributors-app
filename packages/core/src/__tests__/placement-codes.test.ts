import { describe, it, expect } from "vitest";

import {
  normalizeErf,
  isValidErf,
  normalizeCampCode,
  isValidCampCode,
  suggestCampCode,
  parsePlacementAssignment,
  campPlacementOf,
  canViewCampPlacement,
  isPlacementAllocated,
  placementChange,
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

describe("campPlacementOf — the one read shape (epic #48, ERF-019)", () => {
  it("shows nothing when there is no registration or nothing assigned", () => {
    expect(campPlacementOf(null)).toBeNull();
    expect(campPlacementOf(undefined)).toBeNull();
    expect(campPlacementOf({ campCode: null, erf: null })).toBeNull();
    expect(campPlacementOf({ campCode: " ", erf: "  " })).toBeNull();
  });

  it("a camp code alone is not a placement", () => {
    expect(campPlacementOf({ campCode: "MAH", erf: null })).toEqual({
      campCode: "MAH",
      erf: null,
      placementAllocated: false,
    });
  });

  it("an erf is the placement, derived — never a stored status", () => {
    expect(campPlacementOf({ campCode: "MAH", erf: "K12" })).toEqual({
      campCode: "MAH",
      erf: "K12",
      placementAllocated: true,
    });
  });

  it("re-normalises on the way out, whatever the writer stored", () => {
    expect(
      campPlacementOf({ campCode: "mah-1", erf: " k12   north " }),
    ).toEqual({ campCode: "MAH1", erf: "K12 NORTH", placementAllocated: true });
  });
});

describe("isPlacementAllocated", () => {
  it("is true only for a non-blank erf", () => {
    expect(isPlacementAllocated("K12")).toBe(true);
    expect(isPlacementAllocated("")).toBe(false);
    expect(isPlacementAllocated("   ")).toBe(false);
    expect(isPlacementAllocated(null)).toBe(false);
    expect(isPlacementAllocated(undefined)).toBe(false);
  });
});

describe("canViewCampPlacement", () => {
  it("lets members read their camp's placement and nobody else", () => {
    expect(canViewCampPlacement(true)).toBe(true);
    expect(canViewCampPlacement(false)).toBe(false);
  });
});

describe("placementChange (epic #48 — notify on first assignment and every change)", () => {
  const NONE = { campCode: null, erf: null };

  it("a first assignment of both fields is `set`, in the one-line format", () => {
    expect(placementChange(NONE, { campCode: "MAH", erf: "C-14" })).toEqual({
      verb: "set",
      line: "MAH · C-14",
    });
  });

  it("assigning the erf to a camp that already has its code is still `set`", () => {
    // Nothing the camp was told has been replaced — the placement filled in.
    expect(
      placementChange(
        { campCode: "MAH", erf: null },
        { campCode: "MAH", erf: "C-14" },
      ),
    ).toEqual({ verb: "set", line: "MAH · C-14" });
  });

  it("a revised erf is `changed`", () => {
    expect(
      placementChange(
        { campCode: "MAH", erf: "C-14" },
        { campCode: "MAH", erf: "C-15" },
      ),
    ).toEqual({ verb: "changed", line: "MAH · C-15" });
  });

  it("a revised code is `changed`", () => {
    expect(
      placementChange(
        { campCode: "MAH", erf: "C-14" },
        { campCode: "MAH1", erf: "C-14" },
      ),
    ).toEqual({ verb: "changed", line: "MAH1 · C-14" });
  });

  it("both fields moving in one save is ONE change, not two", () => {
    expect(
      placementChange(
        { campCode: "MAH", erf: "C-14" },
        { campCode: "HAT", erf: "D-2" },
      ),
    ).toEqual({ verb: "changed", line: "HAT · D-2" });
  });

  it("re-saving the same values is no change", () => {
    const same = { campCode: "MAH", erf: "C-14" };
    expect(placementChange(same, { ...same })).toBeNull();
    expect(placementChange(NONE, NONE)).toBeNull();
  });

  it("a value that only differs in case or whitespace is no change", () => {
    expect(
      placementChange(
        { campCode: "MAH", erf: "K12 NORTH" },
        { campCode: "mah", erf: "  k12   north " },
      ),
    ).toBeNull();
  });

  // Ryan, 28 Sep 2026: clearing notifies too.
  it("clearing both fields is `removed`, with nothing left to show", () => {
    expect(placementChange({ campCode: "MAH", erf: "C-14" }, NONE)).toEqual({
      verb: "removed",
      line: "",
    });
  });

  it("clearing the only assigned field is `removed`", () => {
    expect(placementChange({ campCode: "MAH", erf: null }, NONE)).toEqual({
      verb: "removed",
      line: "",
    });
    expect(placementChange({ campCode: null, erf: "C-14" }, NONE)).toEqual({
      verb: "removed",
      line: "",
    });
  });

  it("clearing one field while the other stays is `changed`, showing what remains", () => {
    expect(
      placementChange(
        { campCode: "MAH", erf: "C-14" },
        { campCode: "MAH", erf: null },
      ),
    ).toEqual({ verb: "changed", line: "MAH" });
    expect(
      placementChange(
        { campCode: "MAH", erf: "C-14" },
        { campCode: null, erf: "C-14" },
      ),
    ).toEqual({ verb: "changed", line: "C-14" });
  });

  it("blank strings count as empty — a clear, not a new value", () => {
    expect(
      placementChange(
        { campCode: "MAH", erf: "C-14" },
        { campCode: "", erf: " " },
      ),
    ).toEqual({ verb: "removed", line: "" });
  });

  it("a clear alongside a new value is `changed`, showing only what remains", () => {
    expect(
      placementChange(
        { campCode: "MAH", erf: "C-14" },
        { campCode: null, erf: "C-15" },
      ),
    ).toEqual({ verb: "changed", line: "C-15" });
  });
});
