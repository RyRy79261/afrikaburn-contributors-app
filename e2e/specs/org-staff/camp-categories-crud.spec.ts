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
// restricted controls are observable end-to-end and asserted below; the server
// refusal itself (`requireSystemManager("change the camp categories")`)
// has no client entry point for org_staff, so its guard-deletion proof lives in
// `apps/org/lib/__tests__/org-rank-enforcement.test.ts` and
// `packages/core/src/__tests__/org-permissions.test.ts`, both in the unit gate.
//
// ## Why this asserts DISABLED and not ABSENT
//
// It asserted absent until 28 Jul 2026, with `getByRole("button", { name:
// /^edit / })` — and the controls it was hunting for are named `Edit Fire Art`
// and `Delete Fire Art`. Playwright's accessible-name match is CASE-SENSITIVE
// unless the pattern says otherwise, so those two locators matched nothing on
// ANY rank, System manager included. Two assertions that could not fail.
//
// The behaviour changed underneath them at the same time. Ryan: "I'd rather
// things be transparent with restrictions than completely obfuscated, except for
// private personal information" — so `categories-manager.tsx` now RENDERS every
// control for a rank that cannot manage the taxonomy, disabled, each naming the
// restriction in its accessible name and pointing at the page's one refusal
// sentence. Asserting disabled-ness is both the stronger claim and the only one
// that describes the screen.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

test.describe("org staff · camp categories are read-only", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("org_staff reads the catalog but is offered no way to change it [manage-camp-categories]", async ({
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
      staff.org.getByText(
        /only a system manager can change the camp categories/i,
      ),
    ).toBeVisible();

    // At least one row to reason about — the seed ships the catalog.
    const rows = staff.org.getByRole("row");
    expect(await rows.count()).toBeGreaterThan(1);

    // The create affordance is PRESENT, disabled, and says so in its name.
    const add = staff.org.getByRole("button", {
      name: /^add category — not available to you$/i,
    });
    await expect(add).toBeVisible();
    await expect(add).toBeDisabled();

    // Every per-row control likewise: present, disabled, and self-explaining.
    for (const verb of ["Edit", "Delete", "Move"]) {
      const controls = staff.org.getByRole("button", {
        name: new RegExp(`^${verb} .+ — not available to you$`, "i"),
      });
      expect(await controls.count()).toBeGreaterThan(0);
      for (const control of await controls.all()) {
        await expect(control).toBeDisabled();
      }
    }

    // And nothing offers the unrestricted name — a working Edit/Delete on this
    // rank would be the actual bug, so name the exact thing that must not exist.
    await expect(
      staff.org.getByRole("button", { name: /^edit [^—]+$/i }),
    ).toHaveCount(0);
    await expect(
      staff.org.getByRole("button", { name: /^delete [^—]+$/i }),
    ).toHaveCount(0);

    // Clicking the disabled create control opens nothing.
    await add.click({ force: true });
    await expect(
      staff.org.getByRole("button", { name: /^add category$/i }),
    ).toHaveCount(0);
  });
});
