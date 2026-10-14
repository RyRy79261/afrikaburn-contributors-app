// specs/camp-lead/camp-layout-view.spec.ts
//
// Persona: CAMP LEAD (+ a member, + a stranger, + AfrikaBurn's reviewer) —
// the read-only camp layout (docs/camp-layout-spec.md; frame L3 QZeG7 /
// t7aOZ3): the camp-page tile in its three states, the members' plan with
// its object list, a covered area opened, Download PNG, the print page, the
// phone's view-only page, and the org console's pinned snapshot.
//
// THE RULE UNDER TEST EVERYWHERE: warnings are for the camp's editors only.
// Every layout here has a Kitchen two metres off the plot, which the editor
// warns about; the member's plan, the print page and the console snapshot
// must not say so. Each absence is asserted AFTER something on the same
// surface is asserted present, so an unrendered page cannot pass it.
//
// Selector provenance (verified against source on 2026-10-14):
//   tile ............ apps/web/components/layout-view/layout-tile.tsx
//   read-only ....... apps/web/components/layout-view/layout-read-only.tsx
//   object list ..... apps/web/components/layout-view/layout-object-list.tsx
//   plan (svg) ...... packages/ui/src/components/layout-plan.tsx
//   print ........... apps/web/app/(app)/camps/[slug]/layout/print/page.tsx
//   console ......... apps/org/components/registration/layout-snapshot.tsx

import { test, expect, skipUnlessGod } from "../../fixtures";
import type { Page } from "@playwright/test";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
  submitRegistration,
  elevateToGod,
} from "../../personas/factories";
import { expectServerNotFound } from "../camp-member/support";
import { openRegistrationInConsole } from "./support";

const WARNING_TEXT = /outside the plot|overlaps|warning/i;

async function expectSaved(page: Page) {
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

function layoutTile(page: Page) {
  return page.getByTestId("layout-tile");
}

/** A registration DRAFT: the wizard's autosave creates the row a layout
 * belongs to. */
async function startRegistrationDraft(page: Page, slug: string) {
  await page.goto(`/camps/${slug}/registration`);
  await page
    .getByLabel(/camp description/i)
    .fill("A dusty tea house on the Tankwa, gifting chai at dawn.");
  await expect(page.getByText(/saved just now/i)).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * In the editor (which needs 768 px): a 40 × 30 m plot, a Bedouin with one
 * tent under it, and a Kitchen 2 m off the plot — the editor warns about it.
 */
async function drawLayout(page: Page, slug: string) {
  await page.goto(`/camps/${slug}/layout`);
  await page.getByLabel("Width", { exact: true }).fill("40");
  await page.getByLabel("Depth", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Create the plot" }).click();
  await expect(page.getByRole("heading", { name: "Add to the plan" })).toBeVisible();

  await page.getByRole("button", { name: /^Add Bedouin,/ }).click();
  await page.getByRole("button", { name: "Open inside" }).click();
  await page.getByRole("button", { name: /^Add Tent · 2 person,/ }).click();
  await expect(page.getByText(/^1 tent · /)).toBeVisible();
  await page.getByRole("button", { name: "Back to whole camp" }).click();

  await page.getByRole("button", { name: /^Add Kitchen,/ }).click();
  const x = page.getByLabel("Centre X", { exact: true });
  await x.fill("1");
  await x.press("Enter");
  // The editor DOES warn — the premise of every absence below.
  await expect(
    page
      .getByRole("region", { name: /warnings/i })
      .getByRole("button", { name: /Kitchen 1 is 2\.0 m outside the plot/ }),
  ).toBeVisible();
  await expectSaved(page);
}

test.describe("camp layout — the read-only plan", () => {
  test("tile states, the member's plan, a covered area, PNG and print", async ({
    webPage,
    makeAppPage,
  }) => {
    test.skip(
      test.info().project.name === "mobile-360",
      "Drawing needs 768 px; the 360 test below covers the phone.",
    );
    test.setTimeout(300_000);

    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Shade and chai." });

    // Tile 3: no registration yet — the lead is sent to start one.
    await webPage.goto(`/camps/${camp.slug}`);
    await expect(layoutTile(webPage)).toContainText("Needs a registration");
    await expect(
      layoutTile(webPage).getByRole("link", { name: /start your registration/i }),
    ).toBeVisible();

    // Tile 2: a registration, no plan.
    await startRegistrationDraft(webPage, camp.slug);
    await webPage.goto(`/camps/${camp.slug}`);
    await expect(layoutTile(webPage)).toContainText("Not drawn yet");
    await expect(
      layoutTile(webPage).getByRole("link", { name: /draw the layout/i }),
    ).toBeVisible();

    // Tile 1: a plan.
    await drawLayout(webPage, camp.slug);
    await webPage.goto(`/camps/${camp.slug}`);
    await expect(layoutTile(webPage)).toContainText("Members only");
    await expect(layoutTile(webPage)).toContainText(
      /Plot 40 m × 30 m · 3 objects · last edited today, \d\d:\d\d/,
    );
    await expect(
      layoutTile(webPage).getByRole("img", { name: "The camp's plan, small" }),
    ).toBeVisible();

    // A plain member.
    const invite = await inviteToCamp(webPage, camp.slug);
    const member = await makeAppPage("web");
    await signUpBurner(member, { onboard: true });
    await joinByInvite(member, invite.url);

    await member.goto(`/camps/${camp.slug}`);
    await expect(layoutTile(member)).toContainText("Members only");
    await layoutTile(member).getByRole("link", { name: /open plan/i }).click();
    await expect(member).toHaveURL(new RegExp(`/camps/${camp.slug}/layout$`));

    // The plan, drawn, with its list — and no warning anywhere on it.
    await expect(member.getByText(/read-only/i).first()).toBeVisible();
    const plan = member.getByRole("img", {
      name: "The whole camp, drawn to scale",
    });
    await expect(plan).toBeVisible();
    await expect(plan).toContainText("Kitchen 1");
    await expect(member.getByText("Plot 40 m × 30 m · 1,200 m²")).toBeVisible();
    const list = member.getByRole("list", { name: "Objects on the plan" });
    await expect(list).toContainText("Bedouin 1");
    await expect(list).toContainText("1 tent inside");
    await expect(list).toContainText("Kitchen 1");
    await expect(member.getByText("3 objects", { exact: true })).toBeVisible();
    await expect(member.getByText(WARNING_TEXT)).toHaveCount(0);
    await expect(member.locator("canvas")).toHaveCount(0);
    await expect(member.getByRole("heading", { name: "Add to the plan" })).toHaveCount(0);

    // Download PNG — made in the browser, from the plan's own SVG.
    const [download] = await Promise.all([
      member.waitForEvent("download"),
      member.getByRole("button", { name: "Download PNG" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^${camp.slug}-layout-\\d{4}\\.png$`),
    );

    // A covered area, opened from the list.
    await list.getByRole("link", { name: /Bedouin 1/ }).click();
    await expect(member).toHaveURL(/\/layout\?area=[0-9a-f-]{36}$/);
    const crumbs = member.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs).toContainText("Whole camp");
    await expect(crumbs).toContainText("Bedouin 1");
    await expect(member.getByText(/^Covered 12 m × 8 m/)).toBeVisible();
    await expect(
      member.getByRole("list", { name: "Objects on the plan" }),
    ).toContainText("Tent 1");
    // An id that is not a covered area of THIS camp is not found.
    await expectServerNotFound(
      member,
      `/camps/${camp.slug}/layout?area=00000000-0000-4000-8000-000000000000`,
      [camp.name],
    );

    // The print page: the plan, a legend, every object, the covered area.
    await member.goto(`/camps/${camp.slug}/layout/print`);
    await expect(
      member.getByRole("heading", { level: 1, name: `${camp.name} — camp layout` }),
    ).toBeVisible();
    await expect(member.getByRole("heading", { name: "Legend" })).toBeVisible();
    await expect(member.getByRole("heading", { name: "Bedouin 1 — inside" })).toBeVisible();
    await expect(member.getByRole("cell", { name: "Kitchen 1" })).toBeVisible();
    await expect(member.getByText(WARNING_TEXT)).toHaveCount(0);
    await expect(member.getByRole("button", { name: "Print" })).toBeVisible();

    // A stranger: the camp's not-found, on the plan and on the print page.
    const stranger = await makeAppPage("web");
    await signUpBurner(stranger, { onboard: true });
    await expectServerNotFound(stranger, `/camps/${camp.slug}/layout/print`, [
      camp.name,
    ]);
  });

  test("at 360 the plan is view-only, with pinch-zoom and a folded list", async ({
    webPage,
  }) => {
    test.skip(test.info().project.name !== "mobile-360", "Phone layout only.");
    test.setTimeout(240_000);

    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Shade and chai." });
    await startRegistrationDraft(webPage, camp.slug);

    // A phone does not start a plan either (frame t7aOZ3 state 4).
    await webPage.goto(`/camps/${camp.slug}/layout`);
    await expect(
      webPage.getByText(/on a tablet or computer/i).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      webPage.getByRole("button", { name: "Create the plot" }),
    ).toBeHidden();

    // Draw on a wide screen, then come back to the phone.
    const phone = webPage.viewportSize()!;
    await webPage.setViewportSize({ width: 1280, height: 900 });
    await drawLayout(webPage, camp.slug);
    await webPage.setViewportSize(phone);
    await webPage.goto(`/camps/${camp.slug}/layout`);

    await expect(webPage.getByText(/editing needs a tablet or computer/i)).toBeVisible();
    const plan = webPage.getByRole("img", {
      name: "The whole camp, drawn to scale",
    });
    await expect(plan).toBeVisible();
    await expect(webPage.getByText("Pinch to zoom, drag to pan")).toBeVisible();
    await expect(webPage.getByText(WARNING_TEXT)).toHaveCount(0);
    await expect(webPage.locator("canvas")).toHaveCount(0);

    // The object list starts folded on a phone, and opens.
    const list = webPage.getByRole("list", { name: "Objects on the plan" });
    await expect(list).toBeHidden();
    await webPage.getByText("3 objects", { exact: true }).click();
    await expect(list).toBeVisible();
    await expect(list).toContainText("Bedouin 1");

    await expect(webPage.getByRole("button", { name: "Download PNG" })).toBeVisible();
    await expect(webPage.getByRole("link", { name: "Print plan" })).toBeVisible();
  });
});

test.describe("camp layout — AfrikaBurn's copy", () => {
  test("the console shows the snapshot pinned at submit, under section 4, with no warnings", async ({
    webPage,
    orgPage,
  }) => {
    skipUnlessGod();
    test.skip(
      test.info().project.name === "mobile-360",
      "Drawing needs 768 px; the console's 360 view is the same SVG.",
    );
    test.setTimeout(300_000);

    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Shade and chai." });
    await startRegistrationDraft(webPage, camp.slug);
    await drawLayout(webPage, camp.slug);
    await submitRegistration(webPage, camp.slug);

    await elevateToGod(orgPage);
    await openRegistrationInConsole(orgPage, camp.name);
    await expect(orgPage.getByText("Plot (from the layout)")).toBeVisible();
    await expect(orgPage.getByText("40 m × 30 m · 1,200 m²")).toBeVisible();
    await expect(
      orgPage.getByText(/^Snapshot sent with the registration · /),
    ).toBeVisible();
    const plan = orgPage.getByRole("img", {
      name: "The camp's layout as sent with the registration, drawn to scale",
    });
    await expect(plan).toBeVisible();
    await expect(plan).toContainText("Kitchen 1");
    await expect(orgPage.getByText(/pinned when the camp submitted/i)).toBeVisible();
    const section = orgPage
      .locator("dl")
      .filter({ hasText: "Plot (from the layout)" });
    await expect(section).toContainText("Expected population");
    await expect(section.getByText(WARNING_TEXT)).toHaveCount(0);
  });
});
