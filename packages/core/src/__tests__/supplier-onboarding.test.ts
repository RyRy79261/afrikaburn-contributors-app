import { describe, it, expect } from "vitest";
import {
  SUPPLIER_ONBOARDING_STEPS,
  SUPPLIER_ONBOARDING_STEP_COUNT,
  supplierOnboardingStep,
  stepFlow,
  isSelfServiceStep,
  isOrgConfirmedStep,
  isOrgReviewedStep,
  deriveOnboardingProgress,
  defaultOnboardingSteps,
  stepStatus,
  validateStepTransition,
  applyStepTransition,
} from "../supplier-onboarding";
import { SUPPLIER_ONBOARDING_STEP_KEYS } from "@quagga/types";
import type { SupplierOnboardingSteps } from "@quagga/types";

describe("SUPPLIER_ONBOARDING_STEPS catalog", () => {
  it("has exactly the seven spec steps in procedure order", () => {
    expect(SUPPLIER_ONBOARDING_STEP_COUNT).toBe(7);
    expect(SUPPLIER_ONBOARDING_STEPS.map((s) => s.key)).toEqual([
      "registration_form",
      "agreement_signed",
      "deposit_paid",
      "inventory_submitted",
      "crew_details_submitted",
      "briefing_attended",
      "registration_fee_paid",
    ]);
    SUPPLIER_ONBOARDING_STEPS.forEach((s, i) => expect(s.order).toBe(i + 1));
  });

  it("mirrors the every step key in @quagga/types", () => {
    expect(SUPPLIER_ONBOARDING_STEPS.map((s) => s.key)).toEqual([
      ...SUPPLIER_ONBOARDING_STEP_KEYS,
    ]);
  });

  it("carries corpus-grounded inline content on every step", () => {
    for (const step of SUPPLIER_ONBOARDING_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(20);
    }
  });

  it("classifies completes/confirms metadata per the spec table", () => {
    const byKey = Object.fromEntries(
      SUPPLIER_ONBOARDING_STEPS.map((s) => [s.key, s]),
    );
    // Self-service (supplier completes): 1 registration, 2 agreement.
    expect(stepFlow(byKey.registration_form!)).toBe("self_service");
    expect(byKey.registration_form!.confirmation).toBe("auto");
    expect(stepFlow(byKey.agreement_signed!)).toBe("self_service");
    expect(byKey.agreement_signed!.confirmation).toBe("org_may_revoke");
    // Org-reviewed (supplier submits, org reviews): 4 inventory, 5 crew.
    expect(stepFlow(byKey.inventory_submitted!)).toBe("org_reviewed");
    expect(stepFlow(byKey.crew_details_submitted!)).toBe("org_reviewed");
    // Org-confirmed (org only): 3 deposit, 6 briefing, 7 fee.
    expect(stepFlow(byKey.deposit_paid!)).toBe("org_confirmed");
    expect(stepFlow(byKey.briefing_attended!)).toBe("org_confirmed");
    expect(stepFlow(byKey.registration_fee_paid!)).toBe("org_confirmed");
  });

  it("exposes flow guards consistently", () => {
    const deposit = supplierOnboardingStep("deposit_paid")!;
    const inventory = supplierOnboardingStep("inventory_submitted")!;
    const reg = supplierOnboardingStep("registration_form")!;
    expect(isOrgConfirmedStep(deposit)).toBe(true);
    expect(isOrgReviewedStep(inventory)).toBe(true);
    expect(isSelfServiceStep(reg)).toBe(true);
    expect(supplierOnboardingStep("nope" as never)).toBeUndefined();
  });
});

describe("deriveOnboardingProgress", () => {
  it("treats a null/empty map as 0/7, not onboarded", () => {
    for (const states of [null, undefined, {}]) {
      const p = deriveOnboardingProgress(states);
      expect(p.completed).toBe(0);
      expect(p.total).toBe(7);
      expect(p.isOnboarded).toBe(false);
      expect(p.steps).toHaveLength(7);
      expect(p.steps.every((s) => s.status === "pending")).toBe(true);
    }
  });

  it("counts only completed toward n/7 (awaiting does not count)", () => {
    const states: SupplierOnboardingSteps = {
      registration_form: "completed",
      agreement_signed: "completed",
      deposit_paid: "completed",
      inventory_submitted: "awaiting_confirmation",
    };
    const p = deriveOnboardingProgress(states);
    expect(p.completed).toBe(3);
    expect(p.awaiting).toBe(1);
    expect(p.isOnboarded).toBe(false);
  });

  it("isOnboarded is true only when all seven are completed", () => {
    const all: SupplierOnboardingSteps = {};
    for (const k of SUPPLIER_ONBOARDING_STEP_KEYS) all[k] = "completed";
    const p = deriveOnboardingProgress(all);
    expect(p.completed).toBe(7);
    expect(p.isOnboarded).toBe(true);
  });

  it("defaultOnboardingSteps seeds all seven as pending", () => {
    const d = defaultOnboardingSteps();
    expect(Object.keys(d)).toHaveLength(7);
    expect(Object.values(d).every((v) => v === "pending")).toBe(true);
  });

  it("stepStatus falls back to pending for a missing key", () => {
    expect(stepStatus({ deposit_paid: "completed" }, "deposit_paid")).toBe(
      "completed",
    );
    expect(stepStatus({}, "briefing_attended")).toBe("pending");
  });
});

describe("validateStepTransition — self-service vs org-confirmed", () => {
  it("a supplier CANNOT flip an org-confirmed step (deposit/briefing/fee)", () => {
    for (const stepKey of [
      "deposit_paid",
      "briefing_attended",
      "registration_fee_paid",
    ] as const) {
      const r = validateStepTransition({
        actor: "supplier",
        stepKey,
        from: "pending",
        to: "completed",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/only afrikaburn/i);
    }
  });

  it("the org CAN confirm those same steps", () => {
    for (const stepKey of [
      "deposit_paid",
      "briefing_attended",
      "registration_fee_paid",
    ] as const) {
      expect(
        validateStepTransition({
          actor: "org",
          stepKey,
          from: "pending",
          to: "completed",
        }).ok,
      ).toBe(true);
    }
  });

  it("a supplier CAN complete a self-service step and undo it", () => {
    expect(
      validateStepTransition({
        actor: "supplier",
        stepKey: "registration_form",
        from: "pending",
        to: "completed",
      }).ok,
    ).toBe(true);
    expect(
      validateStepTransition({
        actor: "supplier",
        stepKey: "agreement_signed",
        from: "completed",
        to: "pending",
      }).ok,
    ).toBe(true);
  });

  it("a supplier can SUBMIT an org-reviewed step but not mark it complete", () => {
    // submit ok
    expect(
      validateStepTransition({
        actor: "supplier",
        stepKey: "inventory_submitted",
        from: "pending",
        to: "awaiting_confirmation",
      }).ok,
    ).toBe(true);
    // self-confirm rejected — the headline invariant for review steps
    const r = validateStepTransition({
      actor: "supplier",
      stepKey: "crew_details_submitted",
      from: "awaiting_confirmation",
      to: "completed",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/afrikaburn must review/i);
  });

  it("the org completes an org-reviewed step from awaiting", () => {
    expect(
      validateStepTransition({
        actor: "org",
        stepKey: "inventory_submitted",
        from: "awaiting_confirmation",
        to: "completed",
      }).ok,
    ).toBe(true);
  });

  it("rejects a no-op transition and an unknown step", () => {
    expect(
      validateStepTransition({
        actor: "org",
        stepKey: "deposit_paid",
        from: "completed",
        to: "completed",
      }).ok,
    ).toBe(false);
    expect(
      validateStepTransition({
        actor: "org",
        stepKey: "made_up" as never,
        from: "pending",
        to: "completed",
      }).ok,
    ).toBe(false);
  });

  it("a supplier cannot jump a self-service step straight to awaiting", () => {
    expect(
      validateStepTransition({
        actor: "supplier",
        stepKey: "registration_form",
        from: "pending",
        to: "awaiting_confirmation",
      }).ok,
    ).toBe(false);
  });
});

describe("applyStepTransition", () => {
  it("validates against current state and returns a NEW map without mutating", () => {
    const before: SupplierOnboardingSteps = { registration_form: "pending" };
    const res = applyStepTransition(
      before,
      "supplier",
      "registration_form",
      "completed",
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.steps.registration_form).toBe("completed");
      // input untouched
      expect(before.registration_form).toBe("pending");
    }
  });

  it("refuses a supplier self-confirming an org step, leaving state unchanged", () => {
    const res = applyStepTransition(
      null,
      "supplier",
      "deposit_paid",
      "completed",
    );
    expect(res.ok).toBe(false);
  });

  it("reads the implicit pending 'from' for a missing key", () => {
    const res = applyStepTransition(
      {},
      "org",
      "briefing_attended",
      "completed",
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.steps.briefing_attended).toBe("completed");
  });
});
