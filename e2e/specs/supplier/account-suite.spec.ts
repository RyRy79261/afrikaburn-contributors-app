// specs/supplier/account-suite.spec.ts
//
// Persona: SUPPLIER — looking after their OWN account, in the portal.
//
// Roadmap M4-21. A supplier account holds a business's onboarding, its uploaded
// documents and AfrikaBurn's correspondence about it, and until now had no way
// to put a second factor on any of it from the app where that work happens.
//
// ## The gate reversal is the thing worth testing
//
// The portal gate asks a question about a BUSINESS — has this verified email
// claimed a listing? `unlinked` is an ordinary state: somebody signs up, no
// listing matches their address, and they land on the register screen. It must
// not also mean "you may not change your password". The account exists before
// the listing does and outlives it, so the account suite deliberately sits
// outside the portal gate — and the first test is the one that would catch
// somebody moving it back inside.
//
// Neither test needs god credentials, so both run everywhere.

import { test, expect } from "../../fixtures";
import { registerSupplier, signInAs, signUpBurner } from "../../personas/factories";

test.describe("supplier · the account suite", () => {
  test("an account with no listing can still manage its own security", async ({
    makeAppPage,
  }) => {
    // A burner account that has never claimed a supplier listing. The portal's
    // own screens are closed to them, and that is correct.
    const web = await makeAppPage("web");
    const account = await signUpBurner(web);

    const portal = await makeAppPage("suppliers");
    await signInAs(portal, account, "suppliers");
    await portal.goto("/onboarding");
    // The gate, not the checklist.
    await expect(
      portal.getByRole("heading", { name: /onboarding checklist/i }),
    ).toHaveCount(0);

    // …and the account suite is open to them anyway.
    await portal.goto("/account");
    await expect(
      portal.getByRole("heading", { name: "Account" }),
    ).toBeVisible();
    await expect(portal.getByText(/no listing claimed yet/i)).toBeVisible();

    // Security is reachable, with the real controls on it. This is the whole
    // reason the suite exists in this app: 2FA on the account that will hold a
    // business's documents, available before the listing is even claimed.
    await portal.goto("/account/security");
    await expect(
      portal.getByRole("heading", { name: /two-factor authentication/i }),
    ).toBeVisible();
    await expect(
      portal.getByRole("heading", { name: /active sessions/i }),
    ).toBeVisible();
    await expect(portal.getByText(/this device/i)).toBeVisible();

    // Deletion hands over rather than acting, and says so honestly for an
    // account holding nothing.
    await portal.goto("/account/delete");
    await expect(
      portal.getByText(/holds no supplier listing/i),
    ).toBeVisible();
    await expect(
      portal.getByRole("button", { name: /delete my account/i }),
    ).toHaveCount(0);
  });

  test("a registered supplier sees their listing named, and what deletion releases", async ({
    makeAppPage,
  }) => {
    test.slow();
    const portal = await makeAppPage("suppliers");
    const account = await registerSupplier(portal);

    // Reachable from the portal chrome.
    await portal.goto("/onboarding");
    await portal.getByRole("link", { name: /your account/i }).click();
    await expect(
      portal.getByRole("heading", { name: "Account" }),
    ).toBeVisible();

    // THE DISTINCTION THIS PAGE HAS TO HOLD: the sign-in email is the PERSON's,
    // the listing is the BUSINESS's, and they are different records even when
    // they carry the same address.
    // Exact, because the change-email capability notice on the same page also
    // contains the phrase "sign-in email" — matching loosely here would be
    // matching the explanation instead of the field.
    await expect(
      portal.getByText("Sign-in email", { exact: true }),
    ).toBeVisible();
    await expect(portal.getByText(account.email).first()).toBeVisible();
    await expect(
      portal.getByText("Business listing", { exact: true }),
    ).toBeVisible();

    // The delete tab states what deletion does to the LISTING — the question a
    // supplier will actually have, and the one the participant app's generic
    // copy cannot answer. Notably: the listing is NOT deleted; the claim is.
    await portal.goto("/account/delete");
    await expect(portal.getByText(/is not deleted/i)).toBeVisible();
    await expect(portal.getByText(/goes back to unclaimed/i)).toBeVisible();
    // And the honest, uncomfortable part: the address stays on the business
    // record, so deleting the account does not stop the listing being re-claimed
    // with it. Silence here would have been a promise the product cannot keep.
    await expect(
      portal.getByText(/stays on the business record/i),
    ).toBeVisible();
  });
});
