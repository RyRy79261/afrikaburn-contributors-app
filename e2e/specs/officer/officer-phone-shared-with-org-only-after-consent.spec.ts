// Officer journey — the POPIA phone-sharing boundary (M3-26, the crux).
//
// This is the ONLY path in the whole product that shares a burner's phone with
// AfrikaBurn (auth-platform-spec §8.1 / §9.2; questionnaire-spec §"Officers are
// ALSO registrations"). So the assertion is precise and two-sided IN ONE TEST:
//   BEFORE acceptance — a PENDING officer's phone is NOWHERE on the org review
//                       (the server query filters consent='accepted' AND
//                        org_visible=true, so it never reaches the client), and
//   AFTER  acceptance — the same phone (and the officer's name) IS on the review.
//
// Adversarial value (M3-30): delete the `consent = accepted` / `org_visible`
// filter in getRegistrationOfficers and the BEFORE assertion goes red — a
// pending officer's phone would surface. That is exactly the leak this guards.
//
// Needs the org console → god. Skips cleanly when god isn't provisioned; it is
// never faked (a fresh sign-up can't self-elevate — personas/registry.ts).

import { test, expect, skipUnlessGod } from "../../fixtures";
import { elevateToGod } from "../../personas/factories";
import {
  OFFICER_NAMES,
  setUpCampWithMember,
  assignOfficer,
  respondToConsent,
  openOrgRegistration,
} from "./support";

test.describe("officer phone → org, only after consent", () => {
  test("a pending officer's phone is hidden from org review; acceptance reveals it", async ({
    makeAppPage,
    orgPage,
  }) => {
    skipUnlessGod();
    test.slow();

    const leadPage = await makeAppPage("web");
    const officerPage = await makeAppPage("web");

    const camp = await setUpCampWithMember(leadPage, officerPage);
    await assignOfficer(
      leadPage,
      camp.slug,
      OFFICER_NAMES.lnt,
      camp.officer.username,
    );

    // The consent is still PENDING (assigned, not yet accepted).
    await elevateToGod(orgPage);
    const detailUrl = await openOrgRegistration(orgPage, camp.campName);

    const marker = camp.officer.phoneMarker;
    // BEFORE: the officers card reports no accepted officers, and — the hard part —
    // the phone digits are absent from the ENTIRE review page, not merely a card.
    await expect(
      orgPage.getByText(/no officers have accepted a role/i),
    ).toBeVisible();
    await expect(orgPage.getByText(new RegExp(marker))).toHaveCount(0);

    // The member accepts — the consent moment.
    await respondToConsent(officerPage, camp.slug, "accept");

    // AFTER: re-fetch the same review; the officer's name and phone now appear.
    await orgPage.goto(detailUrl);
    await expect(
      orgPage.getByText(new RegExp(camp.officer.username)),
    ).toBeVisible();
    await expect(
      orgPage.getByText(new RegExp(marker)).first(),
    ).toBeVisible();
  });
});
