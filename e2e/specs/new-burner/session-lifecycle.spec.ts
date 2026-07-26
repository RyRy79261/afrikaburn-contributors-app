// specs/new-burner/session-lifecycle.spec.ts — sign-in, sign-out, persistence.
//
// The account lifecycle AFTER sign-up: signing back in restores the session,
// the session survives a hard reload, signing out truly ends it, and — the
// boundary — sign-in failure copy is enumeration-safe (an unknown address and a
// wrong password produce the SAME message).

import { test, expect } from "../../fixtures";
import { signUpBurner, signInAs, signOut } from "../../personas/factories";
import { TEST_PASSWORD, uniqueEmail } from "../../lib/identity";
import { appAlerts } from "../../lib/dom";

test.describe("new burner · session lifecycle", () => {
  test("signs back in after signing out", async ({ webPage }) => {
    const account = await signUpBurner(webPage, { onboard: true });
    await signOut(webPage);
    // Session is gone: a protected route bounces to sign-in.
    await webPage.goto("/profile");
    await expect(webPage).toHaveURL(/\/auth\/sign-in/);

    await signInAs(webPage, account);
    // Signed in again and onboarded → the profile renders, not the sign-in gate.
    await webPage.goto("/profile");
    await expect(
      webPage.getByRole("heading", { name: /your profile/i }),
    ).toBeVisible();
  });

  test("keeps the session across a full page reload", async ({ webPage }) => {
    await signUpBurner(webPage, { onboard: true });
    await webPage.goto("/profile");
    await expect(
      webPage.getByRole("heading", { name: /your profile/i }),
    ).toBeVisible();

    await webPage.reload();
    // The reload must not drop us to sign-in — the cookie session persists.
    await expect(webPage).not.toHaveURL(/\/auth\/sign-in/);
    await expect(
      webPage.getByRole("heading", { name: /your profile/i }),
    ).toBeVisible();
  });

  test("sign-out ends the session for protected routes", async ({ webPage }) => {
    await signUpBurner(webPage, { onboard: true });
    await signOut(webPage);
    await webPage.goto("/profile");
    await expect(webPage).toHaveURL(/\/auth\/sign-in/);
    await expect(webPage.getByLabel("Email", { exact: true })).toBeVisible();
  });

  test("sign-in errors are enumeration-safe (unknown email ≡ wrong password)", async ({
    webPage,
    makeAppPage,
  }) => {
    const account = await signUpBurner(webPage);
    await signOut(webPage);

    // Known email, WRONG password.
    await webPage.goto("/auth/sign-in");
    await webPage.getByLabel("Email", { exact: true }).fill(account.email);
    await webPage
      .getByLabel("Password", { exact: true })
      .fill("wrong-but-long-enough-password");
    await webPage.getByRole("button", { name: /^sign in$/i }).click();
    const knownError = appAlerts(webPage);
    await expect(knownError).toBeVisible();
    const knownText = (await knownError.textContent())?.trim();
    // Sign-in FAILED, so we are still on the sign-in route.
    await expect(webPage).toHaveURL(/\/auth\/sign-in/);

    // Never-registered email, in a clean context.
    const other = await makeAppPage("web");
    await other.goto("/auth/sign-in");
    await other.getByLabel("Email", { exact: true }).fill(uniqueEmail("ghost"));
    await other.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await other.getByRole("button", { name: /^sign in$/i }).click();
    const unknownError = appAlerts(other);
    await expect(unknownError).toBeVisible();
    const unknownText = (await unknownError.textContent())?.trim();

    // Identical copy for both cases → sign-in cannot enumerate accounts.
    expect(knownText).toBe(unknownText);
    expect(knownText).toMatch(/don't match/i);
  });
});
