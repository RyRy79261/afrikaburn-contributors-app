// specs/camp-member/camp-member-gate-released-by-close.spec.ts
//
// Persona: CAMP MEMBER — the OTHER way out of a blocking gate.
//
// camp-member-blocking-questionnaire.spec.ts proves the gate traps and then
// releases ON SUBMIT. This proves the second release: the sender CLOSES the
// activation, and everyone still trapped behind it is let out without answering.
//
// Why it needs its own spec. The gate is a `required_actions` row, and closing
// an activation does not delete or complete that row — it flips
// `questionnaire_activations.status` to `closed`. Whether the member walks free
// therefore depends entirely on `listRequiredActions` joining the activation and
// treating a non-open one as no longer blocking. Nothing else in the suite
// exercises that join, so deleting the `activationStatus === "open"` filter
// would leave every other questionnaire spec green while every recipient of a
// closed blocking send stayed locked out of the app permanently — with no
// control anywhere that could free them, because the fill page refuses answers
// to a closed activation.
//
// The camp lead's own control says exactly this ("Recipients stop being blocked
// and can no longer answer"). That sentence is the contract under test.
//
// CAMP-SCOPED on purpose, like its sibling: an org-wide blocking send would gate
// the shared god account and poison every other spec in the run.

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import { authorCampQuestionnaire } from "./support";

test.describe("camp member — a closed activation releases the gate", () => {
  test("closing a blocking questionnaire frees a member who never answered", async ({
    makeAppPage,
  }) => {
    test.setTimeout(180_000);

    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true });
    await joinByInvite(memberPage, invite.url);

    const title = uniqueName("Withdrawn safety briefing");
    const prompt = uniqueName("This question is never answered (close-gate-e2e)");
    const { activationId } = await authorCampQuestionnaire(leadPage, camp.slug, {
      title,
      prompt,
      blocking: true,
    });
    const gateUrl = new RegExp(`/questionnaires/${activationId}$`);

    // The member is genuinely trapped — asserted, not assumed. Without this the
    // release below would prove nothing: an ungated member "passes" it trivially.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(memberPage).toHaveURL(gateUrl);
    await memberPage.goto("/directory");
    await expect(memberPage).toHaveURL(gateUrl);

    // The lead — who is in the "everyone" audience and therefore gated too —
    // answers their own copy first, because the questionnaires LIST is a gated
    // surface and the Close control lives on it. This is the real sequence a
    // lead goes through, not a shortcut around the gate.
    await leadPage.goto(`/questionnaires/${activationId}`);
    await leadPage.getByLabel(prompt).fill("Sending this was a mistake.");
    await leadPage
      .getByRole("button", { name: "Submit answers", exact: true })
      .click();
    await leadPage.waitForURL(/\/directory\/?$/);

    // Close it from the camp's questionnaires list. The control confirms in
    // place and names the consequence being tested.
    await leadPage.goto(`/camps/${camp.slug}/questionnaires`);
    await leadPage.getByRole("button", { name: /^close$/i }).first().click();
    await expect(
      leadPage.getByText(/recipients stop being blocked/i),
    ).toBeVisible();
    await leadPage.getByRole("button", { name: /^close$/i }).first().click();
    await expect(leadPage.getByText(/questionnaire closed/i)).toBeVisible();

    // THE RELEASE. The member never answered, and the app opens anyway.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(memberPage).not.toHaveURL(gateUrl);
    await expect(
      memberPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();
    await memberPage.goto("/directory");
    await expect(memberPage).not.toHaveURL(gateUrl);

    // …and the second half of the same sentence: they can no longer answer it.
    // The fill page must refuse rather than silently accept a late response into
    // a closed activation's aggregate.
    await memberPage.goto(`/questionnaires/${activationId}`);
    await expect(
      memberPage.getByRole("button", { name: "Submit answers", exact: true }),
    ).toHaveCount(0);
  });
});
