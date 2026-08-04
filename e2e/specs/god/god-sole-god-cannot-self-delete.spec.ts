// god-sole-god-cannot-self-delete.spec.ts — the sole-god deletion backstop.
//
// A god administrator is the only account that can grant god (via the accounts
// panel's org_staff elevation is NOT god — god comes solely from GOD_EMAILS).
// So the LAST god must never be able to delete themselves: nobody would be left
// who could restore the role. The guard lives in packages/core
// `assessDeletionEligibility` (sole_org_god block) and is enforced server-side
// in apps/web `requestAccountDeletion`, which re-runs the assessment AFTER
// re-auth — the disabled button is a courtesy, not the boundary.
//
// Account deletion lives on the WEB app (/account/delete), so the god signs in
// there. The god membership must already exist for the guard to see it, so we
// bootstrap god on the console first (elevateToGod), then drive deletion on web.
// Runs only with a pre-provisioned god (skipUnlessGod).

import { test, expect, skipUnlessGod } from "../../fixtures";
import { godCredentials } from "../../lib/env";
import { elevateToGod, signInAs } from "../../personas/factories";
import { appAlerts } from "../../lib/dom";

test.describe("sole god cannot self-delete", () => {
  test.beforeEach(() => {
    skipUnlessGod();
  });

  test("the last god is blocked from deleting their own account — server-enforced", async ({
    orgPage,
    makeAppPage,
  }) => {
    // Bootstrap god on the console so the god membership exists in the DB (the
    // deletion guard counts org gods, and the sole one is blocked).
    await elevateToGod(orgPage);
    const creds = godCredentials()!;

    // Same identity, now on the web account surface.
    const webGod = await makeAppPage("web");
    await signInAs(webGod, creds, "web");
    await webGod.goto("/account/delete");

    // The server-computed eligibility renders the block card — this is the
    // server refusing, surfaced honestly, not a hidden button.
    await expect(
      webGod.getByRole("heading", { name: /sort this out first/i }),
    ).toBeVisible();
    await expect(webGod.getByText(/only god administrator/i)).toBeVisible();

    // And the request control is disabled, reflecting the block client-side.
    const submit = webGod.getByRole("button", { name: /request deletion/i });
    await expect(submit).toBeDisabled();

    // THE server proof: defeat the disabled attribute and actually submit with
    // the correct password. Re-auth SUCCEEDS, so the refusal that follows can
    // only be the server re-running assessDeletionEligibility and throwing the
    // sole-god block — not the button, not a bad password.
    // The INPUT is disabled by the same `blocked` prop as the button, so the
    // fill below used to hang until the test timed out — meaning this spec, the
    // anti-lockout anchor, never reached its own assertion and could not have
    // failed if the server guard had been removed. Defeat both attributes, not
    // just the button's.
    const password = webGod.getByLabel(/confirm your password/i);
    await password.evaluate((el) => {
      (el as unknown as { disabled: boolean }).disabled = false;
    });
    await password.fill(creds.password);
    await submit.evaluate((el) => {
      (el as unknown as { disabled: boolean }).disabled = false;
    });
    await submit.click();
    await expect(appAlerts(webGod)).toContainText(
      /god administrator|grant god/i,
    );

    // The account is NOT scheduled for deletion: no grace-period banner appears
    // (the guard aborted before any deletion request was written).
    await webGod.goto("/account/delete");
    await expect(webGod.getByText(/scheduled for deletion/i)).toHaveCount(0);
  });
});
