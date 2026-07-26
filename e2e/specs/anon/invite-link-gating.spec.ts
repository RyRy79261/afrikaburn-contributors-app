// specs/anon/invite-link-gating.spec.ts — what happens when an anonymous visitor
// opens a VALID camp invite link. The join route (apps/web/app/join/[token]/
// page.tsx) requires a session: `if (!authUser) redirect("/auth/sign-in")` fires
// BEFORE the invite is previewed, so an anon is sent to sign-in and — crucially —
// the invited (free) camp's name/description is never revealed to a stranger who
// merely holds the link. This is both the anon's route TO sign-in and a guard on
// free-camp undiscoverability via the invite surface.
//
// PRODUCT-vs-BRIEF NOTE (report): the persona brief lists "open a valid invite
// link" as something the anon CAN do; in the product the link resolves to the
// sign-in wall (the invite is redeemed only once signed in). We assert that real
// behaviour rather than a leak.

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
} from "../../personas/factories";

test.describe("anonymous visitor — invite links gate to sign-in", () => {
  test("opening a valid invite link redirects an anon to sign-in without leaking the camp", async ({
    webPage,
    makeAppPage,
  }) => {
    // A lead creates a real, free camp and mints a genuine member invite.
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, {
      description: "A members-only free camp behind the invite.",
    });
    const invite = await inviteToCamp(webPage, camp.slug);

    // An anon opens the SAME valid link → bounced to sign-in.
    const anon = await makeAppPage("web");
    await anon.goto(`/join/${invite.token}`);
    await expect(anon).toHaveURL(/\/auth\/sign-in/);
    await expect(anon.getByLabel("Email", { exact: true })).toBeVisible();

    // The invited (free) camp's identity is NOT disclosed to the anon — the
    // redirect fires before the invite preview renders.
    await expect(anon.getByText(camp.name)).toHaveCount(0);
    await expect(
      anon.getByText(/you've been invited to join/i),
    ).toHaveCount(0);
  });

  test("a bogus invite token also gates an anon to sign-in (no preview, no oracle)", async ({
    makeAppPage,
  }) => {
    // The session gate precedes invite validation, so a real vs. fake token look
    // identical to an anon — both land on sign-in, giving no existence oracle.
    const anon = await makeAppPage("web");
    await anon.goto(`/join/not-a-real-token-${Date.now().toString(36)}`);
    await expect(anon).toHaveURL(/\/auth\/sign-in/);
  });
});
