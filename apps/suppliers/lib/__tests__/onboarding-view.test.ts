import { describe, expect, it } from "vitest";
import {
  SUPPLIER_ONBOARDING_STEPS,
  supplierOnboardingStep,
  type SupplierOnboardingStepView,
} from "@quagga/core";
import type { SupplierOnboardingStepStatus } from "@quagga/types";
import { buildStepCardModel, supplierCodeChipValue } from "../onboarding-view";

function view(
  key: Parameters<typeof supplierOnboardingStep>[0],
  status: SupplierOnboardingStepStatus,
): SupplierOnboardingStepView {
  const step = supplierOnboardingStep(key);
  if (!step) throw new Error(`no step ${key}`);
  return { step, status };
}

describe("buildStepCardModel", () => {
  it("covers every catalog step without throwing", () => {
    for (const step of SUPPLIER_ONBOARDING_STEPS) {
      const model = buildStepCardModel({ step, status: "pending" });
      expect(model.flow).toBeDefined();
      expect(model.statusLabel.length).toBeGreaterThan(0);
    }
  });

  describe("self-service steps (registration_form, agreement_signed)", () => {
    it("offers 'Mark done' → completed when pending", () => {
      const m = buildStepCardModel(view("agreement_signed", "pending"));
      expect(m.flow).toBe("self_service");
      expect(m.supplierActionable).toBe(true);
      expect(m.primaryAction).toEqual({ label: "Mark done", to: "completed" });
    });

    it("offers 'Undo' → pending when completed", () => {
      const m = buildStepCardModel(view("agreement_signed", "completed"));
      expect(m.tone).toBe("done");
      expect(m.secondaryAction).toEqual({ label: "Undo", to: "pending" });
      expect(m.primaryAction).toBeUndefined();
    });
  });

  describe("org-reviewed steps (inventory, crew)", () => {
    it("offers 'Submit for review' → awaiting_confirmation, never complete", () => {
      const m = buildStepCardModel(view("inventory_submitted", "pending"));
      expect(m.flow).toBe("org_reviewed");
      expect(m.primaryAction).toEqual({
        label: "Submit for review",
        to: "awaiting_confirmation",
      });
    });

    it("shows awaiting + withdraw once submitted", () => {
      const m = buildStepCardModel(
        view("crew_details_submitted", "awaiting_confirmation"),
      );
      expect(m.tone).toBe("awaiting");
      expect(m.statusLabel).toMatch(/awaiting/i);
      expect(m.supplierActionable).toBe(false);
      expect(m.secondaryAction?.to).toBe("pending");
    });

    it("leaves nothing for the supplier once org-completed", () => {
      const m = buildStepCardModel(view("inventory_submitted", "completed"));
      expect(m.supplierActionable).toBe(false);
      expect(m.primaryAction).toBeUndefined();
      expect(m.secondaryAction).toBeUndefined();
    });
  });

  describe("org-confirmed steps (deposit, briefing, fee)", () => {
    it("are never supplier-actionable and read 'Awaiting AfrikaBurn' when pending", () => {
      for (const key of [
        "deposit_paid",
        "briefing_attended",
        "registration_fee_paid",
      ] as const) {
        const m = buildStepCardModel(view(key, "pending"));
        expect(m.flow).toBe("org_confirmed");
        expect(m.supplierActionable).toBe(false);
        expect(m.primaryAction).toBeUndefined();
        expect(m.statusLabel).toMatch(/awaiting afrikaburn/i);
      }
    });
  });
});

// Regression: the Progress panel's SUPPLIER CODE chip (canvas `D6Xsb`) was
// designed but never rendered — `SupplierIdentity` did not carry the column at
// all. Now that it does, the one rule that must not regress is the honest-empty
// one: a supplier with no code yet renders NOTHING, never a stand-in that reads
// like a real identifier.
describe("supplierCodeChipValue", () => {
  it("passes an issued code straight through", () => {
    expect(supplierCodeChipValue("SUP-2027-0416")).toBe("SUP-2027-0416");
  });

  it("renders nothing for an imported row that has no code yet", () => {
    expect(supplierCodeChipValue(null)).toBeNull();
    expect(supplierCodeChipValue(undefined)).toBeNull();
  });

  it("treats a blank or whitespace-only value as no code", () => {
    expect(supplierCodeChipValue("")).toBeNull();
    expect(supplierCodeChipValue("   ")).toBeNull();
  });

  it("trims incidental whitespace without reformatting the code", () => {
    expect(supplierCodeChipValue("  SUP-2027-0416 ")).toBe("SUP-2027-0416");
  });

  it("never invents a placeholder for a missing code", () => {
    // Guards the specific defect shape: any non-null return here would put a
    // fake identifier on a chip that suppliers quote off-platform.
    for (const empty of [null, undefined, "", " ", "\t\n"]) {
      expect(supplierCodeChipValue(empty)).toBeNull();
    }
  });
});
