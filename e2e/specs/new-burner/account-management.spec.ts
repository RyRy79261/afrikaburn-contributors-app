// specs/new-burner/account-management.spec.ts — M3-29 account management.
//
// The accounts-security backend (commit be64c93) is real on today's auth, so
// these journeys are testable now:
//   - a password change invalidates OTHER sessions (and the new password is what
//     actually authenticates afterwards);
//   - a single session can be revoked, and the server-side session list reflects
//     it;
//   - delete-with-grace enters the 14-day grace, is restorable within it, and the
//     surface honestly reports the scheduled state.
//
// A COOKIE-CACHE CAVEAT drives the assertion choices. Auth config
// (packages/auth/src/config.ts) enables a 5-minute signed session cookieCache, so
// a REVOKED session in ANOTHER browser context can keep reading cached session
// data for up to 5 minutes — asserting "the other tab bounces to sign-in
// instantly" would be flaky. So revocation is proven the reliable, cache-
// independent way: (a) the server-rendered active-session list shrinks, and
// (b) after a password change the OLD password no longer authenticates while the
// NEW one does. Both are true the instant the server writes, regardless of any
// other context's cached cookie.
//
// Runs on desktop + 360px mobile (the account surfaces are responsive).

import { test, expect } from "../../fixtures";
import { signUpBurner, signInAs } from "../../personas/factories";
import { TEST_PASSWORD } from "../../lib/identity";
import { appAlerts } from "../../lib/dom";

const NEW_PASSWORD = "brand-new-passphrase-for-e2e-rotation";

test.describe("new burner · account management", () => {
  test("changing the password revokes other sessions and rotates the credential", async ({
    webPage,
    makeAppPage,
  }) => {
    test.slow();
    const account = await signUpBurner(webPage, { onboard: true });

    // A SECOND signed-in session for the same account (a second device).
    const secondDevice = await makeAppPage("web");
    await signInAs(secondDevice, account);

    // Two sessions are live before we change anything (server-rendered list).
    await webPage.goto("/account/security");
    await expect(
      webPage.getByRole("heading", { name: /active sessions/i }),
    ).toBeVisible();
    // "This device" for the current one, plus a "Revoke" for the other → 2.
    await expect(webPage.getByText(/this device/i)).toBeVisible();
    await expect(
      webPage.getByRole("button", { name: /^revoke$/i }),
    ).toHaveCount(1);

    // Change the password with "sign out my other devices" left ON (default).
    await webPage.goto("/account");
    await webPage.getByRole("button", { name: "Change", exact: true }).click();
    await webPage.getByLabel("Current password", { exact: true }).fill(TEST_PASSWORD);
    await webPage.getByLabel(/new password/i).fill(NEW_PASSWORD);
    // The switch defaults to revoking others; assert that so a default flip can't
    // silently weaken this test.
    await expect(
      webPage.getByRole("switch", { name: /sign out my other devices/i }),
    ).toBeChecked();
    await webPage
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(webPage.getByText(/password changed/i)).toBeVisible();

    // Server-side proof #1: the other session is gone — only THIS device remains.
    await webPage.goto("/account/security");
    await expect(
      webPage.getByRole("button", { name: /^revoke$/i }),
    ).toHaveCount(0);

    // Server-side proof #2: the credential actually rotated. In a THIRD cold
    // context the OLD password is refused and the NEW one signs in.
    const fresh = await makeAppPage("web");
    await fresh.goto("/auth/sign-in");
    await fresh.getByLabel("Email", { exact: true }).fill(account.email);
    await fresh.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await fresh.getByRole("button", { name: /^sign in$/i }).click();
    await expect(appAlerts(fresh)).toBeVisible();
    await expect(fresh).toHaveURL(/\/auth\/sign-in/);
    // The new password works.
    await signInAs(fresh, { email: account.email, password: NEW_PASSWORD });
    await fresh.goto("/profile");
    await expect(
      fresh.getByRole("heading", { name: /your profile/i }),
    ).toBeVisible();
  });

  test("revoking a single session removes it from the active-session list", async ({
    webPage,
    makeAppPage,
  }) => {
    const account = await signUpBurner(webPage, { onboard: true });
    const secondDevice = await makeAppPage("web");
    await signInAs(secondDevice, account);

    await webPage.goto("/account/security");
    // Two sessions: the current device (badged) and one revocable other.
    const revoke = webPage.getByRole("button", { name: /^revoke$/i });
    await expect(revoke).toHaveCount(1);

    // Revoke the other device.
    await revoke.first().click();

    // Server-side proof: the list now has no revocable other session (the row was
    // removed after the server deleted the session, not merely hidden).
    await expect(
      webPage.getByRole("button", { name: /^revoke$/i }),
    ).toHaveCount(0);
    // The current device is still here — revoking others never signs YOU out.
    await expect(webPage.getByText(/this device/i)).toBeVisible();
  });

  test("delete-with-grace enters the grace period and is restorable within it", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });

    // A fresh burner leads no camps, so nothing blocks deletion.
    await webPage.goto("/account/delete");
    await expect(
      webPage.getByRole("heading", { name: /delete account/i }),
    ).toBeVisible();

    // Re-auth with the password, then request deletion.
    await webPage
      .getByLabel(/confirm your password/i)
      .fill(TEST_PASSWORD);
    await webPage
      .getByRole("button", { name: /request deletion/i })
      .click();

    // The account is now SCHEDULED — the honest grace banner appears with days
    // remaining and a restore control. Nothing has been erased yet.
    await expect(
      webPage.getByText(/scheduled for deletion/i),
    ).toBeVisible();
    await expect(webPage.getByText(/left to change your mind/i)).toBeVisible();

    // Restore within grace: "Keep my account" cancels the deletion.
    await webPage.getByRole("button", { name: /keep my account/i }).click();

    // The scheduled state is gone — reloading the surface shows no grace banner.
    await webPage.goto("/account/delete");
    await expect(
      webPage.getByText(/scheduled for deletion/i),
    ).toHaveCount(0);
    // And the account is still usable (session intact, profile renders).
    await webPage.goto("/profile");
    await expect(
      webPage.getByRole("heading", { name: /your profile/i }),
    ).toBeVisible();
  });
});
