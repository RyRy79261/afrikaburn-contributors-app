// Persona: SYSTEM MANAGER (stored as `god`) — camp-category taxonomy CRUD.
//
// The lifecycle spec that used to live under `specs/org-staff/`. Ryan moved
// camp-category CRUD to the System manager alone (27 Jul 2026), so the rank that
// drives it moved too; org_staff now proves the read-only half of the same rule
// in `specs/org-staff/camp-categories-crud.spec.ts`.
//
// Every mutation is gated at the page AND re-checked in the server action
// (createCategory / updateCategory / deleteCategory, all requiring
// `requireSystemManager`), and every write is audited. This drives the whole
// create → edit → reorder → delete lifecycle through the real manager UI on a
// category the test owns, so seeded categories are never touched. Desktop
// project only — the manager is a wide data table.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { uniqueName } from "../../lib/identity";
import { elevateToGod } from "../../personas/factories";

test.describe("system manager · camp categories", () => {
  test.beforeEach(() => {
    test.skip(
      test.info().project.name === "mobile-360",
      "the category manager is a wide desktop data table; the registration-review loop covers the mobile viewport",
    );
  });

  test("creates, renames, reorders and deletes a category", async ({
    orgPage,
  }) => {
    skipUnlessGod();
    await elevateToGod(orgPage);
    await orgPage.goto("/categories");

    const label = uniqueName("Late Night");

    // --- Create ----------------------------------------------------------
    await orgPage.getByRole("button", { name: /add category/i }).click();
    await orgPage.getByLabel("Name", { exact: true }).fill(label);
    await orgPage.getByLabel("Emoji", { exact: true }).fill("🌙");
    // With the form open, the sole "Add category" button is the submit.
    await orgPage.getByRole("button", { name: /^add category$/i }).click();
    await expect(orgPage.getByText(/category added/i)).toBeVisible();
    await expect(orgPage.getByText(label)).toBeVisible();
    // A brand-new category is used by zero camps.
    await expect(orgPage.getByText(/0 camps/).first()).toBeVisible();

    // --- Rename (edit) ---------------------------------------------------
    const renamed = `${label} Owls`;
    await orgPage
      .getByRole("button", { name: `Edit ${label}`, exact: true })
      .click();
    const editDialog = orgPage.getByRole("dialog");
    await editDialog.getByLabel("Name", { exact: true }).fill(renamed);
    await editDialog.getByRole("button", { name: /save changes/i }).click();
    await expect(orgPage.getByText(/category updated/i)).toBeVisible();
    await expect(orgPage.getByText(renamed)).toBeVisible();

    // --- Reorder (smoke) -------------------------------------------------
    // A newly-added category sorts last, so "move up" is enabled. Reorder writes
    // two updateCategory calls server-side; we assert it succeeds (no error
    // toast) and the row survives — order equality is covered by core unit tests.
    const moveUp = orgPage.getByRole("button", {
      name: `Move ${renamed} up`,
      exact: true,
    });
    if (await moveUp.isEnabled()) {
      await moveUp.click();
      await expect(orgPage.getByText(/could not reorder/i)).toHaveCount(0);
      await expect(orgPage.getByText(renamed)).toBeVisible();
    }

    // --- Delete ----------------------------------------------------------
    await orgPage
      .getByRole("button", { name: `Delete ${renamed}`, exact: true })
      .click();
    const deleteDialog = orgPage.getByRole("dialog");
    await expect(
      deleteDialog.getByText(/nothing uses this category/i),
    ).toBeVisible();
    await deleteDialog
      .getByRole("button", { name: /remove category/i })
      .click();
    await expect(orgPage.getByText(/removed/i)).toBeVisible();
    await expect(orgPage.getByText(renamed)).toHaveCount(0);
  });
});
