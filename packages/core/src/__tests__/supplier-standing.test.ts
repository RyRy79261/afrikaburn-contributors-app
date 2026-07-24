import { describe, it, expect } from "vitest";
import {
  SUPPLIER_STANDINGS,
  isSuspended,
  standingRequiresCaution,
  standingLabel,
  standingDescription,
  supplierPickerEligibility,
  filterPickerEligible,
} from "../supplier-standing";

describe("supplier standing helpers", () => {
  it("enumerates good / watch / suspended in severity order", () => {
    expect([...SUPPLIER_STANDINGS]).toEqual(["good", "watch", "suspended"]);
  });

  it("suspended is suspended; nothing else is", () => {
    expect(isSuspended("suspended")).toBe(true);
    expect(isSuspended("watch")).toBe(false);
    expect(isSuspended("good")).toBe(false);
  });

  it("only watch requires caution", () => {
    expect(standingRequiresCaution("watch")).toBe(true);
    expect(standingRequiresCaution("good")).toBe(false);
    expect(standingRequiresCaution("suspended")).toBe(false);
  });

  it("labels and supplier-facing descriptions exist for every standing", () => {
    for (const s of SUPPLIER_STANDINGS) {
      expect(standingLabel(s).length).toBeGreaterThan(0);
      expect(standingDescription(s).length).toBeGreaterThan(0);
    }
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
    const e = supplierPickerEligibility({ standing: "good", isOnboarded: true });
    expect(e.eligible).toBe(true);
    expect(e.caution).toBe(false);
    expect(e.tags).toEqual([]);
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
