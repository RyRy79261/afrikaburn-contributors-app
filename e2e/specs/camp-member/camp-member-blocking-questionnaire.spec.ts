// specs/camp-member/camp-member-blocking-questionnaire.spec.ts
//
// Persona: CAMP MEMBER. A camp lead can send a BLOCKING questionnaire; for the
// member that is a hard gate — the app is unusable until it's answered, and the
// ONLY reachable actions are filling it in and signing out (questionnaire-spec
// §"Engine mechanics"; roadmap M3-27's blocking clause, member side).
//
// This spec proves the gate both TRAPS (every other surface redirects back to
// it, server-side) and RELEASES (after submit the app opens). A gate that traps
// but never releases, or releases without an answer, is the failure this guards.

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import { authorCampQuestionnaire, answerRequiredQuestion } from "./support";

test.describe("camp member — blocking questionnaire gate", () => {
  test("a blocking send traps the member on the fill page and releases only on submit", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true });
    await joinByInvite(memberPage, invite.url);

    const title = uniqueName("Mandatory safety briefing ack");
    const prompt = uniqueName("Confirm you've read the fire-safety brief (camp-member-e2e)");
    const { activationId } = await authorCampQuestionnaire(leadPage, camp.slug, {
      title,
      prompt,
      blocking: true,
    });
    const gateUrl = new RegExp(`/questionnaires/${activationId}$`);

    // Trap #1: heading for the camp dashboard redirects to the gate.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(memberPage).toHaveURL(gateUrl);

    // The gate chrome is stripped: the Required badge + the lock message are
    // shown, sign-out is offered, and NO app navigation is present (a nav link
    // would be an escape hatch the gate must not have).
    await expect(
      memberPage.getByText(/required · blocks until done/i),
    ).toBeVisible();
    await expect(
      memberPage.getByText(/you can['’]t use the portal until this is done/i),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: /sign out/i }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("link", { name: /directory/i }),
    ).toHaveCount(0);

    // Trap #2 + #3: other gated surfaces bounce straight back to the gate,
    // server-side (enforceGate in profile/page.tsx and directory/page.tsx).
    await memberPage.goto("/profile");
    await expect(memberPage).toHaveURL(gateUrl);
    await memberPage.goto("/directory");
    await expect(memberPage).toHaveURL(gateUrl);

    // Answer the required question → the gate releases and lands us on the directory.
    await answerRequiredQuestion(memberPage, {
      prompt,
      answer: "Confirmed.",
      submitLabel: "Submit answers",
    });
    await memberPage.waitForURL(/\/directory\/?$/);

    // Released: the camp dashboard now renders instead of redirecting.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(memberPage).not.toHaveURL(gateUrl);
    await expect(
      memberPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();
  });
});
