import { describe, it, expect } from "vitest";
import {
  sortDocuments,
  buildDocumentViews,
  documentsForStep,
  requiredAckDocuments,
  deriveDocumentAckProgress,
  validateDocumentBinding,
  satisfiedStepKeys,
  isStepSatisfiedByAcks,
  applyDocumentAcksToSteps,
  type SupplierDocument,
  type SupplierDocumentAck,
} from "../supplier-documents";
import type { SupplierOnboardingSteps } from "@quagga/types";

const AT = new Date("2026-07-25T10:00:00.000Z");

function doc(
  overrides: Partial<SupplierDocument> & { id: string },
): SupplierDocument {
  return {
    title: `Document ${overrides.id}`,
    sourceType: "link",
    url: `https://example.com/${overrides.id}`,
    requiredAck: false,
    stepKey: null,
    sort: 0,
    ...overrides,
  };
}

function ack(documentId: string): SupplierDocumentAck {
  return { documentId, ackedAt: AT };
}

describe("sortDocuments", () => {
  it("orders by sort, then title, then id — stable across renders", () => {
    const docs = [
      doc({ id: "c", sort: 1, title: "Zebra" }),
      doc({ id: "a", sort: 0, title: "Beta" }),
      doc({ id: "b", sort: 0, title: "alpha" }),
    ];
    expect(sortDocuments(docs).map((d) => d.id)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate the input", () => {
    const docs = [doc({ id: "b", sort: 1 }), doc({ id: "a", sort: 0 })];
    sortDocuments(docs);
    expect(docs.map((d) => d.id)).toEqual(["b", "a"]);
  });
});

describe("buildDocumentViews", () => {
  const docs = [
    doc({ id: "agreement", requiredAck: true, sort: 0 }),
    doc({ id: "policy", requiredAck: true, sort: 1 }),
    doc({ id: "map", requiredAck: false, sort: 2 }),
  ];

  it("joins acknowledgements and flags what is outstanding", () => {
    const views = buildDocumentViews(docs, [ack("agreement")]);
    expect(views.map((v) => [v.document.id, v.acked, v.outstanding])).toEqual([
      ["agreement", true, false],
      ["policy", false, true],
      ["map", false, false], // optional reading is never "outstanding"
    ]);
  });

  it("carries the acknowledgement timestamp through", () => {
    const [first] = buildDocumentViews(docs, [ack("agreement")]);
    expect(first?.ackedAt).toEqual(AT);
  });

  it("ignores acks for documents that are not in the list", () => {
    const views = buildDocumentViews(docs, [ack("withdrawn-document")]);
    expect(views.every((v) => !v.acked)).toBe(true);
  });
});

describe("deriveDocumentAckProgress", () => {
  const docs = [
    doc({ id: "a", requiredAck: true }),
    doc({ id: "b", requiredAck: true }),
    doc({ id: "c", requiredAck: false }),
  ];

  it("counts only the REQUIRED documents", () => {
    const progress = deriveDocumentAckProgress(docs, [ack("a"), ack("c")]);
    expect(progress.required).toBe(2);
    expect(progress.acked).toBe(1);
    expect(progress.allAcknowledged).toBe(false);
    expect(progress.outstanding.map((d) => d.id)).toEqual(["b"]);
  });

  it("is vacuously complete when nothing requires acknowledgement", () => {
    const progress = deriveDocumentAckProgress(
      [doc({ id: "c", requiredAck: false })],
      [],
    );
    expect(progress.required).toBe(0);
    expect(progress.allAcknowledged).toBe(true);
  });
});

describe("documentsForStep / requiredAckDocuments", () => {
  const docs = [
    doc({ id: "a", stepKey: "agreement_signed", requiredAck: true, sort: 1 }),
    doc({ id: "b", stepKey: "agreement_signed", requiredAck: true, sort: 0 }),
    doc({ id: "c", stepKey: "registration_form", requiredAck: true }),
    doc({ id: "d", stepKey: null, requiredAck: false }),
  ];

  it("filters to a step, in catalog order", () => {
    expect(documentsForStep(docs, "agreement_signed").map((d) => d.id)).toEqual(
      ["b", "a"],
    );
  });

  it("filters to the acknowledgeable documents", () => {
    expect(
      requiredAckDocuments(docs)
        .map((d) => d.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });
});

// --- The binding rule -----------------------------------------------------

describe("validateDocumentBinding", () => {
  it("allows no binding at all", () => {
    expect(validateDocumentBinding(null, false).ok).toBe(true);
    expect(validateDocumentBinding(undefined, true).ok).toBe(true);
  });

  it("allows binding to a SELF-SERVICE step", () => {
    expect(validateDocumentBinding("agreement_signed", true).ok).toBe(true);
    expect(validateDocumentBinding("registration_form", true).ok).toBe(true);
  });

  it("REJECTS binding to an org-confirmed step — money and attendance", () => {
    // A supplier ticking a checkbox must never confirm that a deposit arrived
    // or that they attended a briefing.
    for (const step of [
      "deposit_paid",
      "briefing_attended",
      "registration_fee_paid",
    ] as const) {
      const result = validateDocumentBinding(step, true);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("AfrikaBurn");
    }
  });

  it("REJECTS binding to an org-REVIEWED step", () => {
    // Inventory and crew details need AfrikaBurn's review; an acknowledgement
    // can only ever produce `awaiting_confirmation`, never completion.
    expect(validateDocumentBinding("inventory_submitted", true).ok).toBe(false);
    expect(validateDocumentBinding("crew_details_submitted", true).ok).toBe(
      false,
    );
  });

  it("REJECTS an inert binding on a document that needs no acknowledgement", () => {
    const result = validateDocumentBinding("agreement_signed", false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("acknowledgement");
  });

  it("rejects an unknown step key", () => {
    const result = validateDocumentBinding(
      "not_a_step" as Parameters<typeof validateDocumentBinding>[0],
      true,
    );
    expect(result.ok).toBe(false);
  });
});

// --- Ack → step completion ------------------------------------------------

describe("ack → step completion", () => {
  const agreementDocs = [
    doc({ id: "d1", stepKey: "agreement_signed", requiredAck: true }),
    doc({ id: "d2", stepKey: "agreement_signed", requiredAck: true }),
    doc({ id: "d3", stepKey: null, requiredAck: true }),
  ];

  it("needs EVERY bound document acknowledged to satisfy a step", () => {
    expect(
      isStepSatisfiedByAcks(agreementDocs, [ack("d1")], "agreement_signed"),
    ).toBe(false);
    expect(
      isStepSatisfiedByAcks(
        agreementDocs,
        [ack("d1"), ack("d2")],
        "agreement_signed",
      ),
    ).toBe(true);
  });

  it("is NOT satisfied when no document is bound to the step", () => {
    expect(isStepSatisfiedByAcks(agreementDocs, [], "registration_form")).toBe(
      false,
    );
  });

  it("lists the satisfied steps", () => {
    expect(satisfiedStepKeys(agreementDocs, [ack("d1"), ack("d2")])).toEqual([
      "agreement_signed",
    ]);
    expect(satisfiedStepKeys(agreementDocs, [ack("d1")])).toEqual([]);
  });

  it("COMPLETES the bound step when the last document is acknowledged", () => {
    const before: SupplierOnboardingSteps = { agreement_signed: "pending" };
    const result = applyDocumentAcksToSteps(before, agreementDocs, [
      ack("d1"),
      ack("d2"),
    ]);
    expect(result.steps.agreement_signed).toBe("completed");
    expect(result.completed).toEqual(["agreement_signed"]);
    expect(result.reverted).toEqual([]);
  });

  it("REVERTS the step when an acknowledgement is withdrawn", () => {
    // A step that stayed green after its evidence was withdrawn would be a lie
    // in the org's console.
    const before: SupplierOnboardingSteps = { agreement_signed: "completed" };
    const result = applyDocumentAcksToSteps(before, agreementDocs, [ack("d1")]);
    expect(result.steps.agreement_signed).toBe("pending");
    expect(result.reverted).toEqual(["agreement_signed"]);
    expect(result.completed).toEqual([]);
  });

  it("re-opens a completed step when the org adds a NEW required document", () => {
    const before: SupplierOnboardingSteps = { agreement_signed: "completed" };
    const withNewDoc = [
      ...agreementDocs,
      doc({ id: "d4", stepKey: "agreement_signed", requiredAck: true }),
    ];
    const result = applyDocumentAcksToSteps(before, withNewDoc, [
      ack("d1"),
      ack("d2"),
    ]);
    expect(result.steps.agreement_signed).toBe("pending");
    expect(result.reverted).toEqual(["agreement_signed"]);
  });

  it("is idempotent — reapplying the same state changes nothing", () => {
    const acks = [ack("d1"), ack("d2")];
    const once = applyDocumentAcksToSteps({}, agreementDocs, acks);
    const twice = applyDocumentAcksToSteps(once.steps, agreementDocs, acks);
    expect(twice.steps).toEqual(once.steps);
    expect(twice.completed).toEqual([]);
    expect(twice.reverted).toEqual([]);
  });

  it("leaves steps that no document is bound to entirely alone", () => {
    const before: SupplierOnboardingSteps = {
      deposit_paid: "completed",
      inventory_submitted: "awaiting_confirmation",
    };
    const result = applyDocumentAcksToSteps(before, agreementDocs, [
      ack("d1"),
      ack("d2"),
    ]);
    expect(result.steps.deposit_paid).toBe("completed");
    expect(result.steps.inventory_submitted).toBe("awaiting_confirmation");
  });

  // --- audit M17: the org deletes/rebinds a document -------------------
  //
  // The reconcile set is derived from the CURRENT document list, so a step whose
  // last bound document just vanished was not looked at and kept a stale
  // `completed` — the console reporting a supplier as signed for a document that
  // no longer exists. `alsoConsider` forces those steps back into the loop.

  it("re-opens a step whose last bound document was deleted", () => {
    const before: SupplierOnboardingSteps = { agreement_signed: "completed" };
    // The org deleted every document bound to the step: empty list now.
    const result = applyDocumentAcksToSteps(
      before,
      [],
      [],
      ["agreement_signed"],
    );
    expect(result.reverted).toEqual(["agreement_signed"]);
    expect(result.steps.agreement_signed).toBe("pending");
  });

  it("WITHOUT alsoConsider the stale completed survives — the bug itself", () => {
    // Pinning the old behaviour as the reason the parameter exists: same inputs,
    // no alsoConsider, and the lie stands.
    const before: SupplierOnboardingSteps = { agreement_signed: "completed" };
    const result = applyDocumentAcksToSteps(before, [], []);
    expect(result.reverted).toEqual([]);
    expect(result.steps.agreement_signed).toBe("completed");
  });

  it("COMPLETES a step when deleting a document leaves the rest acknowledged", () => {
    // The mirror image, and the reason the org sweep covers every supplier
    // rather than only the deleted document's ack-holders: A and B are both
    // bound and required, the supplier acked only B, so the step is pending.
    // The org deletes A — B is now the sole required document and it IS acked,
    // so the step must COMPLETE for a supplier who never touched A.
    const before: SupplierOnboardingSteps = { agreement_signed: "pending" };
    const remaining = [
      doc({ id: "d2", stepKey: "agreement_signed", requiredAck: true }),
    ];
    const result = applyDocumentAcksToSteps(
      before,
      remaining,
      [ack("d2")],
      ["agreement_signed"],
    );
    expect(result.completed).toEqual(["agreement_signed"]);
    expect(result.steps.agreement_signed).toBe("completed");
  });

  it("alsoConsider still cannot touch an org-confirmed step", () => {
    // The escape hatch must not become a way to move money-confirming steps.
    const before: SupplierOnboardingSteps = { deposit_paid: "completed" };
    const result = applyDocumentAcksToSteps(before, [], [], ["deposit_paid"]);
    expect(result.reverted).toEqual([]);
    expect(result.steps.deposit_paid).toBe("completed");
  });

  it("NEVER completes an org-confirmed step, even from a malformed binding", () => {
    // Defence in depth: `validateDocumentBinding` should have refused this
    // binding at write time, but if a bad row exists, applying it must not
    // hand a supplier the power to confirm a deposit.
    const rogue = [
      doc({ id: "x", stepKey: "deposit_paid", requiredAck: true }),
    ];
    const result = applyDocumentAcksToSteps(
      { deposit_paid: "pending" },
      rogue,
      [ack("x")],
    );
    expect(result.steps.deposit_paid).toBe("pending");
    expect(result.completed).toEqual([]);
  });

  it("NEVER completes an org-reviewed step from an acknowledgement", () => {
    const rogue = [
      doc({ id: "y", stepKey: "inventory_submitted", requiredAck: true }),
    ];
    const result = applyDocumentAcksToSteps(
      { inventory_submitted: "pending" },
      rogue,
      [ack("y")],
    );
    expect(result.steps.inventory_submitted).toBe("pending");
    expect(result.completed).toEqual([]);
  });

  it("does not mutate the input step map", () => {
    const before: SupplierOnboardingSteps = { agreement_signed: "pending" };
    applyDocumentAcksToSteps(before, agreementDocs, [ack("d1"), ack("d2")]);
    expect(before.agreement_signed).toBe("pending");
  });

  it("handles a null step map (a fresh supplier)", () => {
    const result = applyDocumentAcksToSteps(null, agreementDocs, [
      ack("d1"),
      ack("d2"),
    ]);
    expect(result.steps.agreement_signed).toBe("completed");
  });
});
