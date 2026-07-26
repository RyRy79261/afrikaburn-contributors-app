// specs/supplier/isolation.spec.ts — the supplier isolation law (M3-30,
// registry.ts: see-org-supplier-notes / reach-org-console). Every assertion
// proves a SERVER boundary holds, not that a link is hidden:
//   1. org-internal NOTES never reach the portal (the query never selects them);
//   2. a supplier account is REFUSED the org console (an authenticated non-org
//      principal hits the wall — the case a hidden-nav approach would miss);
//   3. a supplier can never see ANOTHER supplier's data (session scoping).
//
// Per the mandatory adversarial pass (M3-30): deleting the matching server guard
// must turn one of these red — e.g. adding `notes` to the supplier session query
// would surface the note body and fail test 1.

import { test, expect, skipUnlessGod } from "../../fixtures";
import {
  registerSupplier,
  signInAs,
  elevateToGod,
} from "../../personas/factories";
import { orgAddNote } from "./support";

test.describe("supplier isolation law", () => {
  test("org-internal notes never appear on any supplier surface [see-org-supplier-notes]", async ({
    suppliersPage,
    orgPage,
  }) => {
    skipUnlessGod();

    const account = await registerSupplier(suppliersPage, {
      category: "Transport",
    });

    // The org records a note with a distinctive, searchable body.
    const secret = `INTERNAL-NOTE-${Date.now().toString(36)}-do-not-leak`;
    await elevateToGod(orgPage);
    await orgAddNote(orgPage, account.name, secret);

    // That body must be absent from every place the supplier can look. Adding a
    // note does not notify the supplier, so notifications must be clean too.
    for (const path of ["/onboarding", "/standing", "/notifications"]) {
      await suppliersPage.goto(path);
      // Wait for the page's own <h1> so absence is asserted against a RENDERED
      // portal surface, not an empty document.
      await expect(
        suppliersPage.getByRole("heading", { level: 1 }),
      ).toBeVisible();
      await expect(suppliersPage.getByText(secret)).toHaveCount(0);
    }

    // Positive control: the org side genuinely holds the note, so absence above
    // is real isolation, not a note that was never written.
    await orgPage.goto("/suppliers");
    await orgPage
      .locator("tr, li")
      .filter({ hasText: account.name })
      .filter({ visible: true })
      .first()
      .getByRole("button", { name: /notes/i })
      .click();
    await expect(orgPage.getByRole("dialog").getByText(secret)).toBeVisible();
  });

  test("a supplier account is refused the org console [reach-org-console]", async ({
    suppliersPage,
    orgPage,
  }) => {
    const account = await registerSupplier(suppliersPage, {
      category: "Transport",
    });

    // The SAME account signs in on the org app (shared auth stack) — and is
    // walled: an authenticated principal with no org role gets the staff wall,
    // and the console's data/headings are absent, not merely nav-hidden.
    await signInAs(orgPage, account, "org");
    await orgPage.goto("/registrations");
    await expect(
      orgPage.getByText(/this side is for afrikaburn staff/i),
    ).toBeVisible();
    await expect(
      orgPage.getByRole("heading", { name: /registration queue/i }),
    ).toHaveCount(0);
  });

  test("a supplier never sees another supplier's data", async ({
    suppliersPage,
    makeAppPage,
  }) => {
    // Supplier A (this page) and supplier B (its own isolated context/session).
    const a = await registerSupplier(suppliersPage, { category: "Transport" });
    await expect(
      suppliersPage.getByRole("heading", { name: /your onboarding checklist/i }),
    ).toBeVisible();

    const bPage = await makeAppPage("suppliers");
    const b = await registerSupplier(bPage, { category: "Water Delivery" });
    await expect(
      bPage.getByRole("heading", { name: /your onboarding checklist/i }),
    ).toBeVisible();

    // A's portal shows A's own business (the registration-step detail) and never
    // B's, on onboarding and standing alike.
    await suppliersPage.goto("/onboarding");
    await expect(suppliersPage.getByText(a.name).first()).toBeVisible();
    await expect(suppliersPage.getByText(b.name)).toHaveCount(0);

    await suppliersPage.goto("/standing");
    await expect(suppliersPage.getByText(b.name)).toHaveCount(0);
  });
});
