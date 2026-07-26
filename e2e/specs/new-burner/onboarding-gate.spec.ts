// specs/new-burner/onboarding-gate.spec.ts — the blocking Burner-Bio gate.
//
// The Burner Bio is a BLOCKING required action (apps/web/lib/session.ts
// enforceGate → pendingBlockingRoute → firstBlockingAction; the bio row is
// created blocking on first authenticated request). While it is pending, every
// gated participant route redirects to the fill page (/onboarding) and the only
// way out of the app is signing out — exactly the hard-gate contract the task
// and roadmap M3-20/M3-27 describe. Completing the bio releases it.
//
// (The org-authored *blocking questionnaire* variant — the stripped-chrome
// /questionnaires/<id> gate — is the same spine keyed to a questionnaire
// activation; provisioning one needs the org/god counterpart and is owned by the
// questionnaire journey, M3-27. This spec proves the spine on the gate the new
// burner actually hits with no external setup.)

import { test, expect } from "../../fixtures";
import { signUpBurner, signOut, completeBio } from "../../personas/factories";

test.describe("new burner · blocking onboarding gate", () => {
  test("every gated route redirects an un-onboarded burner to the Burner Bio", async ({
    webPage,
  }) => {
    // Signed in but NOT onboarded → the bio is a pending blocking action.
    await signUpBurner(webPage);

    for (const route of ["/directory", "/camps/new", "/profile", "/"]) {
      await webPage.goto(route);
      await expect(webPage, `route ${route} should be gated`).toHaveURL(
        /\/onboarding/,
      );
      await expect(
        webPage.getByRole("heading", { name: /set up your burner bio/i }),
      ).toBeVisible();
    }
  });

  test("only sign-out escapes the gate", async ({ webPage }) => {
    await signUpBurner(webPage);
    await webPage.goto("/onboarding");

    // Sign-out is present on the gated page (its label is viewport-stable, unlike
    // the header nav links whose text is `hidden sm:inline` at 360px).
    const signOutBtn = webPage.getByRole("button", { name: /sign out/i });
    await expect(signOutBtn).toBeVisible();

    // Reaching for any other in-app surface does NOT escape — it bounces back to
    // the fill page. (A direct navigation is the viewport-independent way to
    // prove the redirect; the header link would do the same when it's visible.)
    await webPage.goto("/camps/new");
    await expect(webPage).toHaveURL(/\/onboarding/);

    // Signing out truly ends the session: a protected route now needs sign-in.
    await signOut(webPage);
    await webPage.goto("/profile");
    await expect(webPage).toHaveURL(/\/auth\/sign-in/);
  });

  test("completing the Burner Bio releases the gate", async ({ webPage }) => {
    await signUpBurner(webPage);
    // Sanity: gated before completion.
    await webPage.goto("/directory");
    await expect(webPage).toHaveURL(/\/onboarding/);

    await completeBio(webPage);

    // Released: the directory is now reachable as itself, not the bio.
    await webPage.goto("/directory");
    await expect(webPage).not.toHaveURL(/\/onboarding/);
    await expect(
      webPage.getByRole("heading", { name: "Directory", exact: true }),
    ).toBeVisible();
  });
});
