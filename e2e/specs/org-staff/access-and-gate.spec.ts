// Persona: ORG STAFF — reaching (and being refused at) the console gate.
//
// The gate is a SERVER boundary (apps/org resolveOrgSession), not a hidden nav
// item: an authenticated non-org account is REFUSED with the polite wall, and no
// console chrome or data renders behind it. The positive half proves the same
// server resolver admits an elevated org_staff. Runs on desktop AND the 360px
// mobile project — the gate is chrome-light and must behave identically on both.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { signUpBurner, signInAs } from "../../personas/factories";
import { provisionOrgStaff } from "./_helpers";

test.describe("org staff · console access gate", () => {
  test("an authenticated non-org account is refused at the console gate", async ({
    webPage,
    orgPage,
  }) => {
    // A real, onboarded participant — a legitimate identity, just not org staff.
    const burner = await signUpBurner(webPage, { onboard: true });
    await signInAs(orgPage, burner, "org");

    // Try the protected queue directly — the guard must replace it, not 500.
    await orgPage.goto("/registrations");
    await expect(
      orgPage.getByText(/this side is for afrikaburn staff/i),
    ).toBeVisible();
    // The refusal is total: the queue's own heading and data never render.
    await expect(
      orgPage.getByRole("heading", { name: /registration pipeline/i }),
    ).toHaveCount(0);

    // The same wall stands on every console surface, not just the queue.
    for (const path of ["/", "/suppliers", "/categories", "/accounts"]) {
      await orgPage.goto(path);
      await expect(
        orgPage.getByText(/this side is for afrikaburn staff/i),
      ).toBeVisible();
    }
  });

  test("an elevated org_staff account clears the gate into the console", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const staff = await provisionOrgStaff(makeAppPage);

    // The console overview renders for org_staff (no forbidden wall anywhere).
    await staff.org.goto("/");
    await expect(
      staff.org.getByText(/this side is for afrikaburn staff/i),
    ).toHaveCount(0);
    await expect(
      staff.org.getByText(/restricted to afrikaburn staff/i),
    ).toHaveCount(0);
    // A god-or-org-staff-only surface is reachable and renders its heading.
    await staff.org.goto("/suppliers");
    await expect(
      staff.org.getByRole("heading", { name: /supplier repository/i }),
    ).toBeVisible();
  });
});
