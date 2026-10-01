// specs/camp-lead/onboarding.spec.ts
//
// Persona: CAMP LEAD (with two members). Camp onboarding (epic #54), end to
// end through the real UI:
//
//   1. the lead starts an onboarding from the PRESET, and the builder shows
//      who it reaches — leads and co-leads OFF by default, so a camp of lead +
//      one member "Reaches 1 of 2";
//   2. the lead sends it; the completion view shows TOTALS, and NO names until
//      "Show names" is asked for (ONBOARD-020);
//   3. the member walks it ONE STEP AT A TIME, and can't finish until every
//      acknowledgement is ticked;
//   4. the lead's total moves to "1 of 1" and the member's name appears only
//      behind "Show names";
//   5. someone who joins AFTER the send gets it too, and the total becomes
//      "1 of 2".

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueUsername } from "../../lib/identity";

test.describe("camp lead — onboarding", () => {
  test("build from the preset, send, member steps through, totals move", async ({
    makeAppPage,
  }) => {
    test.setTimeout(180_000);
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const laterPage = await makeAppPage("web");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);

    const memberName = uniqueUsername();
    const invite = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, invite.url);

    // --- 1. Start from the preset ------------------------------------------
    await leadPage.goto(`/camps/${camp.slug}/questionnaires/new`);
    await leadPage.getByRole("button", { name: /^onboarding/i }).click();
    await expect(
      leadPage.getByText(/what the onboarding preset adds/i),
    ).toBeVisible();
    await leadPage
      .getByRole("button", { name: /continue with onboarding/i })
      .click();
    await leadPage.waitForURL(/\/questionnaires\/onboarding\/[0-9a-f-]{36}$/);
    const activationId = leadPage.url().split("/").pop()!;

    // Leads are OFF by default: lead + one member → reaches the member only.
    await expect(leadPage.getByTestId("onboarding-reach")).toHaveText(
      /reaches 1 of 2 members/i,
    );
    await expect(leadPage.getByText(/^optional$/i).first()).toBeVisible();

    // Edit the first section's text; autosave lands.
    const welcomeText = "We camp at the far end. Bring a mug.";
    await leadPage.getByLabel("Text", { exact: true }).fill(welcomeText);
    await expect(leadPage.getByTestId("onboarding-saved")).toBeVisible({
      timeout: 15_000,
    });

    // --- 2. Send ---------------------------------------------------------------
    await leadPage.getByRole("button", { name: /^send$/i }).click();
    await leadPage.getByRole("button", { name: /send now/i }).click();
    await leadPage.waitForURL(
      new RegExp(`/camps/${camp.slug}/questionnaires/${activationId}$`),
    );
    await expect(leadPage.getByTestId("onboarding-complete")).toHaveText(
      /0 of 1/,
    );
    // Totals first: the "Show names" control is there, the member's name is not.
    await expect(
      leadPage.getByRole("link", { name: /show names/i }),
    ).toBeVisible();
    await expect(leadPage.getByText(memberName)).toHaveCount(0);

    // --- 3. The member walks it, one step at a time ---------------------------
    await memberPage.goto(`/questionnaires/${activationId}`);
    await expect(memberPage.getByText(/it doesn['’]t block anything/i)).toBeVisible();
    await expect(memberPage.getByText(welcomeText)).toBeVisible();
    // Sections 1–5 are information: one Next each.
    for (let step = 1; step <= 5; step++) {
      await expect(memberPage.getByText(`Page ${step} of 6`)).toBeVisible();
      await memberPage.getByRole("button", { name: /^next$/i }).click();
    }
    await expect(memberPage.getByText("Page 6 of 6")).toBeVisible();
    const finish = memberPage.getByRole("button", {
      name: /finish onboarding/i,
    });
    // Can't finish until every box is ticked — and it says why.
    await expect(finish).toBeDisabled();
    await expect(memberPage.getByText(/tick all 2 to finish/i)).toBeVisible();
    const boxes = memberPage.getByRole("checkbox");
    await expect(boxes).toHaveCount(2);
    await boxes.nth(0).check();
    await expect(finish).toBeDisabled();
    await boxes.nth(1).check();
    await expect(finish).toBeEnabled();
    await finish.click();
    await memberPage.waitForURL(/\/directory\/?$/);

    // --- 4. The lead's total moves; names only on demand ----------------------
    await leadPage.reload();
    await expect(leadPage.getByTestId("onboarding-complete")).toHaveText(
      /1 of 1/,
    );
    await expect(leadPage.getByText(memberName)).toHaveCount(0);
    await leadPage.getByRole("link", { name: /show names/i }).click();
    await expect(leadPage.getByRole("link", { name: /hide names/i })).toBeVisible();
    await expect(
      leadPage.getByRole("cell", { name: memberName }),
    ).toBeVisible();

    // --- 5. Someone who joins later gets it too -------------------------------
    const invite2 = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(laterPage, { onboard: true });
    await joinByInvite(laterPage, invite2.url);
    await laterPage.goto(`/questionnaires/${activationId}`);
    await expect(
      laterPage.getByRole("heading", { name: /welcome to/i }),
    ).toBeVisible();
    await expect(laterPage.getByText("Page 1 of 6")).toBeVisible();

    await leadPage.goto(`/camps/${camp.slug}/questionnaires/${activationId}`);
    await expect(leadPage.getByTestId("onboarding-complete")).toHaveText(
      /1 of 2/,
    );
  });
});
