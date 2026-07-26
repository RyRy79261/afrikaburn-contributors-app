// specs/new-burner/directory-and-join.spec.ts — browsing and joining.
//
// The new burner's two social entry points: browsing the camp directory, and
// joining a camp by a one-time invite link. The join path needs a counterpart
// (a lead who owns the camp and issues the invite) — created with the shared
// factories, not mocked. The directory test also proves the undiscoverability
// law from the burner's own vantage: a free (unregistered) camp shows to its
// members and is invisible to a stranger burner.

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";

test.describe("new burner · directory & joining", () => {
  test("an onboarded burner can browse the directory", async ({ webPage }) => {
    await signUpBurner(webPage, { onboard: true });
    await webPage.goto("/directory");
    // Reachable (not gated to onboarding) and rendered as the directory itself.
    await expect(
      webPage.getByRole("heading", { name: "Directory", exact: true }),
    ).toBeVisible();
    await expect(webPage).not.toHaveURL(/\/onboarding/);
  });

  test("a free camp shows to its member but is invisible to a stranger", async ({
    webPage, // owner
    makeAppPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, {
      name: uniqueName("Free Camp"),
      joinability: "invite_only",
    });

    // The owner sees their own free camp in the directory ("members only" band).
    await webPage.goto("/directory");
    await expect(webPage.getByText(camp.name).first()).toBeVisible();

    // A stranger burner does NOT — free camps are undiscoverable to non-members.
    const stranger = await makeAppPage("web");
    await signUpBurner(stranger, { onboard: true });
    await stranger.goto("/directory");
    await expect(
      stranger.getByRole("heading", { name: "Directory", exact: true }),
    ).toBeVisible();
    await expect(stranger.getByText(camp.name)).toHaveCount(0);

    // Search must not surface it either (type-ahead enforces the same law).
    await stranger.goto(`/directory?q=${encodeURIComponent(camp.name)}`);
    await expect(stranger.getByText(camp.name)).toHaveCount(0);
  });

  test("a burner joins a camp by invite and lands on its roster", async ({
    webPage, // lead
    makeAppPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);
    const invite = await inviteToCamp(webPage, camp.slug, "member");

    // The invitee — a second, independent burner — redeems the link.
    const joiner = await makeAppPage("web");
    const joinerName = uniqueUsername("joiner");
    await signUpBurner(joiner, { onboard: true, username: joinerName });
    const joined = await joinByInvite(joiner, invite.url);
    expect(joined.slug).toBe(camp.slug);

    // The joiner now sees the camp dashboard (they are a member).
    await expect(
      joiner.getByRole("heading", { name: camp.name }),
    ).toBeVisible();

    // And the lead's roster now lists the joiner — the membership really wrote.
    await webPage.goto(`/camps/${camp.slug}`);
    await expect(webPage.getByText(joinerName).first()).toBeVisible();
  });
});
