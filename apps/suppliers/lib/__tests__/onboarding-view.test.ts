import { describe, expect, it } from "vitest";
import {
  SUPPLIER_ONBOARDING_STEPS,
  supplierOnboardingStep,
  type SupplierOnboardingStepView,
} from "@quagga/core";
import type { SupplierOnboardingStepStatus } from "@quagga/types";
import {
  buildStepCardModel,
  stepEyebrow,
  supplierCodeChipValue,
} from "../onboarding-view";

function view(
  key: Parameters<typeof supplierOnboardingStep>[0],
  status: SupplierOnboardingStepStatus,
): SupplierOnboardingStepView {
  const step = supplierOnboardingStep(key);
  if (!step) throw new Error(`no step ${key}`);
  return { step, status };
}

describe("buildStepCardModel", () => {
  it("gives every catalog step a flow that matches who may act on it", () => {
    // REPLACES an earlier case that asserted only `toBeDefined()` and a
    // non-zero length — which cannot fail for any reason worth catching, since
    // every branch of `buildStepCardModel` returns both fields. This asserts
    // the actual invariant instead: the flow is derived from the step's
    // `completedBy`/`confirmation` metadata, and `supplierActionable` must
    // agree with it. A new step whose metadata falls through the classifiers
    // fails here rather than rendering a card with no buttons and no
    // explanation.
    for (const step of SUPPLIER_ONBOARDING_STEPS) {
      const model = buildStepCardModel({ step, status: "pending" });

      expect(model.flow).toBe(
        step.confirmation === "org_confirms"
          ? "org_confirmed"
          : step.confirmation === "org_reviews"
            ? "org_reviewed"
            : "self_service",
      );
      expect(model.supplierActionable).toBe(model.flow !== "org_confirmed");
      expect(Boolean(model.primaryAction)).toBe(model.flow !== "org_confirmed");
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

// The card eyebrow ("Step 3 · Org confirms", canvas Q4fye). It encodes the
// who-completes / who-confirms model so a supplier sees, at a glance, who
// drives each step — which is the difference between "I'm waiting on
// AfrikaBurn" and "AfrikaBurn is waiting on me".
//
// `stepEyebrow` is a switch with NO default. Adding a fifth confirmation type
// to the core catalog makes it fall through and return `undefined`, rendering
// "Step 3 · undefined" on a card. TypeScript catches that only while the union
// is exhaustive; the last case here catches it at runtime for a catalog that
// grows.
describe("stepEyebrow", () => {
  function eyebrowFor(key: Parameters<typeof supplierOnboardingStep>[0]) {
    const step = supplierOnboardingStep(key);
    if (!step) throw new Error(`no step ${key}`);
    return stepEyebrow(step);
  }

  it("reads 'You complete · Auto-confirmed' for an auto step", () => {
    expect(eyebrowFor("registration_form")).toBe(
      "Step 1 · You complete · Auto-confirmed",
    );
  });

  it("reads 'You confirm · Org may revoke' for a revocable self-service step", () => {
    // The supplier marks it done themselves, and AfrikaBurn can take it back —
    // the deposit refund hangs off adherence to the agreement.
    expect(eyebrowFor("agreement_signed")).toBe(
      "Step 2 · You confirm · Org may revoke",
    );
  });

  it("reads 'You submit · Org reviews' for an org-reviewed step", () => {
    expect(eyebrowFor("inventory_submitted")).toBe(
      "Step 4 · You submit · Org reviews",
    );
  });

  it("reads 'Org confirms' for a step the supplier cannot touch", () => {
    expect(eyebrowFor("deposit_paid")).toBe("Step 3 · Org confirms");
  });

  it("prefixes every eyebrow with the step's own order number", () => {
    for (const step of SUPPLIER_ONBOARDING_STEPS) {
      expect(stepEyebrow(step)).toMatch(new RegExp(`^Step ${step.order} · `));
    }
  });

  it("gives every catalog step a non-empty who-clause", () => {
    // A new confirmation type fails loudly HERE rather than rendering
    // "Step 3 · undefined" to a supplier.
    for (const step of SUPPLIER_ONBOARDING_STEPS) {
      const who = stepEyebrow(step).split(" · ").slice(1).join(" · ");
      expect(who).not.toBe("");
      expect(who).not.toContain("undefined");
    }
  });
});
