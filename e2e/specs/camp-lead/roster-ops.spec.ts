// specs/camp-lead/roster-ops.spec.ts
//
// Persona: CAMP LEAD — roster operations (epic #55, App Spec CDB-011..014,
// CDB-030..033, STATS-017..019, STATS-022).
//
//   1. The lead filters the roster by bio completion and sees the camp's
//      aggregate stats; a plain member is refused the roster page outright.
//   2. A member sets their OWN arrival date and build attendance from the camp
//      page, and the lead then sees them on the roster.
//   3. The lead's CSV export downloads, carries the member's plans, and has no
//      phone number and no medical note in it — and the same URL is a 404 for
//      the member.
//
// Selector provenance (verified against source on 2026-09-27):
//   roster page ...... apps/web/app/(app)/camps/[slug]/roster/page.tsx
//   filters .......... apps/web/components/roster/roster-filters.tsx
//   table ............ apps/web/components/roster/roster-table.tsx
//                      (ResponsiveDataTable renders BOTH a <table> and a card
//                      list; only one is visible per viewport, hence every
//                      row locator is `.filter({ visible: true })`)
//   plans card ....... apps/web/components/roster/my-logistics-card.tsx
//   export route ..... apps/web/app/(app)/camps/[slug]/roster/export/route.ts

import { readFile } from "node:fs/promises";
import { test, expect } from "../../fixtures";
import type { Locator, Page } from "@playwright/test";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueUsername } from "../../lib/identity";
import { completeBioWithPhone } from "./support";
import {
  expectServerNotFound,
  setHardLockedBioData,
} from "../camp-member/support";

/** A member's visible roster row — the <tr> on desktop, the card on mobile. */
function rosterRow(page: Page, name: string): Locator {
  return page
    .locator("tr, li")
    .filter({ hasText: name })
    .filter({ visible: true });
}

async function gotoRoster(page: Page, slug: string, query = ""): Promise<void> {
  await page.goto(`/camps/${slug}/roster${query}`);
  // Something PRESENT first (README §"Selector traps"): the page's own heading.
  await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
}

test.describe("camp lead — roster operations", () => {
  test("the lead filters the roster by bio completion and sees aggregate stats; a member is refused", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const memberName = uniqueUsername("roster_ren");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, invite.url);

    // The lead reaches the roster from the camp page.
    await leadPage.goto(`/camps/${camp.slug}`);
    await leadPage.getByRole("link", { name: /roster & plans/i }).click();
    await expect(
      leadPage.getByRole("heading", { name: "Roster" }),
    ).toBeVisible();

    // Aggregates only: two members, both bios complete (both onboarded).
    const stats = leadPage.getByTestId("camp-stats");
    await expect(stats).toBeVisible();
    await expect(stats).toContainText("Members");
    await expect(stats).toContainText("2 / 2");
    // A per-person breakdown never reaches the card.
    await expect(stats).not.toContainText(memberName);

    // Bio complete → the member is listed. (A single-select Radix ToggleGroup
    // renders its items as radios.)
    await leadPage
      .getByRole("radio", { name: "Bio complete", exact: true })
      .click();
    await expect(leadPage).toHaveURL(/bio=complete/);
    await expect(rosterRow(leadPage, memberName)).toBeVisible();

    // Bio NOT complete → nobody (the empty state is asserted PRESENT before
    // the member is asserted absent).
    await gotoRoster(leadPage, camp.slug, "?bio=incomplete");
    await expect(leadPage.getByText("Nobody matches")).toBeVisible();
    await expect(rosterRow(leadPage, memberName)).toHaveCount(0);
    // The stats describe the camp, not the filter.
    await expect(leadPage.getByTestId("camp-stats")).toContainText("2 / 2");

    // Search by burner name narrows to the member.
    await gotoRoster(
      leadPage,
      camp.slug,
      `?q=${encodeURIComponent(memberName)}`,
    );
    await expect(rosterRow(leadPage, memberName)).toBeVisible();
    await expect(leadPage.getByText(/showing 1 of 2/i)).toBeVisible();

    // A plain member holds no view_member_details: no link, and the page is
    // the same not-found as a camp that does not exist.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(
      memberPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("link", { name: /roster & plans/i }),
    ).toHaveCount(0);
    await expectServerNotFound(memberPage, `/camps/${camp.slug}/roster`, [
      "Camp at a glance",
    ]);
  });

  test("a member sets their own arrival and build; the lead sees it on the roster", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const memberName = uniqueUsername("plans_ren");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, invite.url);

    // The member's own plans card on the camp page. Dates inside the seeded
    // edition's window (AfrikaBurn 2027 · 26 April – 2 May 2027).
    await memberPage.goto(`/camps/${camp.slug}`);
    const card = memberPage.getByTestId("my-logistics");
    await expect(card).toBeVisible();

    // A departure before the arrival is refused with a human message.
    // FILLED UNTIL REACT HOLDS IT. The card is server-rendered; typed into
    // before hydration, the controlled inputs are reset when React attaches —
    // seen on mobile-360 locally, where Arrival came back blank and a
    // departure-only save "succeeded". "Save plans" enables only once React's
    // state carries the edit, so an enabled button proves the values stuck.
    const save = card.getByRole("button", { name: /save plans/i });
    await expect(async () => {
      await card.getByLabel("Arrival").fill("2027-04-24");
      await card.getByLabel("Departure").fill("2027-04-23");
      await expect(save).toBeEnabled({ timeout: 2_000 });
      await expect(card.getByLabel("Arrival")).toHaveValue("2027-04-24");
    }).toPass({ timeout: 30_000 });
    await save.click();
    await expect(
      card.getByText(/can't leave before you arrive/i),
    ).toBeVisible();

    await card.getByLabel("Departure").fill("2027-05-03");
    await card.getByRole("switch", { name: "Joining build" }).click();
    await save.click();
    await expect(card.getByRole("status")).toHaveText("Saved.");

    // It survives a reload (a real write, not client state).
    await memberPage.reload();
    await expect(
      memberPage.getByTestId("my-logistics").getByLabel("Arrival"),
    ).toHaveValue("2027-04-24");

    // The lead sees the plans on the roster.
    await gotoRoster(leadPage, camp.slug);
    const row = rosterRow(leadPage, memberName);
    await expect(row).toBeVisible();
    await expect(row).toContainText("24 Apr");
    await expect(row).toContainText("3 May");
    await expect(row).toContainText("Yes");
  });

  test("the export downloads a CSV with the member's plans and no phone or medical note", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const memberName = uniqueUsername("export_ren");
    const phone = "+27825550163";
    const medicalNotes = `Sentinel medical ${memberName}`;

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    // The member HAS a phone and a medical note — so their absence from the
    // file is the projection's doing, not an empty bio's.
    await signUpBurner(memberPage);
    await completeBioWithPhone(memberPage, { username: memberName, phone });
    await setHardLockedBioData(memberPage, {
      onsiteContactName: `Onsite ${memberName}`,
      medicalNotes,
    });
    await joinByInvite(memberPage, invite.url);

    await memberPage.goto(`/camps/${camp.slug}`);
    const card = memberPage.getByTestId("my-logistics");
    // Filled until React holds it — see the hydration note in the test above.
    const save = card.getByRole("button", { name: /save plans/i });
    await expect(async () => {
      await card.getByLabel("Arrival").fill("2027-04-25");
      await expect(save).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await card.getByRole("switch", { name: "Joining strike" }).click();
    await save.click();
    await expect(card.getByRole("status")).toHaveText("Saved.");

    await gotoRoster(leadPage, camp.slug);
    const [download] = await Promise.all([
      leadPage.waitForEvent("download"),
      leadPage.getByRole("link", { name: /export csv/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^${camp.slug}-\\d{4}-roster-\\d{4}-\\d{2}-\\d{2}\\.csv$`),
    );
    const path = await download.path();
    const csv = await readFile(path, "utf8");

    expect(csv).toContain(
      "Name,Burner name,Roles,Arrival,Departure,Joining build,Joining strike",
    );
    const line = csv.split("\r\n").find((l) => l.startsWith(memberName));
    expect(line).toBe(`${memberName},${memberName},Member,2027-04-25,,No,Yes`);
    // Never a phone number, an emergency contact or a medical note.
    expect(csv).not.toContain("5550163");
    expect(csv).not.toContain(medicalNotes);
    expect(csv).not.toContain(`Onsite ${memberName}`);
    expect(csv).not.toMatch(/phone|medical/i);

    // The member asking for the same file gets the not-found answer.
    const refused = await memberPage.request.get(
      `/camps/${camp.slug}/roster/export`,
    );
    expect(refused.status()).toBe(404);
  });
});
