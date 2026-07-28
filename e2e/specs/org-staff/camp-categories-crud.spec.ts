// Persona: ORG STAFF — the camp-category taxonomy is READ-ONLY to them.
//
// This spec used to drive the whole create → edit → reorder → delete lifecycle
// as org_staff. It no longer can: Ryan moved camp-category CRUD to the System
// manager alone (27 Jul 2026 — "The categories for example, These should only
// have CRUD operations by a system manager"), so the lifecycle moved with it to
// `specs/god/camp-categories-crud.spec.ts` and what org_staff proves here is the
// REFUSAL side of the same rule.
//
// Both halves matter. A permission that only ever gets tested from the side that
// holds it is a permission nobody has checked.
//
// Two tiers of proof, stated honestly (registry §"TWO TIERS OF PROOF"): the
// missing controls are observable end-to-end and asserted below; the server
// refusal itself (`requireOrgSession({ capability: "manage_camp_categories" })`)
// has no client entry point for org_staff, so its guard-deletion proof lives in
// `apps/org/lib/__tests__/org-rank-enforcement.test.ts` and
// `packages/core/src/__tests__/org-permissions.test.ts`, both in the unit gate.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

test.describe("org staff · camp categories are read-only", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("org_staff reads the catalog but is offered no way to change it", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const staff = await provisionOrgStaff(makeAppPage);
    await staff.org.goto("/categories");

    // The page is reachable and the catalog renders — "read everywhere" holds.
    await expect(
      staff.org.getByRole("heading", { name: /camp categories/i }),
    ).toBeVisible();

    // …and the screen SAYS why it is read-only rather than just lacking buttons.
    await expect(
      staff.org.getByText(/change existing records in this department/i),
    ).toBeVisible();

    // No create affordance, and no per-row edit/delete controls anywhere.
    await expect(
      staff.org.getByRole("button", { name: /^add category$/i }),
    ).toHaveCount(0);
    await expect(
      staff.org.getByRole("button", { name: /^edit / }),
    ).toHaveCount(0);
    await expect(
      staff.org.getByRole("button", { name: /^delete / }),
    ).toHaveCount(0);
  });
});
