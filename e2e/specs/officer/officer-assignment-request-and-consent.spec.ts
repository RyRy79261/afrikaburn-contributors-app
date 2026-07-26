// Officer journey — the assignment REQUEST reaches the member, and the consent
// surface lets them accept (M3-26, first half). This half needs no org console,
// so it runs on every deployment; the phone-sharing boundary that DOES need the
// console lives in officer-phone-shared-with-org-only-after-consent.spec.ts.
//
// What this proves in product terms:
//   • assigning an officer creates a PENDING registration and NOTIFIES the member
//   • the member sees both the inbox notification AND the on-camp consent banner
//   • accepting flips the camp-side record to "contact shared with AfrikaBurn"
//     and sends the acceptance confirmation back to the officer
//   • the whole thing works at 360px (the config runs this file on mobile too)

import { test, expect } from "../../fixtures";
import {
  OFFICER_NAMES,
  setUpCampWithMember,
  assignOfficer,
  respondToConsent,
  expandRow,
} from "./support";

test.describe("officer assignment request + consent", () => {
  test("an assigned member is notified, sees the consent surface, and accepts", async ({
    makeAppPage,
  }) => {
    // A journey this deep across two members needs headroom over the base cap.
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

    // --- The member receives the assignment request (notification) ----------
    await officerPage.goto("/notifications");
    await expect(
      officerPage.getByText(
        new RegExp(
          `${escapeRe(camp.campName)}.*would like you to be their ${OFFICER_NAMES.lnt}`,
          "i",
        ),
      ),
    ).toBeVisible();

    // --- ...and the on-camp consent surface (the POPIA consent moment) -------
    await officerPage.goto(`/camps/${camp.slug}`);
    await expect(
      officerPage.getByRole("heading", {
        name: /you've been asked to be a camp officer/i,
      }),
    ).toBeVisible();
    // The consent copy must name what acceptance shares — phone included.
    await expect(
      officerPage.getByText(/name, email,? and phone/i).first(),
    ).toBeVisible();

    // --- Accept: the consent is recorded ------------------------------------
    await respondToConsent(officerPage, camp.slug, "accept");

    // The officer gets the acceptance confirmation in their inbox.
    await officerPage.goto("/notifications");
    await expect(
      officerPage.getByText(
        new RegExp(`${OFFICER_NAMES.lnt} registration accepted`, "i"),
      ),
    ).toBeVisible();

    // Camp-side: the lead now sees the accepted state + the "shared" language,
    // which is the settings-page reflection of the org gaining contact access.
    await leadPage.goto(`/camps/${camp.slug}/settings/roles`);
    await expandRow(leadPage, new RegExp(OFFICER_NAMES.lnt));
    await expect(
      leadPage.getByText(
        /accepted · name, email and phone shared with afrikaburn/i,
      ),
    ).toBeVisible();
  });
});

/** Escape a camp name for use inside a RegExp (names carry no regex meta today,
 * but the generator is free to change — belt and braces). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
