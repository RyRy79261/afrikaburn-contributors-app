// Persona: ORG STAFF — the one thing they CANNOT do: elevate accounts.
//
// Elevation is god-only. In `apps/org/lib/actions/accounts.ts`, `setOrgStaffRole`
// is guarded by `requireOrgSession({ god: true })`; the Accounts PAGE renders for
// org_staff but strictly read-only (isGod === false → no action controls).
//
// HONEST SCOPE NOTE (per the task's "say so explicitly" rule): a test that goes
// red specifically when `requireOrgSession({ god: true })` is deleted CANNOT be
// written through the real UI for this guard, because the elevate/demote controls
// have no client entry point for a non-god — they are server-omitted, and the
// server action carries no other reachable trigger. That guard-deletion proof
// therefore lives at the action-test layer (roadmap M3-02, which explicitly owns
// "requireOrgSession({god:true}) throws for org_staff"). What IS faithfully
// assertable end-to-end is the observable contract below: org_staff reaches the
// Accounts page, sees the read-only copy, and is offered NO elevation affordance
// anywhere — the account-management surface is closed to them.

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
      staff.org.getByRole("button", { name: /elevate to org staff/i }),
    ).toHaveCount(0);
    await expect(
      staff.org.getByRole("button", { name: /remove staff access/i }),
    ).toHaveCount(0);
  });
});
