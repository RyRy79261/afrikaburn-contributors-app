// specs/new-burner/passkeys.spec.ts
//
// Persona: NEW BURNER — a passkey, created and removed against a real
// authenticator.
//
// Passkeys were the other half of why self-hosted Better Auth was pulled
// forward (task #58), and the card had never been driven. two-factor.spec.ts
// left this out with a note saying WebAuthn "needs a virtual authenticator over
// CDP, which is a different harness". It is a different harness; it is also
// four lines of it, so here it is rather than a permanent TODO.
//
// ## What a virtual authenticator is, and why this is not a mock
//
// `WebAuthn.addVirtualAuthenticator` is a Chrome DevTools Protocol command that
// installs a software authenticator INSIDE the browser. `navigator.credentials
// .create()` and `.get()` run their real code paths against it — real
// challenge, real attestation object, real signature — and the server verifies
// them exactly as it would a YubiKey. Nothing in the app or in Better Auth is
// stubbed. What is simulated is the hardware and the fingerprint, which no
// automated test can supply.
//
// Chromium only, which is what both Playwright projects run.
//
// What is asserted:
//   1. The card offers enrolment (it disables itself when the browser has no
//      WebAuthn at all, and a spec that silently hit that path would prove
//      nothing).
//   2. A named passkey is created and appears in the list, on a FRESH server
//      render — so it reached `passkey` rows, not just component state.
//   3. Removing it takes it away, again on a fresh render.
//
// Signing IN with the passkey is deliberately not here: the sign-in page has no
// passkey button yet (apps/web auth-form.tsx offers email/password and Google),
// so there is nothing to drive. When it ships, this file is where it goes.

import { test, expect } from "../../fixtures";
import { signUpBurner } from "../../personas/factories";
import { uniqueName } from "../../lib/identity";

test.describe("new burner — passkeys", () => {
  test("creates a passkey against a virtual authenticator, then removes it", async ({
    webPage,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "WebAuthn.addVirtualAuthenticator is a Chrome DevTools Protocol command",
    );
    test.setTimeout(180_000);

    // The authenticator goes in BEFORE the page needs it. `isUserVerified` +
    // `automaticPresenceSimulation` stand in for the fingerprint the card asks
    // for; `hasResidentKey` makes it a discoverable credential, which is what a
    // passkey is.
    const cdp = await webPage.context().newCDPSession(webPage);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send(
      "WebAuthn.addVirtualAuthenticator",
      {
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      },
    );

    try {
      await signUpBurner(webPage, { onboard: true });
      await webPage.goto("/account/security");

      const addPasskey = webPage.getByRole("button", {
        name: /add a passkey/i,
      });
      await expect(addPasskey).toBeVisible();
      // ENABLED. The card disables this when `PublicKeyCredential` is missing
      // and explains why; a run that landed there would sail through an
      // "is the button present" assertion and test nothing.
      await expect(addPasskey).toBeEnabled();
      await expect(
        webPage.getByText(/haven['’]t added any passkeys yet/i),
      ).toBeVisible();

      const label = uniqueName("Tankwa phone");
      await addPasskey.click();
      await webPage.getByLabel(/name this passkey/i).fill(label);
      await webPage.getByRole("button", { name: /create passkey/i }).click();

      // The name the burner chose is what comes back — a passkey list that
      // showed "Passkey" for everything would be useless on the day someone
      // needs to revoke the phone they lost.
      await expect(webPage.getByText(label)).toBeVisible({ timeout: 30_000 });

      // …and the credential really exists on the authenticator, so the browser
      // did a genuine create rather than the app recording an intention.
      const stored = await cdp.send("WebAuthn.getCredentials", {
        authenticatorId,
      });
      expect(stored.credentials.length).toBe(1);

      // DURABLE. A fresh server render is what a returning session sees.
      await webPage.goto("/account/security");
      await expect(webPage.getByText(label)).toBeVisible();
      await expect(webPage.getByText(/1 set up/i)).toBeVisible();

      // REMOVE. A credential you cannot revoke is worse than none: the whole
      // point of the list is the day a device is lost.
      await webPage.getByRole("button", { name: /^remove$/i }).click();
      await expect(webPage.getByText(label)).toHaveCount(0, {
        timeout: 30_000,
      });

      await webPage.goto("/account/security");
      await expect(webPage.getByText(label)).toHaveCount(0);
      await expect(
        webPage.getByText(/haven['’]t added any passkeys yet/i),
      ).toBeVisible();
    } finally {
      // Leave the browser as we found it — a virtual authenticator outlives the
      // page and would follow this context into any reuse.
      await cdp.send("WebAuthn.removeVirtualAuthenticator", {
        authenticatorId,
      });
      await cdp.detach().catch(() => undefined);
    }
  });
});
