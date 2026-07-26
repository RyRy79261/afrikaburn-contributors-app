// Persona: ORG STAFF — camp-category taxonomy CRUD.
//
// Every mutation is org-gated at the page AND re-checked in the server action
// (createCategory / updateCategory / deleteCategory), and every write is
// audited. This drives the whole create → edit → reorder → delete lifecycle
// through the real manager UI on a category the test owns (so seeded categories
// are never touched). Desktop project only — the manager is a wide data table.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { uniqueName } from "../../lib/identity";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

test.describe("org staff · camp categories", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("creates, renames, reorders and deletes a category", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const staff = await provisionOrgStaff(makeAppPage);
    await staff.org.goto("/categories");

    const label = uniqueName("Late Night");

    // --- Create ----------------------------------------------------------
    await staff.org.getByRole("button", { name: /add category/i }).click();
    await staff.org.getByLabel("Name", { exact: true }).fill(label);
    await staff.org
      .getByLabel("Emoji", { exact: true })
      .fill("🌙");
    // With the form open, the sole "Add category" button is the submit.
    await staff.org.getByRole("button", { name: /^add category$/i }).click();
    await expect(staff.org.getByText(/category added/i)).toBeVisible();
    await expect(staff.org.getByText(label)).toBeVisible();
    // A brand-new category is used by zero camps.
    await expect(staff.org.getByText(/0 camps/).first()).toBeVisible();

    // --- Rename (edit) ---------------------------------------------------
    const renamed = `${label} Owls`;
    await staff.org
      .getByRole("button", { name: `Edit ${label}`, exact: true })
      .click();
    const editDialog = staff.org.getByRole("dialog");
    await editDialog.getByLabel("Name", { exact: true }).fill(renamed);
    await editDialog.getByRole("button", { name: /save changes/i }).click();
    await expect(staff.org.getByText(/category updated/i)).toBeVisible();
    await expect(staff.org.getByText(renamed)).toBeVisible();

    // --- Reorder (smoke) -------------------------------------------------
    // A newly-added category sorts last, so "move up" is enabled. Reorder writes
    // two updateCategory calls server-side; we assert it succeeds (no error
    // toast) and the row survives — order equality is covered by core unit tests.
    const moveUp = staff.org.getByRole("button", {
      name: `Move ${renamed} up`,
      exact: true,
    });
    if (await moveUp.isEnabled()) {
      await moveUp.click();
      await expect(staff.org.getByText(/could not reorder/i)).toHaveCount(0);
      await expect(staff.org.getByText(renamed)).toBeVisible();
    }

    // --- Delete ----------------------------------------------------------
    await staff.org
      .getByRole("button", { name: `Delete ${renamed}`, exact: true })
      .click();
    const deleteDialog = staff.org.getByRole("dialog");
    await expect(deleteDialog.getByText(/nothing uses this category/i)).toBeVisible();
    await deleteDialog.getByRole("button", { name: /remove category/i }).click();
    await expect(staff.org.getByText(/removed/i)).toBeVisible();
    await expect(staff.org.getByText(renamed)).toHaveCount(0);
  });
});
