// specs/camp-member/camp-member-lifecycle.spec.ts
//
// Persona: CAMP MEMBER (joined by invite, holds no privileges). The happy-path
// lifecycle end to end: a lead invites, the member joins, sees the dashboard and
// roster, and answers a camp questionnaire — the things a member CAN do.
//
// This is the persona's PRIMARY journey, so it runs on BOTH Playwright projects
// (desktop-chromium + mobile-360 — playwright.config.ts), giving the required
// mobile-viewport coverage without a bespoke mobile-only spec.
//
// Every counterpart (the lead) is created through the shared factories, never
// mocked (task rule): the member's story only exists because a real lead invited
// them and authored a real questionnaire.

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { authorCampQuestionnaire, answerRequiredQuestion } from "./support";

test.describe("camp member — lifecycle", () => {
  test("a burner joins a camp by invite and sees the dashboard + roster", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");

    const leadName = uniqueUsername("lead_alice");
    const memberName = uniqueUsername("member_ren");

    // Counterpart: a real lead with a real camp + a real member invite.
    await signUpBurner(leadPage, { onboard: true, username: leadName });
    const camp = await createCamp(leadPage, { description: "Chai at dawn." });
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    // The persona: a second burner redeems the invite.
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    const joined = await joinByInvite(memberPage, invite.url);
    expect(joined.slug).toBe(camp.slug);

    // The dashboard renders for the member (membership survived the join).
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(
      memberPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();

    // Roster shows BOTH people with their structural roles — the member can see
    // who's in their camp (a thing they're allowed to do).
    await expect(memberPage.getByText(leadName)).toBeVisible();
    await expect(memberPage.getByText(memberName)).toBeVisible();
    await expect(memberPage.getByText("Lead", { exact: true })).toBeVisible();
    await expect(memberPage.getByText("Member", { exact: true })).toBeVisible();
  });

  test("the member's dashboard is read-only — no lead-only management surfaces render", async ({
    makeAppPage,
  }) => {
    // UI-absence sanity (the SERVER refusals for these are proven in
    // camp-member-forbidden.spec.ts). A member is default-deny: none of the
    // lead/admin affordances are even offered.
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true });
    await joinByInvite(memberPage, invite.url);
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(
      memberPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();

    // No registration CTA (lead/admin only on the dashboard).
    await expect(
      memberPage.getByRole("link", { name: /begin registration/i }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("link", { name: /continue registration/i }),
    ).toHaveCount(0);
    // No invite-management surface, and — crucially — no invite tokens in the
    // markup at all: `page.tsx` computes `invites = isAdmin ? … : []`, so the
    // member's RSC payload never contains a `/join/` code (this is server-side
    // withholding, not a hidden button).
    await expect(
      memberPage.getByRole("button", { name: /new member invite/i }),
    ).toHaveCount(0);
    await expect(memberPage.getByText("Invite links")).toHaveCount(0);
    await expect(memberPage.locator("code", { hasText: "/join/" })).toHaveCount(
      0,
    );
    // No questionnaire authoring and no role management.
    await expect(
      memberPage.getByRole("link", { name: /manage questionnaires/i }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("link", { name: /manage roles/i }),
    ).toHaveCount(0);
  });

  test("the member answers an optional camp questionnaire and it aggregates for the lead", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true });
    await joinByInvite(memberPage, invite.url);

    // The lead sends a one-question, NON-blocking questionnaire to everyone.
    const title = uniqueName("Build-week shift preferences");
    const prompt = uniqueName(
      "Which build days can you make it? (camp-member-e2e)",
    );
    const answer = "Wednesday and Thursday.";
    const { activationId } = await authorCampQuestionnaire(
      leadPage,
      camp.slug,
      {
        title,
        prompt,
        blocking: false,
      },
    );

    // The member sees it as a pending questionnaire on their dashboard and opens
    // it via the card's "Answer" action.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(memberPage.getByText(/pending questionnaires/i)).toBeVisible();
    await expect(memberPage.getByText(title)).toBeVisible();
    await memberPage.getByRole("link", { name: /^answer$/i }).click();
    await memberPage.waitForURL(`**/questionnaires/${activationId}`);

    // The optional fill page shows the Optional badge — NOT the blocking gate.
    await expect(memberPage.getByText("Optional")).toBeVisible();
    await expect(
      memberPage.getByText(/you can['’]t use the portal until this is done/i),
    ).toHaveCount(0);

    await answerRequiredQuestion(memberPage, { prompt, answer });
    // A successful submit redirects to the directory (fill page `redirectTo`).
    await memberPage.waitForURL(/\/directory\/?$/);

    // Re-opening shows the terminal "already submitted" state — the response
    // persisted server-side, not just in the client.
    await memberPage.goto(`/questionnaires/${activationId}`);
    await expect(memberPage.getByText(/already submitted/i)).toBeVisible();

    // And the lead's results view aggregates it: 1 of 2 recipients complete
    // (audience "everyone" = lead + member; only the member answered).
    await leadPage.goto(`/camps/${camp.slug}/questionnaires`);
    await expect(leadPage.getByText(title)).toBeVisible();
    await expect(leadPage.getByText(/1 of 2 complete/i)).toBeVisible();
  });
});
