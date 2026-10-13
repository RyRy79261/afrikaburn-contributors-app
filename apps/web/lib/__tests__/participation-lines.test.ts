import { describe, it, expect } from "vitest";
import { WapListStatus } from "@quagga/types";
import { onboardingLine, passLine } from "../participation-lines";

// The participation summary's worded lines. Each case below is one where the
// obvious wording states something false.

const APPROVED = WapListStatus.enum.approved;
const DRAFT = WapListStatus.enum.draft;

describe("passLine", () => {
  it("states the list when there is one", () => {
    expect(
      passLine({
        thisEdition: APPROVED,
        draftsVisible: false,
        earlierYears: [],
      }),
    ).toBe("On the camp's list this edition.");
    expect(
      passLine({
        thisEdition: DRAFT,
        draftsVisible: true,
        earlierYears: [2026],
      }),
    ).toBe("On the camp's draft list this edition. Also held one in 2026.");
  });

  it("a viewer who may see drafts is told the member is not on the list", () => {
    expect(
      passLine({
        thisEdition: null,
        draftsVisible: true,
        earlierYears: [2025, 2026],
      }),
    ).toBe("Not on the camp's list this edition. Held one in 2025 and 2026.");
  });

  it("a viewer who is never shown a draft is never told 'not on the list'", () => {
    // The member may be on the lead's draft: say only what is known.
    const withEarlier = passLine({
      thisEdition: null,
      draftsVisible: false,
      earlierYears: [2026],
    });
    expect(withEarlier).toBe("Held one in 2026.");
    expect(withEarlier).not.toMatch(/not on/i);
    const without = passLine({
      thisEdition: null,
      draftsVisible: false,
      earlierYears: [],
    });
    expect(without).not.toMatch(/not on/i);
  });
});

describe("onboardingLine", () => {
  it("'None sent this edition' only when the camp sent none", () => {
    expect(onboardingLine(null, true)).toEqual({
      text: "None sent this edition",
    });
    expect(onboardingLine("not_targeted", true)).toEqual({
      text: "Not sent to you",
    });
    expect(onboardingLine("not_targeted", false)).toEqual({
      text: "Not sent to this member",
    });
    expect(onboardingLine("waived", false)).toEqual({ badge: "waived" });
    expect(onboardingLine("in_progress", false)).toEqual({
      badge: "in_progress",
    });
  });
});
