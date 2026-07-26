// specs/supplier/self-registration.spec.ts — the supplier's front door.
//
// Journey (M3-28, docs/supplier-spec.md §Surfaces): a business self-registers in
// the portal — ONE password field (NIST: no confirm-password), a service
// category, and the supplier-basics acknowledgement — and lands on its own
// onboarding checklist with the registration step already done. Then it can sign
// out and back in and resume exactly where it left off.
//
// Runs on both the desktop and 360px-mobile projects, so the primary supplier
// journey is covered at the design's mobile baseline for free.

import { test, expect } from "../../fixtures";
import { registerSupplier, signInAs, signOut } from "../../personas/factories";
import { TEST_PASSWORD, uniqueSupplierName } from "../../lib/identity";

test.describe("supplier self-registration", () => {
  test("a fresh business registers and lands on onboarding with step 1 done", async ({
    suppliersPage,
  }) => {
    const business = uniqueSupplierName();
    await registerSupplier(suppliersPage, {
      businessName: business,
      category: "Transport",
    });

    // The push after a successful register lands on the checklist. Waiting on the
    // heading proves the supplier row + onboarding seed actually persisted — not
    // merely that the form submitted.
    await expect(
      suppliersPage.getByRole("heading", { name: /your onboarding checklist/i }),
    ).toBeVisible();

    // Registration form is step 1 and is auto-completed by registering: 1/7.
    await expect(suppliersPage.getByText(/1\/7 done/i)).toBeVisible();
    const regCard = suppliersPage
      .getByRole("listitem")
      .filter({ hasText: "Registration form" });
    await expect(regCard.getByText(/^done$/i)).toBeVisible();

    // The seven Supplier-Depot steps are all present.
    for (const title of [
      "Registration form",
      "Supplier agreement signed",
      "Deposit received",
      "Delivery inventory submitted",
      "Crew details submitted",
      "Supplier briefing attended",
      "Registration fee received",
    ]) {
      await expect(
        suppliersPage.getByRole("listitem").filter({ hasText: title }),
      ).toBeVisible();
    }
  });

  test("the sign-up form takes ONE password (no confirm) and requires the basics acknowledgement", async ({
    suppliersPage,
  }) => {
    await suppliersPage.goto("/signup");

    // Exactly one password field, and never a "confirm password" (NIST SP
    // 800-63B-4 forbids the confirm-twice pattern — docs/accounts-security-spec.md).
    await expect(
      suppliersPage.getByLabel("Password", { exact: true }),
    ).toBeVisible();
    await expect(
      suppliersPage.getByLabel(/confirm password/i),
    ).toHaveCount(0);

    // The create-account button stays disabled until every required field AND the
    // acknowledgement are satisfied — the acknowledgement is a real gate, not
    // decoration.
    const submit = suppliersPage.getByRole("button", {
      name: /create account/i,
    });
    await expect(submit).toBeDisabled();

    await suppliersPage.getByLabel(/business name/i).fill(uniqueSupplierName());
    await suppliersPage.getByLabel(/contact person/i).fill("Sam Supplier");
    await suppliersPage
      .getByLabel("Email", { exact: true })
      .fill(`supplier-form-${Date.now()}@e2e.quagga.test`);
    await suppliersPage.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await suppliersPage.getByLabel(/service category/i).click();
    await suppliersPage.getByRole("option", { name: "Transport" }).click();

    // Everything filled EXCEPT the acknowledgement → still refused.
    await expect(submit).toBeDisabled();

    await suppliersPage
      .getByRole("checkbox", { name: /read the supplier basics/i })
      .check();
    await expect(submit).toBeEnabled();
  });

  test("a supplier signs out and back in and resumes onboarding", async ({
    suppliersPage,
  }) => {
    const account = await registerSupplier(suppliersPage, {
      category: "Transport",
    });
    await expect(
      suppliersPage.getByRole("heading", { name: /your onboarding checklist/i }),
    ).toBeVisible();

    await signOut(suppliersPage);
    // Signing back in via the portal's own /signin returns to the checklist
    // (callbackURL) with the persisted 1/7 progress intact.
    await signInAs(suppliersPage, account, "suppliers");
    await expect(
      suppliersPage.getByRole("heading", { name: /your onboarding checklist/i }),
    ).toBeVisible();
    await expect(suppliersPage.getByText(/1\/7 done/i)).toBeVisible();
  });
});
