// specs/supplier/documents.spec.ts — supplier document acknowledgement drives a
// bound onboarding step (M3-28, docs/supplier-spec.md / accounts-security-spec.md
// §"Supplier documents"). The org publishes a required document BOUND to the
// self-service "Supplier agreement signed" step; acknowledging it completes that
// step, and withdrawing the acknowledgement reverts it — a green step whose
// evidence was withdrawn would be a lie.
//
// Needs a pre-provisioned god account to publish the document (org-only surface),
// so this whole spec skipUnlessGod. Documents are edition-global (shared by every
// supplier of the active edition), so the published document is given a unique
// title and left in place — acceptable on the throwaway E2E Neon branch that CI
// deletes on completion (README "Cleanup / isolation"); it never reverts another
// supplier's button-completed step because reconciliation only runs on an ack.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { registerSupplier, elevateToGod } from "../../personas/factories";
import { orgCreateDocument } from "./support";

test.describe("supplier document acknowledgement", () => {
  test("acknowledging a bound required document completes the step; withdrawing reverts it", async ({
    suppliersPage,
    orgPage,
  }) => {
    skipUnlessGod();

    // Org publishes a required document bound to the agreement step.
    const title = `E2E Supplier Agreement ${Date.now().toString(36)}`;
    await elevateToGod(orgPage);
    await orgCreateDocument(orgPage, {
      title,
      url: "https://example.com/e2e-supplier-agreement.pdf",
      bindStepLabel: "Supplier agreement signed",
    });

    // A fresh supplier sees the document on its onboarding page, with the bound
    // step still to-do.
    await registerSupplier(suppliersPage, { category: "Transport" });
    await suppliersPage.goto("/onboarding");
    await expect(
      suppliersPage.getByRole("heading", { name: /documents & links/i }),
    ).toBeVisible();

    const agreement = suppliersPage
      .getByRole("listitem")
      .filter({ hasText: "Supplier agreement signed" });
    await expect(agreement.getByText(/^to do$/i)).toBeVisible();
    await expect(suppliersPage.getByText(/1 of 7 steps complete/i)).toBeVisible();

    // Acknowledge the bound document → the step completes (1/7 → 2/7).
    const ack = suppliersPage.getByRole("checkbox", {
      name: new RegExp(`read ${title}`, "i"),
    });
    // `.click()`, NOT `.check()`. The box is not self-checking: documents-panel
    // calls the server action and then `router.refresh()`, so the input stays
    // unchecked until the refreshed server render arrives. `.check()` clicks and
    // then asserts the new state IMMEDIATELY, which is a race it loses —
    // "Clicking the checkbox did not change its state" is the panel behaving as
    // designed. The progress line below is the real proof the write landed.
    await ack.click();
    await expect(suppliersPage.getByText(/2 of 7 steps complete/i)).toBeVisible();
    await expect(ack).toBeChecked();
    await expect(
      agreement.getByText(/you['’]ve acknowledged the supplier agreement/i),
    ).toBeVisible();

    // Withdraw the acknowledgement → the step reverts (2/7 → 1/7).
    await ack.click();
    await expect(suppliersPage.getByText(/1 of 7 steps complete/i)).toBeVisible();
    await expect(ack).not.toBeChecked();
    await expect(agreement.getByText(/^to do$/i)).toBeVisible();
  });
});
