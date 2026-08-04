import { describe, it, expect } from "vitest";
import {
  SUPPLIER_ONBOARDING_STEP_KEYS,
  SupplierDocumentInput,
  SupplierImportRow,
  SupplierOnboardingSteps,
} from "../index";

// The import row's defaults are written straight into the `suppliers` table by
// the sheet parser (@quagga/core `parseSuppliersCsv`). If the standing default
// ever changed from `good`, every supplier imported from a blank Status cell
// would be silently re-graded, and nothing else in the codebase would notice.

describe("supplier onboarding step map", () => {
  it("accepts a fresh empty row and a partially-filled one", () => {
    // Partial by design: a missing key is treated as `pending` by the
    // derivation in @quagga/core, so `{}` must round-trip.
    expect(SupplierOnboardingSteps.parse({})).toEqual({});
    expect(
      SupplierOnboardingSteps.parse({
        registration_form: "completed",
        inventory_submitted: "awaiting_confirmation",
      }),
    ).toEqual({
      registration_form: "completed",
      inventory_submitted: "awaiting_confirmation",
    });
  });

  it("refuses an invalid step status", () => {
    expect(
      SupplierOnboardingSteps.safeParse({ registration_form: "done" }).success,
    ).toBe(false);
  });

  it("names the seven Supplier Depot steps in procedure order", () => {
    expect(SUPPLIER_ONBOARDING_STEP_KEYS).toEqual([
      "registration_form",
      "agreement_signed",
      "deposit_paid",
      "inventory_submitted",
      "crew_details_submitted",
      "briefing_attended",
      "registration_fee_paid",
    ]);
  });
});

describe("supplier import row", () => {
  it("defaults a name-only row to good standing, unknown returning, empty text", () => {
    // A blank Status cell in the AB sheet means "nothing recorded", which the
    // import treats as good standing — not as a caution.
    expect(SupplierImportRow.parse({ name: "LosKop Catering" })).toEqual({
      name: "LosKop Catering",
      services: "",
      contact: "",
      website: "",
      category: "",
      returning: null,
      standing: "good",
      onboarding: {},
    });
  });

  it("refuses a row with a blank name", () => {
    expect(SupplierImportRow.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("supplier document input", () => {
  const base = {
    title: "Supplier Agreement",
    sourceType: "link" as const,
    url: "https://example.com/agreement.pdf",
  };

  it("defaults to a non-acknowledged, unbound, unsorted document", () => {
    // `requiredAck` false and `stepKey` null matter: a document that defaulted
    // to binding an onboarding step would let a checkbox complete that step.
    const parsed = SupplierDocumentInput.parse(base);
    expect(parsed.requiredAck).toBe(false);
    expect(parsed.stepKey).toBe(null);
    expect(parsed.sort).toBe(null);
  });

  it("accepts an explicit step binding and sort order", () => {
    const parsed = SupplierDocumentInput.parse({
      ...base,
      requiredAck: true,
      stepKey: "agreement_signed",
      sort: 0,
    });
    expect(parsed.stepKey).toBe("agreement_signed");
    expect(parsed.sort).toBe(0);
  });

  it("refuses a link that is not a URL, with the authored message", () => {
    const parsed = SupplierDocumentInput.safeParse({
      ...base,
      url: "agreement.pdf",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      "That doesn't look like a valid link.",
    );
  });

  it("trims the title, requires one, and caps it", () => {
    expect(SupplierDocumentInput.parse({ ...base, title: "  Policy  " }).title).toBe(
      "Policy",
    );
    const blank = SupplierDocumentInput.safeParse({ ...base, title: "   " });
    expect(blank.success).toBe(false);
    expect(blank.error?.issues[0]?.message).toBe("Give the document a title.");
    expect(
      SupplierDocumentInput.safeParse({ ...base, title: "x".repeat(161) })
        .success,
    ).toBe(false);
  });

  it("bounds the sort order", () => {
    expect(SupplierDocumentInput.safeParse({ ...base, sort: -1 }).success).toBe(
      false,
    );
    expect(
      SupplierDocumentInput.safeParse({ ...base, sort: 10000 }).success,
    ).toBe(false);
    expect(SupplierDocumentInput.safeParse({ ...base, sort: 1.5 }).success).toBe(
      false,
    );
  });
});
