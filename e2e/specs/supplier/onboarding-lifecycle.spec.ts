// specs/supplier/onboarding-lifecycle.spec.ts — the seven-step Supplier Depot
// checklist, driven end to end (M3-28, docs/supplier-spec.md §Onboarding).
//
// The rule that matters (packages/core supplier-onboarding.ts):
//   - self-service steps (agreement) flip pending↔completed instantly;
//   - org-reviewed steps (inventory, crew) the supplier can SUBMIT (→ awaiting)
//     and WITHDRAW, but never mark complete;
//   - org-confirmed steps (deposit, briefing, fee) the supplier cannot touch at
//     all — they show "awaiting AfrikaBurn" and offer NO control.
//
// The org-confirmed boundary is asserted two ways below: the copy says it, AND
// the card exposes zero buttons (the affordance is absent, not merely hidden).
// See the report for why the deepest server-refusal of a forged org-confirmed
// transition is proven by @quagga/core unit tests rather than here.

import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import { registerSupplier } from "../../personas/factories";

/** The onboarding <li> whose card carries a given step title. */
function stepCard(page: Page, title: string) {
  return page.getByRole("listitem").filter({ hasText: title });
}

async function registerAndLand(suppliersPage: Page): Promise<void> {
  await registerSupplier(suppliersPage, { category: "Transport" });
  await expect(
    suppliersPage.getByRole("heading", { name: /your onboarding checklist/i }),
  ).toBeVisible();
}

test.describe("supplier onboarding lifecycle", () => {
  test("a supplier signs the agreement (self-service step completes instantly)", async ({
    suppliersPage,
  }) => {
    await registerAndLand(suppliersPage);

    const agreement = stepCard(suppliersPage, "Supplier agreement signed");
    await expect(agreement.getByText(/^to do$/i)).toBeVisible();

    await agreement.getByRole("checkbox").check();
    await agreement.getByRole("button", { name: /sign the agreement/i }).click();

    await expect(
      agreement.getByText(/you['’]ve acknowledged the supplier agreement/i),
    ).toBeVisible();
    // Registration form (1) + agreement (2) = 2/7 done.
    await expect(suppliersPage.getByText(/2 of 7 steps complete/i)).toBeVisible();

    // And it is reversible (org_may_revoke → the supplier can undo their own ack).
    await agreement.getByRole("button", { name: /^undo$/i }).click();
    await expect(suppliersPage.getByText(/1 of 7 steps complete/i)).toBeVisible();
  });

  test("a supplier submits inventory and crew for review, then withdraws crew", async ({
    suppliersPage,
  }) => {
    await registerAndLand(suppliersPage);

    const inventory = stepCard(suppliersPage, "Delivery inventory submitted");
    await inventory
      .getByRole("button", { name: /submit inventory for review/i })
      .click();
    await expect(
      inventory.getByText(/awaiting afrikaburn review of your inventory/i),
    ).toBeVisible();

    const crew = stepCard(suppliersPage, "Crew details submitted");
    await crew
      .getByRole("button", { name: /submit crew details for review/i })
      .click();
    await expect(
      crew.getByText(/awaiting afrikaburn review of your crew list/i),
    ).toBeVisible();

    // Two steps now awaiting org confirmation — surfaced on the progress card.
    await expect(
      suppliersPage.getByText(/2 steps awaiting afrikaburn confirmation/i),
    ).toBeVisible();

    // Submitting is NOT completing: neither review step counts toward "done".
    await expect(suppliersPage.getByText(/1 of 7 steps complete/i)).toBeVisible();

    // Withdrawing returns the step to a submittable state.
    await crew.getByRole("button", { name: /withdraw submission/i }).click();
    await expect(
      crew.getByRole("button", { name: /submit crew details for review/i }),
    ).toBeVisible();
  });

  test("org-confirmed steps show 'awaiting AfrikaBurn' and expose no supplier control", async ({
    suppliersPage,
  }) => {
    await registerAndLand(suppliersPage);

    for (const title of [
      "Deposit received",
      "Supplier briefing attended",
      "Registration fee received",
    ]) {
      const card = stepCard(suppliersPage, title);
      await expect(card.getByText(/awaiting afrikaburn/i).first()).toBeVisible();
      // The boundary: a supplier can NEVER drive these — the card has no button
      // to try. (The server also throws on a forged transition — see report.)
      await expect(card.getByRole("button")).toHaveCount(0);
    }

    // The payment steps must never imply money moves through the portal.
    await expect(
      stepCard(suppliersPage, "Deposit received").getByText(
        /nothing is ever paid through this portal/i,
      ),
    ).toBeVisible();
  });
});
