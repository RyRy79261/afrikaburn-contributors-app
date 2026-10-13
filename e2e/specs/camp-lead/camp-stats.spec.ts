// specs/camp-lead/camp-stats.spec.ts
//
// Persona: CAMP LEAD — camp statistics (docs/camp-stats-spec.md, App Spec
// STATS-001..031 as scoped there).
//
//   1. The lead reaches the stats page from the camp page and from the
//      roster's "All statistics" link; it counts the member's plans and names
//      nobody. A plain member gets no link and the camp's ordinary not-found.
//   2. The member sees "Your participation" on the camp page; the lead sees the
//      member's participation block on their profile; the member sees no such
//      block on the lead's profile (a plain member is not a roster viewer).
//
// Selector provenance (verified against source on 2026-10-13):
//   stats page ........ apps/web/app/(app)/camps/[slug]/stats/page.tsx
//   sections .......... apps/web/components/stats/camp-stats-sections.tsx
//                       (data-testid stats-people / stats-build-strike / …)
//   participation ..... apps/web/components/stats/participation-summary.tsx
//                       (your-participation / member-participation)
//   roster card link .. apps/web/app/(app)/camps/[slug]/roster/page.tsx
//   plans card ........ apps/web/components/roster/my-logistics-card.tsx

import { type Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueUsername } from "../../lib/identity";
import { expectServerNotFound } from "../camp-member/support";

/** A camp member's user id, read off their profile link on the camp page. */
async function burnerIdFromCampPage(
  page: Page,
  slug: string,
  username: string,
): Promise<string> {
  await page.goto(`/camps/${slug}`);
  const link = page.getByRole("link", { name: username }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  const id = href?.match(/\/burners\/([0-9a-f-]{36})/i)?.[1];
  if (!id) throw new Error(`[camp-stats] no burner link for ${username}`);
  return id;
}

/** The member saves their own plans: joining build, arriving 24 April. */
async function saveBuildPlans(page: Page, slug: string): Promise<void> {
  await page.goto(`/camps/${slug}`);
  const card = page.getByTestId("my-logistics");
  await expect(card).toBeVisible();
  const save = card.getByRole("button", { name: /save plans/i });
  // Filled until React holds it (see roster-ops.spec.ts for why).
  await expect(async () => {
    await card.getByLabel("Arrival").fill("");
    await card.getByLabel("Arrival").fill("2027-04-24");
    await expect(save).toBeEnabled({ timeout: 2_000 });
    await expect(card.getByLabel("Arrival")).toHaveValue("2027-04-24");
  }).toPass({ timeout: 30_000 });
  await card.getByRole("switch", { name: "Joining build" }).click();
  await save.click();
  await expect(card.getByRole("status")).toHaveText("Saved.");
}

test.describe("camp lead — camp statistics", () => {
  test("the lead opens the stats page; it counts plans and names nobody; a member is refused", async ({
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const memberName = uniqueUsername("stats_ren");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, invite.url);
    await saveBuildPlans(memberPage, camp.slug);

    // From the camp page.
    await leadPage.goto(`/camps/${camp.slug}`);
    await leadPage.getByRole("link", { name: "Statistics" }).click();
    await expect(
      leadPage.getByRole("heading", { name: "Camp statistics" }),
    ).toBeVisible();

    const people = leadPage.getByTestId("stats-people");
    await expect(people).toContainText("Current members");
    await expect(people).toContainText("2");
    const build = leadPage.getByTestId("stats-build-strike");
    // One joining build (the member); the lead set no plans.
    await expect(build.getByText("Joining build")).toBeVisible();
    await expect(build).toContainText("1 of the 2 members have set");
    await expect(
      build.getByRole("list", { name: "Arrivals per day" }),
    ).toBeVisible();
    // Bios are always shown; no onboarding, shifts or passes yet, so those
    // sections are not rendered (asserted after something present above).
    await expect(leadPage.getByTestId("stats-bios")).toBeVisible();
    await expect(leadPage.getByTestId("stats-onboarding")).toHaveCount(0);
    await expect(leadPage.getByTestId("stats-shifts")).toHaveCount(0);
    await expect(leadPage.getByTestId("stats-passes")).toHaveCount(0);
    // Counts only: the member is never named on the page.
    await expect(leadPage.getByText(memberName)).toHaveCount(0);

    // From the roster's stats card.
    await leadPage.goto(`/camps/${camp.slug}/roster`);
    await expect(
      leadPage.getByRole("heading", { name: "Roster" }),
    ).toBeVisible();
    await leadPage
      .getByTestId("camp-stats")
      .getByRole("link", { name: /all statistics/i })
      .click();
    await expect(
      leadPage.getByRole("heading", { name: "Camp statistics" }),
    ).toBeVisible();

    // A plain member: no link, and the camp's ordinary not-found.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(
      memberPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("link", { name: "Statistics" }),
    ).toHaveCount(0);
    await expectServerNotFound(memberPage, `/camps/${camp.slug}/stats`, [
      "Camp statistics",
    ]);
  });

  test("participation: the member sees their own, the lead sees the member's, the member never sees the lead's", async ({
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const leadName = uniqueUsername("stats_alice");
    const memberName = uniqueUsername("stats_jabu");

    await signUpBurner(leadPage, { onboard: true, username: leadName });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, invite.url);
    await saveBuildPlans(memberPage, camp.slug);

    // The member's own card, under Your plans.
    await memberPage.goto(`/camps/${camp.slug}`);
    const own = memberPage.getByTestId("your-participation");
    await expect(own).toBeVisible();
    await expect(own).toContainText("Your participation");
    await expect(own).toContainText("Joining build");
    await expect(own).toContainText("Held means a spot on a shift");
    // The lead's camp page has their own card, never the member's.
    await leadPage.goto(`/camps/${camp.slug}`);
    await expect(leadPage.getByTestId("your-participation")).toBeVisible();
    await expect(leadPage.getByTestId("your-participation")).not.toContainText(
      "Joining build",
    );

    // The lead on the member's profile: the participation block.
    const memberId = await burnerIdFromCampPage(
      leadPage,
      camp.slug,
      memberName,
    );
    await leadPage.goto(`/burners/${memberId}`);
    await expect(
      leadPage.getByRole("heading", { name: memberName }),
    ).toBeVisible();
    const block = leadPage.getByTestId("member-participation");
    await expect(block).toContainText(`Participation at ${camp.name}`);
    await expect(block).toContainText("Joining build");

    // The member on the lead's profile: no block (not a roster viewer).
    const leadId = await burnerIdFromCampPage(memberPage, camp.slug, leadName);
    await memberPage.goto(`/burners/${leadId}`);
    await expect(
      memberPage.getByRole("heading", { name: leadName }),
    ).toBeVisible();
    await expect(memberPage.getByTestId("member-participation")).toHaveCount(0);
  });
});
