// specs/camp-lead/registration-safety.spec.ts
//
// Persona: CAMP LEAD — power, fire, gas, fuel and water
// (docs/registration-safety-spec.md, epic #49).
//
//   • Section 4's three gates and the fire follow-up: required for the
//     section, saved server-side, "No" to fire clears the kinds; the rough
//     water guide is worked out from population and arrival; the policies are
//     links only.
//   • Submit opens on Form 1 alone: the gates never hold it.
//   • The optional gas & fuel record: a save over the limit shows the depot
//     notice and tells the camp's leads ONCE, in-app, with no amounts; a plain
//     member reads it but cannot change it; the dashboard tile and section 4
//     read only the saved record.
//
// Runs on desktop and mobile-360 — every screen here is a 360 screen too.

import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  answerSafetyGates,
  createCamp,
  inviteToCamp,
  joinByInvite,
  signUpBurner,
  submitRegistration,
} from "../../personas/factories";
import { expectServerNotFound } from "../camp-member/support";

/** Make the registration row exist (the record lives on it). */
async function startDraft(page: Page, slug: string) {
  await page.goto(`/camps/${slug}/registration`);
  await page.getByLabel(/camp description/i).fill("Chai at dawn.");
  await page.getByLabel(/^contact email/i).fill("lead@example.com");
  await page.getByLabel(/^contact email/i).blur();
  await expect(page.getByText(/saved just now/i)).toBeVisible({
    timeout: 15_000,
  });
}

async function openSection4(page: Page, slug: string) {
  await page.goto(`/camps/${slug}/registration`);
  await page
    .getByRole("button", { name: /Size & Logistics/i })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: /size & logistics/i })).toBeVisible();
}

const gate = (page: Page, label: RegExp) =>
  page.getByRole("group", { name: label });

test.describe("camp lead — registration safety (section 4)", () => {
  test("the gates complete section 4, persist, and No to fire clears the kinds; water is worked out", async ({
    webPage,
  }) => {
    test.setTimeout(180_000);
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Chai at dawn." });
    await startDraft(webPage, camp.slug);
    await openSection4(webPage, camp.slug);

    // No population or arrival yet: the rule, no number.
    const water = webPage.getByTestId("s4-water-estimate");
    await expect(water).toContainText(
      "Add your population and first arrival to see a rough estimate",
    );

    await webPage.getByLabel(/expected population/i).fill("45");
    await webPage.getByLabel(/first arrival date/i).fill("2027-04-24");
    await webPage.getByLabel(/camp area dimensions/i).fill("30m x 25m");
    // 45 people × 9 days (Sat 24 April – Sun 2 May) × 5 L.
    await expect(water).toContainText("About 2,025 L of water for the burn");
    await expect(water).toContainText("5 L a person a day × 45 people × 9 days");
    await expect(water).toContainText("not a water order");

    // Everything but the gates: still in progress.
    await expect(
      webPage.getByText("Required fields are marked with *."),
    ).toBeVisible();

    // The policies are plain links, opened in a new tab.
    const generatorPolicy = webPage.getByRole("link", { name: /generator policy/i });
    await expect(generatorPolicy).toHaveAttribute("target", "_blank");
    await expect(
      webPage.getByRole("link", { name: /theme camp safety checklist/i }),
    ).toBeVisible();

    // Fire yes reveals the kinds; the section needs one.
    await gate(webPage, /will you bring a generator/i)
      .getByRole("button", { name: "Yes", exact: true })
      .click();
    await gate(webPage, /will your camp have any fire/i)
      .getByRole("button", { name: "Yes", exact: true })
      .click();
    const kinds = gate(webPage, /which kinds of fire/i);
    await expect(kinds).toBeVisible();
    if (test.info().project.name === "mobile-360") {
      // 44 px touch targets at 360 (frame sSl0w): the gate's Yes/No and each
      // fire-kind row (the whole row is the checkbox's label).
      const yes = gate(webPage, /will you bring a generator/i).getByRole(
        "button",
        { name: "Yes", exact: true },
      );
      const row = kinds.locator("label", { hasText: "Braai or brazier (raised)" });
      expect((await yes.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await gate(webPage, /will you bring lpg gas or liquid fuel/i)
      .getByRole("button", { name: "Yes", exact: true })
      .click();
    // G3 = Yes links the optional record.
    await expect(webPage.getByTestId("s4-gas-fuel-card")).toContainText(
      "Not started",
    );
    await expect(
      webPage.getByText("Required fields are marked with *."),
    ).toBeVisible();
    await kinds
      .getByRole("checkbox", { name: "Braai or brazier (raised)", exact: true })
      .check();
    await expect(webPage.getByText("All required fields complete.")).toBeVisible();
    await expect(webPage.getByText(/saved just now/i)).toBeVisible({
      timeout: 15_000,
    });

    // Persisted on the server: a fresh load shows the same answers.
    await openSection4(webPage, camp.slug);
    await expect(
      gate(webPage, /will you bring a generator/i).getByRole("button", {
        name: "Yes",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      gate(webPage, /which kinds of fire/i).getByRole("checkbox", {
        name: "Braai or brazier (raised)",
        exact: true,
      }),
    ).toBeChecked();
    await expect(webPage.getByText("All required fields complete.")).toBeVisible();

    // No to fire hides the kinds, and they are cleared on the server.
    await gate(webPage, /will your camp have any fire/i)
      .getByRole("button", { name: "No", exact: true })
      .click();
    await expect(gate(webPage, /will your camp have any fire/i)).toBeVisible();
    await expect(gate(webPage, /which kinds of fire/i)).toHaveCount(0);
    await expect(webPage.getByText(/saved just now/i)).toBeVisible({
      timeout: 15_000,
    });
    await openSection4(webPage, camp.slug);
    await gate(webPage, /will your camp have any fire/i)
      .getByRole("button", { name: "Yes", exact: true })
      .click();
    // The kinds come back EMPTY: "No" cleared them, so the section is
    // incomplete again until one is ticked.
    await expect(gate(webPage, /which kinds of fire/i)).toBeVisible();
    await expect(
      gate(webPage, /which kinds of fire/i).getByRole("checkbox", {
        name: "Braai or brazier (raised)",
        exact: true,
      }),
    ).not.toBeChecked();
    await expect(
      webPage.getByText("Required fields are marked with *."),
    ).toBeVisible();
  });

  test("the gas & fuel record: over the limit tells the leads once; members read it; the tile and section 4 agree", async ({
    webPage,
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Chai at dawn." });
    await startDraft(webPage, camp.slug);

    // The plain member joins BEFORE the save that sends the notice, so "never
    // told" is tested against a notice that was actually sent while they were
    // in the camp. (Joining afterwards made the check unable to fail.)
    const { url } = await inviteToCamp(webPage, camp.slug);
    const member = await makeAppPage("web");
    await signUpBurner(member, { onboard: true });
    await joinByInvite(member, url);

    // Never public: a signed-in burner who is not a member gets not-found.
    const stranger = await makeAppPage("web");
    await signUpBurner(stranger, { onboard: true });
    await expectServerNotFound(stranger, `/camps/${camp.slug}/gas-fuel`, [
      "Gas & fuel record",
    ]);

    // A first-time camp gets the empty form: no offer, no notice.
    await webPage.goto(`/camps/${camp.slug}/gas-fuel`);
    await expect(
      webPage.getByRole("heading", { name: /gas & fuel record/i }),
    ).toBeVisible();
    await expect(webPage.getByRole("button", { name: "Save record" })).toBeVisible();
    await expect(webPage.getByTestId("gas-fuel-empty-hint")).toHaveText(
      "Nothing is saved until you press Save record. No fuel depot notice.",
    );
    await expect(webPage.getByTestId("gas-fuel-carry-offer")).toHaveCount(0);
    await expect(webPage.getByTestId("gas-fuel-depot-notice")).toHaveCount(0);

    // 2 × 48 kg (96 kg > 90 kg) and a 200 L barrel.
    await webPage.getByRole("combobox", { name: "Bottle size" }).click();
    await webPage.getByRole("option", { name: "48 kg", exact: true }).click();
    await webPage.getByLabel("How many").fill("2");
    await expect(webPage.getByTestId("gas-fuel-total")).toHaveText(
      "Total: 96 kg of gas",
    );
    await webPage.getByLabel("200 L barrels").fill("1");
    await webPage
      .getByLabel("Anything your wrangler should know")
      .fill("The diesel barrel is for the generator.");
    await webPage.getByRole("button", { name: "Save record" }).click();

    const notice = webPage.getByTestId("gas-fuel-depot-notice");
    await expect(notice).toContainText("This goes to the fuel depot");
    await expect(notice).toContainText("96 kg of gas is over 90 kg");
    await expect(notice).toContainText("they'll be told when one is assigned");
    await expect(notice).toContainText("at most 100 kg of gas per camp");
    await expect(webPage.getByTestId("gas-fuel-empty-hint")).toHaveCount(0);

    // The lead is told, in-app, once, with no amounts.
    const DEPOT_TITLE =
      "Your gas and fuel go to the fuel depot — your wrangler will be told when one is assigned";
    await webPage.goto("/notifications");
    await expect(
      webPage.getByRole("heading", { level: 1, name: "Notifications" }),
    ).toBeVisible();
    await expect(webPage.getByText(DEPOT_TITLE).filter({ visible: true })).toHaveCount(1);

    // A second save still over the limit sends nothing more.
    await webPage.goto(`/camps/${camp.slug}/gas-fuel`);
    await webPage.getByLabel("20 L jerry cans").fill("1");
    await webPage.getByRole("button", { name: "Save record" }).click();
    await expect(webPage.getByText("Gas & fuel record saved.").first()).toBeVisible();
    await webPage.goto("/notifications");
    await expect(
      webPage.getByRole("heading", { level: 1, name: "Notifications" }),
    ).toBeVisible();
    await expect(webPage.getByText(DEPOT_TITLE).filter({ visible: true })).toHaveCount(1);

    // Section 4 reads the saved record and says the depot line.
    await openSection4(webPage, camp.slug);
    await gate(webPage, /will you bring lpg gas or liquid fuel/i)
      .getByRole("button", { name: "Yes", exact: true })
      .click();
    // The card's short line (frame GFtHX state 5).
    await expect(webPage.getByTestId("s4-gas-fuel-card")).toContainText(
      "Saved · 96 kg of gas · 1 × 20 L · 1 × 200 L barrel",
    );
    await expect(webPage.getByTestId("s4-depot-line")).toContainText(
      "Over the fuel depot limit",
    );

    // The dashboard tile: saved summary, the rough water guide, the depot.
    await webPage.goto(`/camps/${camp.slug}`);
    const tile = webPage.getByTestId("gas-fuel-tile");
    await expect(tile).toContainText("Gas & fuel record");
    await expect(tile).toContainText("Saved · 2 × 48 kg gas (96 kg)");
    await expect(tile).toContainText("Goes to the fuel depot");
    await expect(
      webPage.getByText("Water, ice & gas orders").filter({ visible: true }),
    ).toBeVisible();

    // A plain member reads it, read-only, and is never told.
    await member.goto(`/camps/${camp.slug}/gas-fuel`);
    const readOnly = member.getByTestId("gas-fuel-read-only");
    await expect(readOnly).toContainText(
      "Only leads, co-leads and whoever plans the layout can change this.",
    );
    await expect(readOnly).toContainText("2 × 48 kg · 96 kg");
    await expect(readOnly).toContainText("The diesel barrel is for the generator.");
    await expect(member.getByRole("button", { name: "Save record" })).toHaveCount(0);
    await member.goto("/notifications");
    await expect(
      member.getByRole("heading", { level: 1, name: "Notifications" }),
    ).toBeVisible();
    await expect(member.getByText(DEPOT_TITLE)).toHaveCount(0);

    // Back within the limits: the notice goes, and nothing is sent.
    await webPage.goto(`/camps/${camp.slug}/gas-fuel`);
    await webPage.getByLabel("How many").fill("1");
    await webPage.getByLabel("200 L barrels").fill("0");
    await webPage.getByRole("button", { name: "Save record" }).click();
    await expect(webPage.getByTestId("gas-fuel-within-limits")).toBeVisible();
    await expect(webPage.getByTestId("gas-fuel-depot-notice")).toHaveCount(0);
  });

  test("the extinguishers card follows the drawn plan, in the editor and the 360 view", async ({
    webPage,
  }) => {
    test.setTimeout(180_000);
    const mobile = test.info().project.name === "mobile-360";
    // Drawing needs 768 px: on the 360 project the plan is drawn wide, then
    // the view-only 360 card is checked at 360 below.
    if (mobile) await webPage.setViewportSize({ width: 1280, height: 900 });
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Shade." });
    await startDraft(webPage, camp.slug);

    await webPage.goto(`/camps/${camp.slug}/layout`);
    await webPage.getByLabel("Width", { exact: true }).fill("40");
    await webPage.getByLabel("Depth", { exact: true }).fill("30");
    await webPage.getByRole("button", { name: "Create the plot" }).click();
    await expect(
      webPage.getByRole("heading", { name: "Add to the plan" }),
    ).toBeVisible();

    // The page also holds the 360 view-only plan (hidden here), with its own
    // card: the editor's is the visible one.
    const card = webPage
      .getByTestId("extinguishers-card")
      .filter({ visible: true });
    await expect(card).toContainText("0 × 4.5 kg DCP");
    // A 12 × 8 m Bedouin is 96 m²: one started 100 m², two extinguishers.
    await webPage.getByRole("button", { name: /^Add Bedouin,/ }).click();
    await expect(card.getByTestId("extinguishers-total")).toHaveText(
      "2 × 4.5 kg DCP",
    );
    await expect(card).toContainText("Worked out as you draw.");
    await expect(card).not.toContainText(/sand/i);
    await expect(webPage.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Section 4 shows the same count from the live layout.
    await openSection4(webPage, camp.slug);
    await expect(webPage.getByTestId("s4-extinguishers")).toContainText(
      "Have 2 fire extinguishers",
    );
    await answerSafetyGates(webPage);

    // At 360 the layout page is the view-only plan, with its own card.
    await webPage.setViewportSize({ width: 360, height: 780 });
    await webPage.goto(`/camps/${camp.slug}/layout`);
    const viewCard = webPage
      .getByTestId("extinguishers-card")
      .filter({ visible: true });
    await expect(viewCard).toContainText("2 × 4.5 kg DCP");
    await expect(viewCard).toContainText("Worked out from the plan.");
    await expect(viewCard).not.toContainText(/sand/i);
  });

  test("submit opens with section 4's gates still unanswered", async ({
    webPage,
  }) => {
    // The gates are Form 2: never required for submit (registration-safety-
    // spec; frame GFtHX). The wizard used to hold Submit for all six sections.
    test.setTimeout(180_000);
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Chai at dawn." });
    await submitRegistration(webPage, camp.slug, {
      skipSafetyGates: true,
      beforeSubmit: async (page) => {
        await expect(
          page.getByText(/5 of 6 sections complete/i).filter({ visible: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: /submit registration/i }),
        ).toBeEnabled();
        await expect(page.getByText(/submit opens once/i)).toHaveCount(0);
      },
    });
  });
});
