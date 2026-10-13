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
//   3. The numbers MOVE when the data moves: a member joins, a member sets
//      build plans, the lead adds a shift, a member fills its spot — each step
//      read back off the stats page against the figure before it.
//   4. Access beyond the lead: a member holding view_member_details (a custom
//      role with "Can see private member info") opens the page and sees a
//      member's participation block; another camp's lead gets the not-found and
//      no block; a signed-out visitor is sent to sign in. The camp is free
//      (never registered), so this is also the undiscoverability law.
//
// Selector provenance (verified against source on 2026-10-13):
//   stats page ........ apps/web/app/(app)/camps/[slug]/stats/page.tsx
//   sections .......... apps/web/components/stats/camp-stats-sections.tsx
//                       (data-testid stats-people / stats-build-strike / …)
//   participation ..... apps/web/components/stats/participation-summary.tsx
//                       (your-participation / member-participation)
//   roster card link .. apps/web/app/(app)/camps/[slug]/roster/page.tsx
//   plans card ........ apps/web/components/roster/my-logistics-card.tsx
//   stat tiles ........ apps/web/components/stats/stat-tile.tsx (<dl>: dt label,
//                       first dd the value)
//   shift form ........ apps/web/components/shifts/shift-form.tsx
//   custom roles ...... apps/web/components/roles/privileges.tsx

import { type Locator, type Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { expectServerNotFound } from "../camp-member/support";
import { assignRoleToMember, createCustomRole } from "./support";

/** The value of the stat tile labelled exactly `label` inside `section`. */
function tileValue(section: Locator, label: string): Locator {
  return section
    .locator("dl")
    .filter({
      has: section.page().locator("dt").getByText(label, { exact: true }),
    })
    .locator("dd")
    .first();
}

async function gotoStats(page: Page, slug: string): Promise<void> {
  await page.goto(`/camps/${slug}/stats`);
  await expect(
    page.getByRole("heading", { name: "Camp statistics" }),
  ).toBeVisible();
}

/** The lead creates a one-spot Tea bar shift on Thursday 29 April. */
async function createOneSpotShift(
  page: Page,
  slug: string,
  shiftName: string,
): Promise<void> {
  // Opening Shifts as a lead writes the starter team list (Tea bar is in it).
  await page.goto(`/camps/${slug}/shifts`);
  await expect(
    page.getByRole("heading", { name: "Shifts", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /new shift/i }).first().click();
  await expect(page.getByRole("heading", { name: "New shift" })).toBeVisible();
  await page.getByLabel(/shift name/i).fill(shiftName);
  await page.getByRole("radio", { name: "Tea bar" }).click();
  await page.getByRole("button", { name: "Fewer people" }).click();
  await expect(
    page.getByRole("textbox", { name: "How many people" }),
  ).toHaveValue("1");
  await page
    .getByRole("toolbar", { name: "Event days" })
    .getByRole("button", { name: "Thu 29" })
    .click();
  await expect(
    page.getByText(/makes 1 shift, thu 29 apr · 1 spot to fill/i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create shift" }).click();
  await expect(
    page.getByTestId("lead-shift-row").filter({ hasText: shiftName }),
  ).toBeVisible();
}

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
  test("the numbers move when the data moves: a member joins, sets build, fills a shift spot", async ({
    makeAppPage,
  }) => {
    test.setTimeout(300_000);
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const memberName = uniqueUsername("stats_lerato");
    const shiftName = uniqueName("Tea bar dawn");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);

    // ── Before: the lead alone, no plans, no shifts ──────────────────────
    await gotoStats(leadPage, camp.slug);
    const people = leadPage.getByTestId("stats-people");
    const build = leadPage.getByTestId("stats-build-strike");
    await expect(tileValue(people, "Current members")).toHaveText("1");
    await expect(tileValue(build, "Joining build")).toHaveText("0");
    await expect(tileValue(build, "Arrival not set")).toHaveText("1");
    await expect(
      build.getByRole("list", { name: "Arrivals per day" }),
    ).toHaveCount(0);
    await expect(leadPage.getByTestId("stats-shifts")).toHaveCount(0);

    // ── A member joins: current moves 1 → 2 ─────────────────────────────
    const invite = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, invite.url);

    await gotoStats(leadPage, camp.slug);
    await expect(tileValue(people, "Current members")).toHaveText("2");
    await expect(tileValue(build, "Joining build")).toHaveText("0");
    await expect(tileValue(build, "Arrival not set")).toHaveText("2");

    // ── The member sets build plans: joining build 0 → 1 ────────────────
    await saveBuildPlans(memberPage, camp.slug);

    await gotoStats(leadPage, camp.slug);
    await expect(tileValue(build, "Joining build")).toHaveText("1");
    await expect(tileValue(build, "Joining strike")).toHaveText("0");
    await expect(tileValue(build, "Arrival not set")).toHaveText("1");
    const arrivals = build
      .getByRole("list", { name: "Arrivals per day" })
      .getByRole("listitem");
    // 24 April is before the event opens on the 26th: a build-day arrival.
    await expect(arrivals).toHaveCount(1);
    await expect(arrivals.first()).toHaveAttribute(
      "aria-label",
      /build: 1 arrival$/,
    );

    // ── The lead adds a one-spot shift: the Shifts section appears ──────
    await createOneSpotShift(leadPage, camp.slug, shiftName);

    await gotoStats(leadPage, camp.slug);
    const shifts = leadPage.getByTestId("stats-shifts");
    await expect(shifts).toBeVisible();
    await expect(tileValue(shifts, "Spots filled")).toHaveText("0 of 1");
    await expect(tileValue(shifts, "Open spots")).toHaveText("1");
    const teaBar = shifts.getByRole("listitem").filter({ hasText: "Tea bar" });
    await expect(teaBar).toContainText("1 open");

    // ── The member fills the spot: 0 of 1 → 1 of 1, open 1 → 0 ─────────
    await memberPage.goto(`/camps/${camp.slug}/shifts`);
    await expect(
      memberPage.getByRole("heading", { name: "Shifts", exact: true }),
    ).toBeVisible();
    const open = memberPage
      .getByTestId("open-shift")
      .filter({ hasText: shiftName });
    await open.getByRole("button", { name: /sign up/i }).click();
    await expect(
      memberPage.getByTestId("my-shift").filter({ hasText: shiftName }),
    ).toBeVisible();

    await gotoStats(leadPage, camp.slug);
    await expect(tileValue(shifts, "Spots filled")).toHaveText("1 of 1");
    await expect(tileValue(shifts, "Spots filled").locator("..")).toContainText(
      "100% of spots",
    );
    await expect(tileValue(shifts, "Open spots")).toHaveText("0");
    await expect(teaBar).toContainText("Full");
    // Counts only — still nobody named, now that someone holds a shift.
    await expect(leadPage.getByText(memberName)).toHaveCount(0);

    // The member's own card: on a shift, but its day has not passed, so it
    // is not "held" yet (held is a past day, never a future one).
    await memberPage.goto(`/camps/${camp.slug}`);
    const own = memberPage.getByTestId("your-participation");
    await expect(own).toBeVisible();
    await expect(own).toContainText("Joining build");
    await expect(tileValue(own, "Shifts held")).toHaveText("0");
  });

  test("access: a member with view_member_details is let in; another camp's lead and a signed-out visitor are not", async ({
    makeAppPage,
  }) => {
    test.setTimeout(300_000);
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const viewerPage = await makeAppPage("web");
    const otherLeadPage = await makeAppPage("web");
    const memberName = uniqueUsername("stats_jabu");
    const viewerName = uniqueUsername("stats_ren");
    const roleName = uniqueName("Roster keeper");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    // One invite at a time (each is read off the newest code on the page).
    const inviteA = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, inviteA.url);
    await saveBuildPlans(memberPage, camp.slug);
    const inviteB = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(viewerPage, { onboard: true, username: viewerName });
    await joinByInvite(viewerPage, inviteB.url);

    // Before the role: the would-be viewer is a plain member and is refused.
    await viewerPage.goto(`/camps/${camp.slug}`);
    await expect(
      viewerPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();
    await expect(
      viewerPage.getByRole("link", { name: "Statistics" }),
    ).toHaveCount(0);
    await expectServerNotFound(viewerPage, `/camps/${camp.slug}/stats`, [
      "Camp statistics",
    ]);

    // The lead grants view_member_details through a custom role.
    await createCustomRole(leadPage, camp.slug, {
      name: roleName,
      emoji: "📋",
      colorLabel: "Teal",
      privileges: ["Can see private member info"],
    });
    await assignRoleToMember(leadPage, camp.slug, viewerName, roleName);

    // Now: the link, the page, and the same counts the lead sees.
    await viewerPage.goto(`/camps/${camp.slug}`);
    await viewerPage.getByRole("link", { name: "Statistics" }).click();
    await expect(
      viewerPage.getByRole("heading", { name: "Camp statistics" }),
    ).toBeVisible();
    const people = viewerPage.getByTestId("stats-people");
    await expect(tileValue(people, "Current members")).toHaveText("3");
    await expect(
      tileValue(viewerPage.getByTestId("stats-build-strike"), "Joining build"),
    ).toHaveText("1");

    // …and the member's participation block on their profile.
    const memberId = await burnerIdFromCampPage(
      leadPage,
      camp.slug,
      memberName,
    );
    await viewerPage.goto(`/burners/${memberId}`);
    await expect(
      viewerPage.getByRole("heading", { name: memberName }),
    ).toBeVisible();
    const block = viewerPage.getByTestId("member-participation");
    await expect(block).toContainText(`Participation at ${camp.name}`);
    await expect(block).toContainText("Joining build");

    // Another camp's lead: a roster viewer of THEIR camp, a stranger to this
    // one. The profile renders (it is the public view), but with no block.
    await signUpBurner(otherLeadPage, { onboard: true });
    await createCamp(otherLeadPage);
    await otherLeadPage.goto(`/burners/${memberId}`);
    await expect(
      otherLeadPage.getByRole("heading", { name: memberName }),
    ).toBeVisible();
    await expect(
      otherLeadPage.getByTestId("member-participation"),
    ).toHaveCount(0);
    await expect(otherLeadPage.getByText(camp.name)).toHaveCount(0);
    // The camp is free (never registered): its stats are the ordinary
    // not-found, naming nothing.
    await expectServerNotFound(otherLeadPage, `/camps/${camp.slug}/stats`, [
      camp.name,
      "Camp statistics",
    ]);

    // Signed out: sent to sign in, the page rendered, nothing named.
    const anon = await makeAppPage("web");
    await anon.goto(`/camps/${camp.slug}/stats`);
    await expect(anon).toHaveURL(/\/auth\/sign-in/);
    await expect(
      anon.getByRole("button", { name: /sign in/i }).first(),
    ).toBeVisible();
    await expect(anon.getByText(camp.name)).toHaveCount(0);
    await expect(anon.getByText("Camp statistics")).toHaveCount(0);
  });
});
