// specs/new-burner/password-reset.spec.ts — M3-18 password reset, END TO END
// INCLUDING RECEIVING THE EMAIL.
//
// This is the flow the roadmap calls out specifically: forgot-password →
// receive the REAL reset email (via lib/mail.ts, exercising app → Resend → DNS →
// inbox) → follow the single-use link → set a new password → the credential is
// rotated and every session is invalidated (auth config sets
// `revokeSessionsOnPasswordReset: true`).
//
// SKIP-AWARE: needs a deployment that actually sends email AND a disposable inbox
// to read it. On the default mail-off deployment there is no link to click, so
// this skips cleanly via skipUnlessMail() — it lights up unchanged the moment
// E2E_MAIL_MODE=mailtm points at a Resend-enabled preview.
//
// COOKIE-CACHE NOTE: the 5-minute signed session cookieCache means a
// pre-existing session's cached cookie can survive a few minutes past server-side
// revocation, so "the old tab bounces instantly" would be flaky. The reliable,
// cache-independent proof used here is credential ROTATION: after reset the NEW
// password authenticates and the OLD one is refused — which can only be true if
// the reset landed server-side.

import { test, expect, skipUnlessMail } from "../../fixtures";
import { signInAs } from "../../personas/factories";
import { requireMailbox } from "../../lib/mail";
import { requiresEmailVerification } from "../../lib/env";
import { TEST_PASSWORD } from "../../lib/identity";
import { appAlerts } from "../../lib/dom";

const NEW_PASSWORD = "reset-flow-fresh-passphrase-e2e";

test.describe("new burner · password reset (real email round trip)", () => {
  test("resets via the emailed link and rotates the credential", async ({
    webPage,
    makeAppPage,
  }) => {
    skipUnlessMail();
    test.slow();

    // A real, readable inbox so we can click the actual reset link.
    const mailbox = await requireMailbox("reset");
    const email = mailbox.address;

    // Sign up through the real form against that inbox.
    await webPage.goto("/auth/sign-up");
    await webPage.getByLabel("Email", { exact: true }).fill(email);
    await webPage.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await webPage.getByRole("button", { name: "Create account" }).click();
    // If verification is on, clear it so the account can hold a session first.
    if (requiresEmailVerification()) {
      const verifyLink = await mailbox.waitForLink(/verify|verification|token/i);
      await webPage.goto(verifyLink);
    }

    // Request a reset link.
    await webPage.goto("/auth/forgot-password");
    await webPage.getByLabel("Email", { exact: true }).fill(email);
    await webPage.getByRole("button", { name: /send reset link/i }).click();

    // Receive the REAL email and follow its single-use link. The forgot form sets
    // redirectTo=/auth/reset-password, so the token arrives on that route.
    const resetLink = await mailbox.waitForLink(/reset-password|token=/i, ({
      subject,
    }) => /reset|password/i.test(subject));
    await webPage.goto(resetLink);
    await expect(
      webPage.getByRole("heading", { name: /choose a new password/i }),
    ).toBeVisible();

    // Set a new password → the form routes to sign-in on success.
    await webPage.getByLabel(/new password/i).fill(NEW_PASSWORD);
    await webPage.getByRole("button", { name: /reset password/i }).click();
    await expect(webPage).toHaveURL(/\/auth\/sign-in/);

    // Credential rotation, the cache-independent proof: OLD password refused …
    await webPage.getByLabel("Email", { exact: true }).fill(email);
    await webPage.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await webPage.getByRole("button", { name: /^sign in$/i }).click();
    await expect(appAlerts(webPage)).toBeVisible();
    await expect(webPage).toHaveURL(/\/auth\/sign-in/);

    // … NEW password accepted, in a clean context.
    const fresh = await makeAppPage("web");
    await signInAs(fresh, { email, password: NEW_PASSWORD });
    await fresh.goto("/profile");
    await expect(fresh).not.toHaveURL(/\/auth\/sign-in/);
  });
});
