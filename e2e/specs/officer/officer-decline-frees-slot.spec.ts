// Officer journey — DECLINE (M3-26, the negative branch of consent).
//
// Declining an officer registration must (a) free the slot back to unassigned —
// a normal, long-lived state — and (b) share NOTHING with the org, because only
// acceptance is the sanctioned phone-sharing path. The first is camp-side and
// runs everywhere; the second needs the org console and is god-gated.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { elevateToGod } from "../../personas/factories";
import {
  OFFICER_NAMES,
  setUpCampWithMember,
  assignOfficer,
  respondToConsent,
  expandRow,
  openOrgRegistration,
} from "./support";

test.describe("officer decline", () => {
  test("declining frees the officer slot back to unassigned", async ({
    makeAppPage,
  }) => {
    test.slow();

    const leadPage = await makeAppPage("web");
    const officerPage = await makeAppPage("web");

    const camp = await setUpCampWithMember(leadPage, officerPage);
    await assignOfficer(
      leadPage,
      camp.slug,
      OFFICER_NAMES.lnt,
      camp.officer.displayName,
    );

    await respondToConsent(officerPage, camp.slug, "decline");

    // The lead's settings row is back to the unassigned state — the slot is free.
    await leadPage.goto(`/camps/${camp.slug}/settings/roles`);
    await expandRow(leadPage, new RegExp(OFFICER_NAMES.lnt));
    await expect(
      leadPage.getByText(/not yet assigned — that's a normal state/i),
    ).toBeVisible();
    // And no lingering "awaiting acceptance" / "shared" language for this officer.
    await expect(
      leadPage.getByText(/awaiting acceptance/i),
    ).toHaveCount(0);
    await expect(
      leadPage.getByText(/shared with afrikaburn/i),
    ).toHaveCount(0);
  });

  test("a declined officer's contact never reaches the org", async ({
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
      camp.officer.displayName,
    );
    await respondToConsent(officerPage, camp.slug, "decline");

    await elevateToGod(orgPage);
    await openOrgRegistration(orgPage, camp.campName);
    await expect(
      orgPage.getByText(/no officers have accepted a role/i),
    ).toBeVisible();
    await expect(
      orgPage.getByText(new RegExp(camp.officer.phoneMarker)),
    ).toHaveCount(0);
  });
});
