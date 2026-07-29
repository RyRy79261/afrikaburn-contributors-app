// Persona: ORG STAFF — the one thing they CANNOT do: change anyone's access.
//
// Access management belongs to the System manager alone. In
// `apps/org/lib/actions/accounts.ts`, `setOrgStaffRole` requires the
// System manager RANK — which no role may hold or be granted, so
// it resolves for the System manager and nobody else (@quagga/core
// `org-permissions`). Role assignment (`setAccountOrgRoles`) and the whole
// departments/roles surface require the `god` anchor directly. The Accounts
// PAGE renders for org_staff but strictly read-only
// (`isSystemManager(actor) === false` → no action controls).
//
// HONEST SCOPE NOTE (per the task's "say so explicitly" rule): a test that goes
// red specifically when that capability check is deleted CANNOT be written
// through the real UI, because the access controls have no client entry point
// for a non-manager — they are server-omitted, and the server action carries no
// other reachable trigger. That guard-deletion proof therefore lives in the unit
// gate: `apps/org/lib/__tests__/org-rank-enforcement.test.ts` asserts each
// action names its capability, and
// `packages/core/src/__tests__/org-permissions.test.ts` asserts org_staff is
// refused the rank. What IS faithfully assertable end-to-end is the
// observable contract below: org_staff reaches the Accounts page, sees the
// read-only copy, and is offered NO elevation affordance anywhere.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { provisionOrgStaff } from "./_helpers";

test.describe("org staff · account management is god-only", () => {
  test("org_staff sees Accounts read-only with no elevation controls", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const staff = await provisionOrgStaff(makeAppPage);

    await staff.org.goto("/accounts");

    // The page is reachable (org_staff may VIEW accounts)…
    await expect(
      staff.org.getByRole("heading", { name: /accounts/i }),
    ).toBeVisible();
    // …but its copy states only the system owner can change access…
    await expect(
      staff.org.getByText(/only the system owner can change access/i),
    ).toBeVisible();
    // …and the god-only affordances are absent (search a broad query to surface
    // real rows, then assert no elevate/demote control exists on any of them).
    await staff.org.goto("/accounts?q=@");
    await expect(
      staff.org.getByRole("button", { name: /give org staff access/i }),
    ).toHaveCount(0);
    await expect(
      staff.org.getByRole("button", { name: /remove staff access/i }),
    ).toHaveCount(0);
  });
});
