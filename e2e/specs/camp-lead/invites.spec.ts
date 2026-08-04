// specs/camp-lead/invites.spec.ts
//
// Persona: CAMP LEAD — growing the crew with one-time invite links. The happy
// path (mint → redeem → roster) and the NEGATIVE space that makes "one-time"
// mean something: a spent link is refused to everyone, and a revoked link is
// dead on arrival. Each "cannot" asserts the SERVER-derived spent state (the
// join page reads `used_at`/`expires_at` from the row), not a hidden button.
//
// On the EXPIRED state: there is no product UI to mint an already-expired invite
// (createInvite defaults to a 30-day TTL and there is no back door — by design),
// so it cannot be exercised through the real UI. The join page renders the SAME
// refusal surface for used and expired ("This invite has been used or expired"),
// so the used-link test below covers that shared refusal path; the pure-expiry
// branch is called out as unverifiable-without-a-back-door in the suite report.

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueUsername } from "../../lib/identity";

test.describe("camp lead — invites", () => {
  test("a one-time member invite adds the invitee, and the spent link is then refused to a stranger", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const strangerPage = await makeAppPage("web");

    const leadName = uniqueUsername("lead_alice");
    const memberName = uniqueUsername("member_ren");

    await signUpBurner(leadPage, { onboard: true, username: leadName });
    const camp = await createCamp(leadPage, { description: "Chai at dawn." });
    const invite = await inviteToCamp(leadPage, camp.slug, "member");
    expect(invite.token).toBeTruthy();

    // The invitee redeems and lands on the camp with a membership.
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    const joined = await joinByInvite(memberPage, invite.url);
    expect(joined.slug).toBe(camp.slug);

    // Roster shows BOTH — the lead sees the new member arrive.
    await leadPage.goto(`/camps/${camp.slug}`);
    await expect(leadPage.getByText(leadName)).toBeVisible();
    await expect(leadPage.getByText(memberName)).toBeVisible();
    await expect(leadPage.getByText("Member", { exact: true })).toBeVisible();

    // One-time enforcement: a DIFFERENT, onboarded stranger opening the same
    // link hits the spent card with NO redeem action. This is the server's
    // used-state (invite.used_at is set), not a hidden button.
    await signUpBurner(strangerPage, { onboard: true });
    await strangerPage.goto(`/join/${invite.token}`);
    await expect(
      strangerPage.getByRole("heading", { name: /used or expired/i }),
    ).toBeVisible();
    await expect(
      strangerPage.getByRole("button", { name: /join|accept|redeem/i }),
    ).toHaveCount(0);
  });

  test("re-opening a link you already redeemed shows the spent state, not a second join", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true });
    await joinByInvite(memberPage, invite.url);

    // Same member, same link, second visit → spent card. The membership is not
    // duplicated and no new join is offered.
    await memberPage.goto(`/join/${invite.token}`);
    await expect(
      memberPage.getByRole("heading", { name: /used or expired/i }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: /join|accept|redeem/i }),
    ).toHaveCount(0);
  });

  test("a revoked invite is dead on arrival", async ({ makeAppPage }) => {
    const leadPage = await makeAppPage("web");
    const wouldJoinPage = await makeAppPage("web");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    // Revoke it through the real UI (the trash control on the invite row).
    await leadPage.goto(`/camps/${camp.slug}`);
    await expect(
      leadPage.locator("code", { hasText: invite.token }),
    ).toBeVisible();
    await leadPage
      .getByRole("button", { name: /revoke invite/i })
      .first()
      .click();
    // The revoked link is removed from the active list (used_at stamped).
    await expect(
      leadPage.locator("code", { hasText: invite.token }),
    ).toHaveCount(0);

    // An onboarded burner who somehow still has the URL is refused: the join
    // page derives the spent state from the revoked row, server-side.
    await signUpBurner(wouldJoinPage, { onboard: true });
    await wouldJoinPage.goto(`/join/${invite.token}`);
    await expect(
      wouldJoinPage.getByRole("heading", { name: /used or expired/i }),
    ).toBeVisible();
    await expect(
      wouldJoinPage.getByRole("button", { name: /join|accept|redeem/i }),
    ).toHaveCount(0);
  });
});
