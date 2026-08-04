import { describe, it, expect } from "vitest";
import {
  SUPPLIER_STANDINGS,
  isSuspended,
  standingRequiresCaution,
  standingLabel,
  standingDescription,
  standingTone,
  supplierPickerEligibility,
  filterPickerEligible,
} from "../supplier-standing";

describe("supplier standing helpers", () => {
  it("enumerates all five standings, positives first, in display order", () => {
    expect([...SUPPLIER_STANDINGS]).toEqual([
      "good",
      "diligent_first_timer",
      "adapting",
      "absolute_beginner",
      "watch",
      "suspended",
    ]);
  });

  it("suspended is suspended; nothing else is", () => {
    expect(isSuspended("suspended")).toBe(true);
    expect(isSuspended("watch")).toBe(false);
    expect(isSuspended("good")).toBe(false);
    expect(isSuspended("diligent_first_timer")).toBe(false);
    expect(isSuspended("adapting")).toBe(false);
  });

  it("only watch requires caution (the new positive standings do not)", () => {
    expect(standingRequiresCaution("watch")).toBe(true);
    expect(standingRequiresCaution("good")).toBe(false);
    expect(standingRequiresCaution("suspended")).toBe(false);
    expect(standingRequiresCaution("diligent_first_timer")).toBe(false);
    expect(standingRequiresCaution("adapting")).toBe(false);
    expect(standingRequiresCaution("absolute_beginner")).toBe(false);
  });

  it("gives the new standings their real sheet/policy labels", () => {
    expect(standingLabel("diligent_first_timer")).toBe("Diligent First Timer");
    expect(standingLabel("adapting")).toBe("Able & Willing To Adapt");
    expect(standingLabel("absolute_beginner")).toBe("Absolute Beginners");
  });

  it("labels and supplier-facing descriptions exist for every standing", () => {
    for (const s of SUPPLIER_STANDINGS) {
      expect(standingLabel(s).length).toBeGreaterThan(0);
      expect(standingDescription(s).length).toBeGreaterThan(0);
    }
  });

  it("maps positive standings to a success tone, watch → warning, suspended → destructive", () => {
    expect(standingTone("good")).toBe("success");
    expect(standingTone("diligent_first_timer")).toBe("success");
    expect(standingTone("adapting")).toBe("success");
    expect(standingTone("absolute_beginner")).toBe("success");
    expect(standingTone("watch")).toBe("warning");
    expect(standingTone("suspended")).toBe("destructive");
  });
});

describe("supplierPickerEligibility", () => {
  it("suspended suppliers are excluded from the picker", () => {
    const e = supplierPickerEligibility({
      standing: "suspended",
      isOnboarded: true,
    });
    expect(e.eligible).toBe(false);
  });

  it("good + onboarded renders normally with no tags", () => {
    const e = supplierPickerEligibility({
      standing: "good",
      isOnboarded: true,
    });
    expect(e.eligible).toBe(true);
    expect(e.caution).toBe(false);
    expect(e.tags).toEqual([]);
  });

  it("the new positive standings are eligible with no caution", () => {
    for (const standing of [
      "diligent_first_timer",
      "adapting",
      "absolute_beginner",
    ] as const) {
      const e = supplierPickerEligibility({ standing, isOnboarded: true });
      expect(e.eligible).toBe(true);
      expect(e.caution).toBe(false);
    }
  });

  it("watch is eligible but flagged with caution", () => {
    const e = supplierPickerEligibility({
      standing: "watch",
      isOnboarded: true,
    });
    expect(e.eligible).toBe(true);
    expect(e.caution).toBe(true);
  });

  it("incomplete onboarding is shown (not hidden) with an onboarding_incomplete tag", () => {
    const e = supplierPickerEligibility({
      standing: "good",
      isOnboarded: false,
    });
    expect(e.eligible).toBe(true);
    expect(e.tags).toContain("onboarding_incomplete");
  });

  it("suspended + incomplete is still excluded (standing wins)", () => {
    const e = supplierPickerEligibility({
      standing: "suspended",
      isOnboarded: false,
    });
    expect(e.eligible).toBe(false);
    expect(e.tags).toContain("onboarding_incomplete");
  });
});

describe("filterPickerEligible", () => {
  it("drops suspended rows and attaches an eligibility descriptor to survivors", () => {
    const suppliers = [
      { id: "a", standing: "good" as const, isOnboarded: true },
      { id: "b", standing: "watch" as const, isOnboarded: false },
      { id: "c", standing: "suspended" as const, isOnboarded: true },
    ];
    const out = filterPickerEligible(suppliers);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    const watched = out.find((s) => s.id === "b")!;
    expect(watched.eligibility.caution).toBe(true);
    expect(watched.eligibility.tags).toContain("onboarding_incomplete");
  });
});
