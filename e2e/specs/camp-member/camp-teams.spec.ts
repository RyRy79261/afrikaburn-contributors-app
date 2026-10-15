// specs/camp-member/camp-teams.spec.ts
//
// Persona: CAMP MEMBER (with their camp lead) — camp teams and team chat
// (docs/camp-teams-spec.md). The direct-message law extends to team chats:
// only the team's CURRENT members read its chat. Every refusal here is the
// SERVER's (@quagga/core `canReadTeamChat` via lib/messages-store), and each
// is paired with a positive control on the same chat:
//
//   · a member joins an open team, opens its chat and posts; the inbox lists
//     the chat as a TEAM row with the sender, never the text;
//   · a member of the SAME camp who is not on the team, and the camp's LEAD
//     who is not on it either, get the chat's URL as a not-found;
//   · a person a lead adds sees the chat from then on — the message sent
//     before they were added is not served to them;
//   · leaving the team takes the chat away.
//
// Selectors: components/teams/team-dialogs.tsx ("New team", "Join <team>",
// "Add people", "Add 1 person", "Leave", "Leave team"), team-form.tsx ("Team
// name", "Create team"), the team page's "Team chat" link, and
// components/messages/team-chat-thread.tsx (composer "Message <team>").

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

async function sendTeamMessage(
  page: Page,
  team: string,
  text: string,
): Promise<void> {
  const box = page.getByRole("textbox", { name: `Message ${team}` });
  await box.fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(text)).toBeVisible();
  await expect(box).toHaveValue("");
}

test.describe("camp member — camp teams and team chat", () => {
  test("only the team's current members read its chat — not the camp lead", async ({
    makeAppPage,
  }) => {
    test.setTimeout(360_000);
    const alicePage = await makeAppPage("web");
    const renPage = await makeAppPage("web");
    const jabuPage = await makeAppPage("web");

    const alice = uniqueUsername("alice_hatter");
    const ren = uniqueUsername("ren_notfound");
    const jabu = uniqueUsername("jabu");

    // ALICE leads the camp; REN and JABU join it.
    await signUpBurner(alicePage, { onboard: true, username: alice });
    const camp = await createCamp(alicePage, {
      name: uniqueName("Mad Hatters"),
    });
    const invite = await inviteToCamp(alicePage, camp.slug, "member");
    await signUpBurner(renPage, { onboard: true, username: ren });
    await joinByInvite(renPage, invite.url);
    const invite2 = await inviteToCamp(alicePage, camp.slug, "member");
    await signUpBurner(jabuPage, { onboard: true, username: jabu });
    await joinByInvite(jabuPage, invite2.url);

    // Alice makes an open team — she is not on it.
    const team = uniqueName("Kitchen").slice(0, 40);
    await alicePage.goto(`/camps/${camp.slug}/teams`);
    await expect(
      alicePage.getByRole("heading", { name: "Teams", exact: true }),
    ).toBeVisible();
    await alicePage.getByRole("button", { name: "New team" }).first().click();
    await alicePage.getByLabel("Team name").fill(team);
    await alicePage.getByRole("button", { name: "Create team" }).click();
    await alicePage.waitForURL(/\/teams\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const teamPath = new URL(alicePage.url()).pathname;
    await expect(alicePage.getByRole("heading", { name: team })).toBeVisible();

    // Ren joins from the list, opens the chat and posts.
    await renPage.goto(`/camps/${camp.slug}/teams`);
    await renPage.getByRole("button", { name: `Join ${team}` }).click();
    // The row turns to Joined once the server has seated Ren.
    await expect(
      renPage.getByRole("button", { name: `Join ${team}` }),
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(renPage.getByText("Joined", { exact: true })).toBeVisible();
    await renPage.goto(teamPath);
    const chatLink = renPage.getByRole("link", { name: "Team chat" });
    await expect(chatLink).toBeVisible({ timeout: 15_000 });
    await chatLink.click();
    await renPage.waitForURL(/\/messages\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const chatPath = new URL(renPage.url()).pathname;
    const before = uniqueName("TEAMSENTINEL before Jabu");
    await sendTeamMessage(renPage, team, before);

    // REFUSAL: Jabu, same camp, not on the team. Positive control first —
    // the team page renders for him and lists Ren — then the chat 404s.
    await jabuPage.goto(teamPath);
    await expect(jabuPage.getByRole("heading", { name: team })).toBeVisible();
    await expect(jabuPage.getByText(ren).first()).toBeVisible();
    await expect(jabuPage.getByRole("link", { name: "Team chat" })).toHaveCount(
      0,
    );
    await expectServerNotFound(jabuPage, chatPath, [before]);

    // REFUSAL: the camp LEAD, not on the team, reads nothing either.
    await expectServerNotFound(alicePage, chatPath, [before]);

    // Alice adds Jabu: from now on he reads the chat — not the history.
    await alicePage.goto(teamPath);
    await alicePage.getByRole("button", { name: "Add people" }).click();
    await alicePage.getByRole("checkbox", { name: jabu }).check();
    await alicePage.getByRole("button", { name: "Add 1 person" }).click();
    await expect(alicePage.getByRole("dialog")).toHaveCount(0);
    await expect(
      alicePage.getByRole("heading", { name: "Members · 2" }),
    ).toBeVisible({ timeout: 15_000 });

    await jabuPage.goto(chatPath);
    await expect(
      jabuPage.getByRole("textbox", { name: `Message ${team}` }),
    ).toBeVisible();
    await expect(jabuPage.getByText(/You joined on/)).toBeVisible();
    await expect(jabuPage.getByText(before)).toHaveCount(0);
    const after = uniqueName("TEAMSENTINEL after Jabu");
    await sendTeamMessage(jabuPage, team, after);

    // Ren's inbox: a TEAM row, with the sender and never the text.
    await renPage.goto("/messages");
    await expect(
      renPage.getByRole("heading", { name: "Messages", exact: true }),
    ).toBeVisible();
    const row = renPage.getByRole("link", { name: new RegExp(team) });
    await expect(row).toContainText("Team");
    await expect(row).toContainText(`last from ${jabu}`);
    await expect(renPage.locator("body")).not.toContainText(after);

    // Ren leaves: the chat goes with it.
    await renPage.goto(teamPath);
    await renPage.getByRole("button", { name: "Leave", exact: true }).click();
    await renPage.getByRole("button", { name: "Leave team" }).click();
    await expect(
      renPage.getByRole("button", { name: `Join ${team}` }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expectServerNotFound(renPage, chatPath, [before, after]);
  });
});
