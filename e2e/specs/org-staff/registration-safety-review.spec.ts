// specs/org-staff/registration-safety-review.spec.ts
//
// Persona: ORG STAFF — section 4's safety answers on the registration review
// (docs/registration-safety-spec.md §"Org review"), and the wrangler's
// DEFERRED fuel depot copy.
//
//   • The review shows the camp's real answers (Generator, Fire with kinds,
//     Gas or fuel), the worked-out water estimate, and — from the camp's SAVED
//     gas & fuel record, read live — "Fuel depot: Over the limit" with when the
//     camp was told and that no wrangler has been yet.
//   • Form 2 runs before a wrangler exists. When one is assigned after
//     approval, THEY get the copy the save could not send, in the console.
//
// Needs a real org session, so it skips cleanly without E2E_GOD_EMAIL.

import type { Page } from "@playwright/test";
import { test, expect, skipUnlessGod } from "../../fixtures";
import { uniqueUsername } from "../../lib/identity";
import {
  createCamp,
  signUpBurner,
  submitRegistration,
} from "../../personas/factories";
import { decide, openRegistrationInConsole } from "../camp-lead/support";
import { provisionOrgStaff } from "./_helpers";

/** Save an over-the-limit record: 2 × 48 kg and a 200 L barrel. */
async function saveOverTheLimit(web: Page, slug: string) {
  await web.goto(`/camps/${slug}/gas-fuel`);
  await web.getByRole("combobox", { name: "Bottle size" }).click();
  await web.getByRole("option", { name: "48 kg", exact: true }).click();
  await web.getByLabel("How many").fill("2");
  await web.getByLabel("200 L barrels").fill("1");
  await web.getByRole("button", { name: "Save record" }).click();
  await expect(web.getByTestId("gas-fuel-depot-notice")).toBeVisible();
}

/** A review field's value, by its label (the FieldList is a <dl>). */
function field(org: Page, label: string) {
  return org
    .locator("dt", { hasText: new RegExp(`^${label}$`, "i") })
    .locator("xpath=following-sibling::dd[1]")
    .filter({ visible: true });
}

test.describe("org staff · registration safety on the review", () => {
  test("shows the real gate answers, the water estimate and the fuel depot state", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(240_000);

    const lead = await makeAppPage("web");
    await signUpBurner(lead, { onboard: true });
    const camp = await createCamp(lead, { description: "Chai at dawn." });
    await submitRegistration(lead, camp.slug, {
      expectedPopulation: 45,
      firstArrivalDate: "2027-04-24",
      hasGenerator: true,
      hasFire: true,
      fireKinds: ["Braai or brazier (raised)", "Gas cooking or heating"],
      hasGasOrFuel: true,
    });
    // The record is a camp record, not part of the submission: saved AFTER
    // submitting, it still reaches the review, because it is read live.
    await saveOverTheLimit(lead, camp.slug);

    const staff = await provisionOrgStaff(makeAppPage);
    await openRegistrationInConsole(staff.org, camp.name);

    // Something PRESENT first: the section's existing field.
    await expect(field(staff.org, "Expected population")).toHaveText("45");
    await expect(field(staff.org, "Generator")).toHaveText("Yes");
    await expect(field(staff.org, "Fire")).toHaveText(
      "Yes — braai or brazier (raised), gas cooking or heating",
    );
    await expect(field(staff.org, "Gas or fuel")).toHaveText("Yes");
    await expect(field(staff.org, "Water estimate")).toContainText(
      "About 2,025 L — 5 L a person a day × 45 people × 9 days",
    );
    const depot = field(staff.org, "Fuel depot");
    await expect(depot).toContainText("Over the limit");
    await expect(depot).toContainText("96 kg of gas and a 200 L barrel");
    await expect(depot).toContainText("The camp's leads were told on");
    await expect(depot).toContainText("Wrangler not told yet: none assigned");
    await expect(field(staff.org, "Gas & fuel record")).toContainText(
      "1 × 200 L barrel",
    );
    // No layout was drawn, so nothing from a pinned layout is shown.
    await expect(
      staff.org.getByText("Extinguishers (from the pinned layout)"),
    ).toHaveCount(0);
  });

  test("assigning a wrangler after approval sends them the deferred fuel depot copy", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    test.skip(
      test.info().project.name === "mobile-360",
      "the wrangler picker is desktop-shaped; the review values run on 360 above",
    );
    test.setTimeout(300_000);

    const lead = await makeAppPage("web");
    await signUpBurner(lead, { onboard: true });
    const camp = await createCamp(lead, { description: "Shade." });
    await submitRegistration(lead, camp.slug, { hasGasOrFuel: true });
    await saveOverTheLimit(lead, camp.slug);

    const wranglerName = uniqueUsername("wrangler");
    const staff = await provisionOrgStaff(makeAppPage, {
      username: uniqueUsername("reviewer"),
    });
    const wrangler = await provisionOrgStaff(makeAppPage, {
      username: wranglerName,
    });

    // Before anyone holds the camp, the wrangler's inbox has nothing.
    const COPY = new RegExp(
      `${camp.name} is over the fuel depot limit — talk to them about how the fuel depot works`,
    );
    await wrangler.org.goto("/notifications");
    await expect(
      wrangler.org.getByRole("heading", { level: 1, name: "Notifications" }),
    ).toBeVisible();
    await expect(wrangler.org.getByText(COPY)).toHaveCount(0);

    const url = await openRegistrationInConsole(staff.org, camp.name);
    await decide(staff.org, "Approve");
    await expect(staff.org.getByText(/approve applied/i)).toBeVisible();
    await staff.org.getByRole("combobox", { name: "Assign wrangler" }).click();
    await staff.org.getByRole("option", { name: wranglerName }).click();
    await expect(staff.org.getByText(/wrangler assigned/i)).toBeVisible();

    // The wrangler hears, in the console, once.
    await wrangler.org.goto("/notifications");
    await expect(wrangler.org.getByText(COPY).filter({ visible: true })).toHaveCount(1);

    // And the review now says when.
    await staff.org.goto(url);
    await expect(field(staff.org, "Fuel depot")).toContainText(
      "The wrangler was told on",
    );
  });
});
