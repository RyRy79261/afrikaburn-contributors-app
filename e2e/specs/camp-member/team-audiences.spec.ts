// specs/camp-member/team-audiences.spec.ts
//
// Persona: CAMP MEMBER who LEADS a team (with the camp lead, a teammate and a
// member on no team) — team audiences for meetings and announcements
// (docs/team-audiences-spec.md). Every refusal is the SERVER's (@quagga/core
// `decideTeamAudienceTargets`, `canSendCampAnnouncement`, `canViewMeeting`);
// the picker only mirrors it. Each refusal has a positive control first.
//
//   1. The camp lead makes two teams: Kitchen (Ren leads it) and Sound (no
//      lead). Jabu joins Kitchen; Mia is on no team.
//   2. The team page shows "Post to the team" / "Schedule a team meeting" to
//      Ren, and not to Jabu.
//   3. Ren schedules a team meeting from the shortcut: the form opens on his
//      team, with no Whole camp / Chosen roles and the one-line reason. Jabu
//      sees the meeting; Mia gets the 404 an unknown meeting gets.
//   4. Ren is never offered Sound, even when the URL asks for it.
//   5. Ren posts to the team from the shortcut. Jabu gets it; Mia does not.
//   6. The camp lead, who may address any team, gets the full picker with
//      the asked-for team chosen.
//
// Selector provenance (verified against source on 2026-10-15):
//   team page ....... apps/web/app/(app)/camps/[slug]/teams/[id]/page.tsx
//   team dialogs .... apps/web/components/teams/{team-dialogs,team-form,
//                     people-picker}.tsx
//   meeting form .... apps/web/components/meetings/meeting-form.tsx
//   composer ........ apps/web/components/announcements/composer.tsx
//   reach / notice .. apps/web/lib/team-audience-view.ts

import { type Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { expectServerNotFound } from "./support";

/** As the camp lead, create a team (optionally with a lead) and return the
 * team page's path. */
async function createTeam(
  page: Page,
  slug: string,
  name: string,
  leadUsername?: string,
): Promise<string> {
  await page.goto(`/camps/${slug}/teams`);
  await expect(
    page.getByRole("heading", { name: "Teams", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New team" }).first().click();
  await page.getByLabel("Team name").fill(name);
  if (leadUsername) {
    await page.getByLabel("Choose camp members").fill(leadUsername);
    await page.getByRole("checkbox", { name: leadUsername }).check();
  }
  await page.getByRole("button", { name: "Create team" }).click();
  await page.waitForURL(/\/teams\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe("camp member — team audiences", () => {
  test("a team lead schedules and posts to their own team only", async ({
    makeAppPage,
  }) => {
    test.setTimeout(360_000);
    const alicePage = await makeAppPage("web");
    const renPage = await makeAppPage("web");
    const jabuPage = await makeAppPage("web");
    const miaPage = await makeAppPage("web");

    const ren = uniqueUsername("ren_notfound");
    const jabu = uniqueUsername("jabu");

    // ── 1. The camp, its people and two teams ────────────────────────────
    await signUpBurner(alicePage, { onboard: true });
    const camp = await createCamp(alicePage, {
      name: uniqueName("Mad Hatters"),
    });
    for (const [page, username] of [
      [renPage, ren],
      [jabuPage, jabu],
      [miaPage, uniqueUsername("mia_fourie")],
    ] as const) {
      const invite = await inviteToCamp(alicePage, camp.slug, "member");
      await signUpBurner(page, { onboard: true, username });
      await joinByInvite(page, invite.url);
    }

    const kitchen = uniqueName("Kitchen").slice(0, 40);
    const sound = uniqueName("Sound").slice(0, 40);
    const kitchenPath = await createTeam(alicePage, camp.slug, kitchen, ren);
    const soundPath = await createTeam(alicePage, camp.slug, sound);
    const soundId = soundPath.split("/").pop()!;

    await jabuPage.goto(`/camps/${camp.slug}/teams`);
    await jabuPage.getByRole("button", { name: `Join ${kitchen}` }).click();
    await expect(
      jabuPage.getByRole("button", { name: `Join ${kitchen}` }),
    ).toHaveCount(0, { timeout: 15_000 });

    // ── 2. The shortcuts: the team's lead, not its members ───────────────
    await jabuPage.goto(kitchenPath);
    await expect(
      jabuPage.getByRole("heading", { name: kitchen }),
    ).toBeVisible();
    await expect(jabuPage.getByText(ren).first()).toBeVisible();
    await expect(
      jabuPage.getByRole("link", { name: "Post to the team" }),
    ).toHaveCount(0);
    await expect(
      jabuPage.getByRole("link", { name: "Schedule a team meeting" }),
    ).toHaveCount(0);

    await renPage.goto(kitchenPath);
    await expect(renPage.getByRole("heading", { name: kitchen })).toBeVisible();
    await expect(
      renPage.getByRole("link", { name: "Post to the team" }),
    ).toBeVisible();

    // ── 3. A team meeting, from the shortcut ─────────────────────────────
    await renPage
      .getByRole("link", { name: "Schedule a team meeting" })
      .click();
    await expect(
      renPage.getByRole("heading", { name: "Schedule a meeting" }),
    ).toBeVisible();
    await expect(
      renPage.getByText(`You lead ${kitchen}, so you can schedule for it.`),
    ).toBeVisible();
    await expect(
      renPage.getByRole("button", { name: "Whole camp" }),
    ).toHaveCount(0);
    await expect(
      renPage.getByRole("button", { name: "Chosen roles" }),
    ).toHaveCount(0);
    await expect(
      renPage.getByRole("button", { name: kitchen }),
    ).toHaveAttribute("aria-pressed", "true");
    // Ren and Jabu on the team, plus Alice, the camp's lead. Not Mia.
    await expect(renPage.getByText(/shows to\s*3 members/i)).toBeVisible();

    const meetingTitle = uniqueName("Kitchen menu and shopping");
    await renPage.getByLabel("Title").fill(meetingTitle);
    await renPage.getByLabel("Date").fill("2027-04-07");
    await renPage.getByLabel("Start time").fill("18:30");
    await renPage.getByRole("button", { name: "Schedule meeting" }).click();
    await expect(
      renPage.getByRole("heading", { level: 1, name: meetingTitle }),
    ).toBeVisible();
    const meetingPath = new URL(renPage.url()).pathname;

    await jabuPage.goto(`/camps/${camp.slug}/meetings`);
    await expect(
      jabuPage.getByRole("heading", { level: 1, name: "Meetings" }),
    ).toBeVisible();
    const row = jabuPage
      .getByRole("listitem")
      .filter({ hasText: meetingTitle });
    await expect(row).toContainText(`${kitchen} team`, { ignoreCase: true });

    await expectServerNotFound(miaPage, meetingPath, [meetingTitle]);

    // ── 4. Never another team, even when the URL asks for it ─────────────
    await renPage.goto(`/camps/${camp.slug}/announcements/new?team=${soundId}`);
    await expect(
      renPage.getByRole("heading", { name: /new announcement/i }),
    ).toBeVisible();
    await expect(
      renPage.getByRole("button", { name: kitchen }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(renPage.getByRole("button", { name: sound })).toHaveCount(0);

    // ── 5. An announcement to the team, from the shortcut ────────────────
    await renPage.goto(kitchenPath);
    await renPage.getByRole("link", { name: "Post to the team" }).click();
    await expect(
      renPage.getByRole("heading", { name: /new announcement/i }),
    ).toBeVisible();
    await expect(
      renPage.getByText(`You lead ${kitchen}, so you can send to it.`),
    ).toBeVisible();
    await expect(
      renPage.getByRole("button", { name: /^everyone in this camp$/i }),
    ).toHaveCount(0);
    await expect(
      renPage.getByRole("button", { name: kitchen }),
    ).toHaveAttribute("aria-pressed", "true");
    // Must-acknowledge needs the privilege a team lead does not hold.
    await expect(
      renPage.getByRole("button", { name: /^must acknowledge/i }),
    ).toBeDisabled();

    const title = uniqueName("Monday prep starts at 10");
    const marker = `Bring an apron ${Date.now().toString(36)}`;
    await renPage.getByLabel(/^title/i).fill(title);
    await renPage
      .getByRole("textbox", { name: /announcement message/i })
      .click();
    await renPage.keyboard.type(marker);
    await renPage
      .getByRole("button", { name: /publish announcement/i })
      .click();
    await renPage.waitForURL(/\/announcements\/[0-9a-f-]{36}$/i);
    await expect(renPage.getByRole("heading", { name: title })).toBeVisible();

    await jabuPage.goto("/notifications");
    await expect(
      jabuPage.getByRole("heading", { name: /^notifications$/i }),
    ).toBeVisible();
    await expect(jabuPage.getByText(title)).toBeVisible();

    await miaPage.goto("/notifications");
    await expect(
      miaPage.getByRole("heading", { name: /^notifications$/i }),
    ).toBeVisible();
    // Present first: Mia was told about nothing else, so prove the page
    // painted by its heading, then that the title is absent.
    await expect(miaPage.getByText(title)).toHaveCount(0);

    // ── 6. The camp lead may address any team ───────────────────────────
    await alicePage.goto(
      `/camps/${camp.slug}/announcements/new?team=${soundId}`,
    );
    await expect(
      alicePage.getByRole("heading", { name: /new announcement/i }),
    ).toBeVisible();
    await expect(
      alicePage.getByRole("button", { name: /^by team$/i }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      alicePage.getByRole("button", { name: sound }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      alicePage.getByRole("button", { name: kitchen }),
    ).toHaveAttribute("aria-pressed", "false");
    await alicePage.getByRole("button", { name: kitchen }).click();
    // Ren and Jabu on Kitchen; nobody on Sound yet.
    await expect(
      alicePage.getByText(/reaches about\s*2 members/i),
    ).toBeVisible();
    await alicePage.goto(`/camps/${camp.slug}/announcements`);
    await expect(alicePage.getByText(title)).toBeVisible();
    await alicePage.goto(`/camps/${camp.slug}/meetings/new?team=${soundId}`);
    await expect(
      alicePage.getByRole("button", { name: "Teams", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await alicePage.getByRole("button", { name: kitchen }).click();
  });
});
