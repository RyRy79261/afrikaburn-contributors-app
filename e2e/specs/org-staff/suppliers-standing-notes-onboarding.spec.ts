// Persona: ORG STAFF — the supplier repository: set standing, add an
// org-internal note, and confirm an onboarding step.
//
// Each write is org-gated + audited server-side (lib/actions/suppliers.ts). The
// test creates its own supplier through the console's Add-supplier form so it
// never depends on which seed rows exist, then drives standing / notes /
// onboarding on THAT supplier. Desktop project only — the repository is a wide,
// row-expanding data table.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { uniqueSupplierName } from "../../lib/identity";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

test.describe("org staff · supplier repository", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("adds a supplier, sets its standing, notes it, and confirms an onboarding step", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const staff = await provisionOrgStaff(makeAppPage);
    const org = staff.org;
    await org.goto("/suppliers");

    // --- Add a supplier --------------------------------------------------
    const name = uniqueSupplierName();
    await org.getByRole("button", { name: /add supplier/i }).click();
    const addDialog = org.getByRole("dialog");
    await addDialog.getByLabel("Name").fill(name);
    await addDialog.getByRole("button", { name: /add supplier/i }).click();
    await expect(org.getByText(/supplier added/i)).toBeVisible();
    // `.first()` — the repository renders the name in the table row AND in the
    // region labelled "Supplier repository"; the assertion is "it is on the
    // screen", not "exactly once".
    await expect(org.getByText(name).first()).toBeVisible();

    const row = org.getByRole("row", { name });

    // --- Set standing → suspended ---------------------------------------
    await row.getByRole("combobox").click();
    await org.getByRole("option", { name: "Suspended" }).click();
    await expect(org.getByText(/standing set to suspended/i)).toBeVisible();

    // --- Add an org-internal note ---------------------------------------
    await org
      .getByRole("row", { name })
      .getByRole("button", { name: /notes/i })
      .click();
    const noteMarker = `Late delivery in 2026 ${Date.now().toString(36)}`;
    const notesDialog = org.getByRole("dialog");
    await notesDialog.getByRole("textbox").fill(noteMarker);
    await notesDialog.getByRole("button", { name: /add note/i }).click();
    await expect(org.getByText(/recorded/i)).toBeVisible();
    await expect(notesDialog.getByText(noteMarker)).toBeVisible();
    await org.keyboard.press("Escape"); // close the drawer

    // --- Confirm an onboarding step -------------------------------------
    await org
      .getByRole("row", { name })
      .getByRole("button", { name: /expand row/i })
      .click();
    // Only this supplier is expanded, so its first org-confirmed step's
    // "Confirm" is the only one on the page.
    await org
      .getByRole("button", { name: /^confirm$/i })
      .first()
      .click();
    await expect(org.getByText(/^confirmed\.?$/i)).toBeVisible();
    // The step now reads Completed and the onboarding tally moved off 0/7.
    await expect(org.getByText("Completed").first()).toBeVisible();
    await expect(org.getByText(/1\/7/).first()).toBeVisible();
  });
});
