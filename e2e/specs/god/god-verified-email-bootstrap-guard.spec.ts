// god-verified-email-bootstrap-guard.spec.ts — THE CRITICAL GOD TEST.
//
// WHAT "VERIFIED" MEANS HERE. God is the highest privilege in the system and is
// granted ONLY by the GOD_EMAILS bootstrap in resolveOrgSession, which calls
// packages/core `canBootstrapGod(email, emailVerified, GOD_EMAILS)`:
//
//     if (!emailVerified) return false;          // ← the guard under test
//     return isGodEmailIn(email, godEmails);
//
// "verified" = the auth provider's `user.emailVerified === true`. Email
// verification is currently OFF (derived from RESEND_API_KEY's absence), and
// Better Auth leaves a fresh sign-up's `emailVerified` FALSE when nothing sends
// a verification mail. The consequence — and the invariant this file pins — is:
//
//     No account created through the sign-up UI on the current (mail-off)
//     deployment can EVER become god, regardless of its email address —
//     even an address that is on GOD_EMAILS — because it is never verified.
//
// This is exactly why the harness cannot mint god through the UI and instead
// needs a pre-provisioned, out-of-band-verified E2E_GOD_EMAIL (README "god
// access"). If this guard regressed, a self-service sign-up on a not-yet-claimed
// god address would silently seize the whole console.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { requiresEmailVerification, unverifiedGodEmail } from "../../lib/env";
import { TEST_PASSWORD } from "../../lib/identity";
import { elevateToGod, signInAs, signUpBurner } from "../../personas/factories";
import {
  expectConsoleForbidden,
  expectConsoleReached,
  expectGodPrivileges,
} from "./support";

test.describe("god verified-email bootstrap guard", () => {
  test("a self-service (unverified) sign-up cannot obtain god or any org role", async ({
    webPage,
    orgPage,
  }) => {
    // A brand-new burner, signed up through the real form. Mail is off, so this
    // account is unverified by construction. Its address is not on GOD_EMAILS
    // either — this is the everyday case: nobody self-serves into the console.
    const burner = await signUpBurner(webPage);

    await signInAs(orgPage, burner, "org");
    await orgPage.goto("/");
    // The server refuses: forbidden gate, console chrome absent. Not god, not
    // even org_staff — a self-service account gets nothing.
    await expectConsoleForbidden(orgPage);
  });

  test("a GOD_EMAILS-listed but UNVERIFIED address is still refused god", async ({
    webPage,
    orgPage,
  }) => {
    // THE isolation. This address is on the deployment's GOD_EMAILS list, so the
    // ONLY thing standing between it and god is the verified check. Sign it up
    // fresh (⇒ unverified while mail is off) and prove it is refused — same list
    // membership as the real god, differing solely in `emailVerified`.
    const godAddress = unverifiedGodEmail();
    test.skip(
      godAddress === null,
      "set E2E_UNVERIFIED_GOD_EMAIL to a GOD_EMAILS-listed address that is NOT " +
        "verified on the branch under test to run the verified-guard isolation",
    );
    test.skip(
      requiresEmailVerification(),
      "the unverified-god isolation targets a mail-off deployment (the default " +
        "and the exact condition the verified guard protects)",
    );
    const email = godAddress as string;

    // Deliberate factory VARIANT, not a rebuild: signUpBurner always generates a
    // unique address, but this case needs a specific GOD_EMAILS entry. Same form,
    // same selectors as apps/web/components/auth/auth-form.tsx; mail-off path so
    // sign-up auto-signs-in.
    await webPage.goto("/auth/sign-up");
    await expect(
      webPage.getByLabel("Email", { exact: true }),
    ).toBeVisible();
    await webPage.getByLabel("Email", { exact: true }).fill(email);
    await webPage.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await webPage.getByRole("button", { name: "Create account" }).click();
    // Prove we hold a session (onboarding does not bounce to sign-in).
    await webPage.goto("/onboarding");
    await expect(webPage).not.toHaveURL(/\/auth\/sign-in/);

    // Sign that same identity into the org console. resolveOrgSession runs the
    // bootstrap — and REFUSES, because the email, though listed, is unverified.
    await signInAs(orgPage, { email, password: TEST_PASSWORD }, "org");
    await orgPage.goto("/");
    await expectConsoleForbidden(orgPage);
  });

  test("contrast: a verified + listed account DOES become god", async ({
    orgPage,
  }) => {
    // The other side of the guard, so the two tests together isolate the
    // variable. The pre-provisioned god shares GOD_EMAILS membership with the
    // address above; the ONLY difference is that this one is verified — and it
    // reaches the console. Same list, different verification, opposite outcome.
    skipUnlessGod();
    await elevateToGod(orgPage);
    await expectConsoleReached(orgPage);
    await expectGodPrivileges(orgPage);
  });
});
