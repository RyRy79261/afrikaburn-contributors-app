// specs/new-burner/sign-up.spec.ts — the front door for a fresh burner.
//
// Covers the sign-up happy path plus the two boundaries the accounts-security
// spec pins: the 15-character password floor is REFUSED, and a duplicate email
// is handled ENUMERATION-SAFELY (the response is byte-for-byte identical to a
// brand-new address, so sign-up cannot be used to probe who has an account).
//
// Runs on both the desktop and 360px-mobile projects (playwright.config.ts) —
// the primary sign-up journey therefore has mobile coverage for free.

import { test, expect } from "../../fixtures";
import { signUpBurner } from "../../personas/factories";
import { TEST_PASSWORD, TOO_SHORT_PASSWORD, uniqueEmail } from "../../lib/identity";

test.describe("new burner · sign-up", () => {
  test("signs up with email + password and lands in the Burner Bio", async ({
    webPage,
  }) => {
    // signUpBurner asserts a real session is held (onboarding does not bounce to
    // sign-in). It transparently handles verification-off (synthetic email) and
    // verification-on (disposable inbox + link) deployments.
    const account = await signUpBurner(webPage);
    expect(account.email).toContain("@");

    // A brand-new account is signed in AND gated straight to the bio — proof the
    // session exists and the onboarding required-action is live from first boot.
    await webPage.goto("/onboarding");
    await expect(
      webPage.getByRole("heading", { name: /set up your burner bio/i }),
    ).toBeVisible();
  });

  test("refuses a password below the 15-character policy", async ({
    webPage,
  }) => {
    const email = uniqueEmail("shortpw");
    await webPage.goto("/auth/sign-up");
    await webPage.getByLabel("Email", { exact: true }).fill(email);
    await webPage.getByLabel("Password", { exact: true }).fill(TOO_SHORT_PASSWORD);
    await webPage.getByRole("button", { name: "Create account" }).click();

    // The policy floor is surfaced, and no account is minted: we stay on sign-up
    // and a protected route still bounces us to sign-in (no session was created).
    await expect(webPage.getByRole("alert")).toContainText(/15 characters/i);
    await expect(webPage).toHaveURL(/\/auth\/sign-up/);
    await webPage.goto("/profile");
    await expect(webPage).toHaveURL(/\/auth\/sign-in/);
  });

  test("handles a duplicate email enumeration-safely (identical to a new one)", async ({
    webPage,
    makeAppPage,
  }) => {
    // Create a real account, then attempt to sign up its address AGAIN in a fresh
    // context, and sign up a never-seen address in a THIRD context. The two
    // responses must be identical — that identity is the enumeration defence.
    //
    // Why this holds on the DEFAULT mail-off deployment (verified against source
    // 2026-07-26, auth-form.tsx): a fresh sign-up returns no error and the form
    // sets the SAME generic notice ("Check your inbox…") then calls
    // router.refresh() — NOT router.push, and there is no web middleware and the
    // /auth/[...path] page does not redirect an authenticated user — so the
    // role=status notice stays on-screen for the fresh path exactly as it does for
    // the duplicate path. autoSignIn creating a session in the fresh case does not
    // navigate this page away. So the byte-for-byte comparison below is a real
    // apples-to-apples enumeration check even with verification OFF.
    const existing = await signUpBurner(webPage);

    const dupPage = await makeAppPage("web");
    await dupPage.goto("/auth/sign-up");
    await dupPage.getByLabel("Email", { exact: true }).fill(existing.email);
    await dupPage.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await dupPage.getByRole("button", { name: "Create account" }).click();
    const dupNotice = dupPage.getByRole("status");
    await expect(dupNotice).toBeVisible();
    // Crucially: the "already registered" case must NOT raise a distinct error
    // that reveals existence. The generic inbox notice is a status, not an alert.
    await expect(dupPage.getByRole("alert")).toHaveCount(0);
    const dupText = (await dupNotice.textContent())?.trim();

    const freshPage = await makeAppPage("web");
    await freshPage.goto("/auth/sign-up");
    await freshPage
      .getByLabel("Email", { exact: true })
      .fill(uniqueEmail("fresh"));
    await freshPage.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await freshPage.getByRole("button", { name: "Create account" }).click();
    const freshNotice = freshPage.getByRole("status");
    await expect(freshNotice).toBeVisible();
    const freshText = (await freshNotice.textContent())?.trim();

    // Byte-for-byte identical → a probe cannot distinguish known from unknown.
    expect(dupText).toBe(freshText);
    expect(dupText).toMatch(/check your inbox/i);
  });

  test("offers Google sign-in as a button (OAuth round trip is out of scope)", async ({
    webPage,
  }) => {
    // We assert the button's PRESENCE/wiring only. A real Google OAuth round trip
    // cannot be driven headlessly (bot detection / consent / 2FA) and mocking the
    // callback would be a product-code side-door we refuse — see e2e/README.md.
    await webPage.goto("/auth/sign-up");
    await expect(
      webPage.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
  });
});
