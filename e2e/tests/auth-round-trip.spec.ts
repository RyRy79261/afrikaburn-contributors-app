// tests/auth-round-trip.spec.ts — a worked example that proves the persona
// vocabulary reads like the story it tests, and exercises the create/read loop
// the PR smoke subset depends on (M3-31). This is a HARNESS demonstration; the
// full journey suites (M3-18/20/21/22…) are downstream, one owner per app.
//
// NOTE: this has never been run — there is no deployed DB yet (roadmap §0). It
// is written correct-by-construction against verified selectors.

import { test, expect } from "../fixtures";
import { signUpBurner, createCamp } from "../personas/factories";

test.describe("burner sign-up → bio → camp @smoke", () => {
  test("a new burner onboards and creates a camp", async ({ webPage }) => {
    // signUpBurner handles both verification-off (synthetic email, auto sign-in)
    // and verification-on (disposable inbox + link) deployments transparently.
    const account = await signUpBurner(webPage, { onboard: true });
    expect(account.email).toContain("@");

    const camp = await createCamp(webPage, { description: "Chai at dawn." });
    // Landing on the camp page with the camp's name proves the write persisted
    // and the creator holds the (lead) view — not merely that a link exists.
    await webPage.goto(`/camps/${camp.slug}`);
    await expect(
      webPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();
  });
});
