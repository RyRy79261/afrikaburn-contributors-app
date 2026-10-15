// specs/camp-member/camp-team-chat-rules.spec.ts
//
// Persona: CAMP MEMBER (with their camp lead) — the rules of camp teams and
// team chat (docs/camp-teams-spec.md) that camp-teams.spec.ts does not cover.
// Every refusal is the SERVER's (@quagga/core camp-teams.ts via
// lib/camp-teams-store and lib/messages-store) and each is paired with a
// positive control, so a guard is proven discriminating, not blanket-deny:
//
//   1. A camp lead makes an open team with a member as its team lead, and a
//      "leads add only" team. A member is offered Join on the open team and
//      not on the other (asserted against the same rendered list). Two members
//      chat both ways. Only a team lead is offered the timer: a plain member
//      is not until the camp lead makes them a team lead in Edit team. The
//      timer change posts a system line both see. A burner from outside the
//      camp gets the camp's not-found on the list, the team page and the chat.
//   2. A member who JOINS later sees none of the earlier messages. A block
//      between two members hides each one's later messages from the other,
//      while a third member sees both.
//   3. Reporting one team message sends that copy — and only it — to the
//      org safety queue (desktop only: the console is desktop-shaped, and it
//      needs the god account to provision staff).
//
// Selectors: components/teams/{team-dialogs,team-form,team-list}.tsx,
// components/messages/team-chat-thread.tsx ("Change", "Disappearing
// messages: <label>", "Report messages", "Select message from <name>: …",
// "Send report (n)"), components/messages/profile-message-actions.tsx
// ("Block <name>"), apps/org safety pages ("<reporter> reported <reported>").

import { type Page } from "@playwright/test";
import { test, expect, skipUnlessGod } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { provisionOrgStaff } from "../org-staff/_helpers";
import {
  burnerIdFromRoster,
  createTeam,
  expectServerNotFound,
  joinTeamFromPage,
  openTeamChat,
  sendTeamMessage,
} from "./support";

/**
 * The page does not scroll sideways. At 360 a page wider than the screen is
 * zoomed out by the phone, and on the team page that once put the Edit team
 * dialog's Save button off the visible screen (a lead's member rows, each a
 * 20-character handle with Lead and Remove, widened the page to 430px).
 */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  // Against the DEVICE width, not the page's own: once a phone has zoomed
  // out, innerWidth and clientWidth grow to the page's width and agree with
  // it (measured: 430 and 430 on the broken page), so they cannot see this.
  const screen = page.viewportSize()?.width ?? 0;
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((html: { scrollWidth: number }) => html.scrollWidth),
    )
    .toBeLessThanOrEqual(screen + 1);
}

/** A team name that fits TEAM_NAME_MAX (40) and stays unique. */
function teamName(prefix: string): string {
  return uniqueName(prefix).slice(0, 40);
}

test.describe("camp member — team chat rules", () => {
  test("leads, join modes, a two-way chat, the timer and the stranger's 404", async ({
    makeAppPage,
  }) => {
    test.setTimeout(480_000);
    const alicePage = await makeAppPage("web");
    const renPage = await makeAppPage("web");
    const jabuPage = await makeAppPage("web");
    const strangerPage = await makeAppPage("web");

    const alice = uniqueUsername("alice_hatter");
    const ren = uniqueUsername("ren_notfound");
    const jabu = uniqueUsername("jabu");
    const stranger = uniqueUsername("stranger");

    await signUpBurner(alicePage, { onboard: true, username: alice });
    const camp = await createCamp(alicePage, {
      name: uniqueName("Vuurvlieg Collective"),
    });
    const invite = await inviteToCamp(alicePage, camp.slug, "member");
    await signUpBurner(renPage, { onboard: true, username: ren });
    await joinByInvite(renPage, invite.url);
    const invite2 = await inviteToCamp(alicePage, camp.slug, "member");
    await signUpBurner(jabuPage, { onboard: true, username: jabu });
    await joinByInvite(jabuPage, invite2.url);
    await signUpBurner(strangerPage, { onboard: true, username: stranger });

    // Alice makes an OPEN team with Ren as its team lead, and a LEADS-ADD team.
    const kitchen = teamName("Kitchen");
    const { teamPath } = await createTeam(alicePage, camp.slug, {
      name: kitchen,
      leads: [ren],
    });
    // Ren is seated as a lead by the create: listed under Team leads.
    const leadsSection = alicePage.getByRole("region", { name: "Team leads" });
    await expect(leadsSection.getByText(ren, { exact: true })).toBeVisible();
    const sound = teamName("Sound");
    const { teamPath: soundPath } = await createTeam(alicePage, camp.slug, {
      name: sound,
      joinMode: "leads_add",
    });

    // JOIN MODES, on one rendered list: the open team offers Jabu Join; the
    // leads-add team does not, and says a team lead adds people.
    await jabuPage.goto(`/camps/${camp.slug}/teams`);
    await expect(
      jabuPage.getByRole("button", { name: `Join ${kitchen}` }),
    ).toBeVisible();
    const soundRow = jabuPage.getByRole("listitem").filter({ hasText: sound });
    await expect(soundRow).toContainText("A team lead adds people");
    await expect(
      jabuPage.getByRole("button", { name: `Join ${sound}` }),
    ).toHaveCount(0);
    // Its page says so too, and has no Join either.
    await jabuPage.goto(soundPath);
    await expect(jabuPage.getByRole("heading", { name: sound })).toBeVisible();
    await expect(
      jabuPage.getByText(/only team leads and camp leads add people/i),
    ).toBeVisible();
    await expect(
      jabuPage.getByRole("button", { name: `Join ${sound}` }),
    ).toHaveCount(0);

    // Jabu joins the open team. Ren (team lead) opens the chat and posts.
    await joinTeamFromPage(jabuPage, teamPath, kitchen);
    const chatPath = await openTeamChat(renPage, teamPath, kitchen);
    await expectNoSidewaysScroll(renPage);
    const hello = uniqueName("TEAMRULES hello from Ren");
    await sendTeamMessage(renPage, kitchen, hello);

    // ROUND TRIP: Jabu reads it, attributed to Ren, and replies.
    await openTeamChat(jabuPage, teamPath, kitchen);
    await expect(jabuPage.getByText(hello)).toBeVisible();
    const reply = uniqueName("TEAMRULES reply from Jabu");
    await sendTeamMessage(jabuPage, kitchen, reply);
    await renPage.reload();
    await expect(renPage.getByText(reply)).toBeVisible();

    // TIMER: Jabu, a plain member, is not offered it…
    await expect(
      jabuPage.getByText(/disappearing messages · off/i),
    ).toBeVisible();
    await expect(
      jabuPage.getByRole("button", { name: "Change", exact: true }),
    ).toHaveCount(0);
    // …Ren, the team lead, is — and sets 7 days.
    await renPage.getByRole("button", { name: "Change", exact: true }).click();
    await renPage
      .getByRole("radio", { name: "Disappearing messages: 7 days" })
      .click();
    await expect(
      renPage.getByText(/You set disappearing messages to 7 days/),
    ).toBeVisible({ timeout: 15_000 });
    const timed = uniqueName("TEAMRULES after the timer");
    await sendTeamMessage(renPage, kitchen, timed);
    await expect(renPage.getByText(/disappears/).first()).toBeVisible();
    await jabuPage.reload();
    await expect(
      jabuPage.getByText(
        new RegExp(`${ren} set disappearing messages to 7 days`),
      ),
    ).toBeVisible();
    await expect(
      jabuPage.getByText(/disappearing messages · 7 days/i),
    ).toBeVisible();

    // The camp lead makes Jabu a team lead in Edit team — then he is offered
    // the timer too.
    await alicePage.goto(teamPath);
    // The lead's view: every member row carries Remove.
    await expect(
      alicePage.getByRole("button", { name: `Remove ${jabu} from ${kitchen}` }),
    ).toBeVisible();
    await expectNoSidewaysScroll(alicePage);
    await alicePage.getByRole("button", { name: "Edit team" }).click();
    const edit = alicePage.getByRole("dialog");
    await edit.getByRole("button", { name: "Add a lead" }).click();
    await alicePage.getByRole("button", { name: jabu, exact: true }).click();
    await expect(
      edit.getByRole("button", { name: `Stop ${jabu} being a team lead` }),
    ).toBeVisible();
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    await expect(edit).toHaveCount(0, { timeout: 15_000 });
    await expect(
      alicePage
        .getByRole("region", { name: "Team leads" })
        .getByText(jabu, { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await jabuPage.reload();
    await expect(jabuPage.getByText(timed)).toBeVisible();
    await expect(
      jabuPage.getByRole("button", { name: "Change", exact: true }),
    ).toBeVisible();

    // STRANGER: not in the camp — the camp's not-found on the list, the team
    // page and the chat (positive control: Jabu renders all three above).
    await expectServerNotFound(strangerPage, `/camps/${camp.slug}/teams`, [
      kitchen,
      sound,
    ]);
    await expectServerNotFound(strangerPage, teamPath, [kitchen, ren]);
    await expectServerNotFound(strangerPage, chatPath, [hello, reply, timed]);
  });

  test("a later joiner sees no history; a block hides two members from each other", async ({
    makeAppPage,
  }) => {
    test.setTimeout(480_000);
    const alicePage = await makeAppPage("web");
    const renPage = await makeAppPage("web");
    const jabuPage = await makeAppPage("web");

    const alice = uniqueUsername("alice_hatter");
    const ren = uniqueUsername("ren_notfound");
    const jabu = uniqueUsername("jabu");

    await signUpBurner(alicePage, { onboard: true, username: alice });
    const camp = await createCamp(alicePage, {
      name: uniqueName("The Long Drop Inn"),
    });
    const invite = await inviteToCamp(alicePage, camp.slug, "member");
    await signUpBurner(renPage, { onboard: true, username: ren });
    await joinByInvite(renPage, invite.url);
    const invite2 = await inviteToCamp(alicePage, camp.slug, "member");
    await signUpBurner(jabuPage, { onboard: true, username: jabu });
    await joinByInvite(jabuPage, invite2.url);

    const team = teamName("Build crew");
    const { teamPath } = await createTeam(alicePage, camp.slug, {
      name: team,
    });
    await joinTeamFromPage(renPage, teamPath, team);
    await joinTeamFromPage(jabuPage, teamPath, team);
    await openTeamChat(renPage, teamPath, team);
    const early = uniqueName("TEAMBLOCK early from Ren");
    await sendTeamMessage(renPage, team, early);
    await openTeamChat(jabuPage, teamPath, team);
    await expect(jabuPage.getByText(early)).toBeVisible();

    // LATER JOINER: Alice (the camp lead) joins now — the chat opens for her
    // from here on; Ren's earlier message is not served to her.
    await joinTeamFromPage(alicePage, teamPath, team);
    await openTeamChat(alicePage, teamPath, team);
    await expect(alicePage.getByText(/You joined on/)).toBeVisible();
    await expect(alicePage.getByText("No messages yet.")).toBeVisible();
    await expect(alicePage.getByText(early)).toHaveCount(0);

    // BLOCK: Ren blocks Jabu from Jabu's profile.
    const jabuId = await burnerIdFromRoster(renPage, camp.slug, jabu);
    await renPage.goto(`/burners/${jabuId}`);
    await renPage
      .getByRole("button", { name: `Block ${jabu}`, exact: true })
      .click();
    await expect(
      renPage.getByRole("button", { name: `Unblock ${jabu}`, exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Both still post; neither is removed from the team.
    const fromJabu = uniqueName("TEAMBLOCK from Jabu after the block");
    await jabuPage.reload();
    await sendTeamMessage(jabuPage, team, fromJabu);
    await openTeamChat(renPage, teamPath, team);
    const fromRen = uniqueName("TEAMBLOCK from Ren after the block");
    await sendTeamMessage(renPage, team, fromRen);

    // Ren does not see Jabu's message (his own is on screen, so the thread
    // has rendered)…
    await expect(renPage.getByText(fromJabu)).toHaveCount(0);
    await expect(renPage.getByText(early)).toBeVisible();
    // …Jabu does not see Ren's — either of them…
    await jabuPage.reload();
    await expect(jabuPage.getByText(fromJabu)).toBeVisible();
    await expect(jabuPage.getByText(fromRen)).toHaveCount(0);
    await expect(jabuPage.getByText(early)).toHaveCount(0);
    // …and Alice, blocking nobody, sees both.
    await alicePage.reload();
    await expect(alicePage.getByText(fromJabu)).toBeVisible();
    await expect(alicePage.getByText(fromRen)).toBeVisible();

    // Unblocking shows them again.
    await renPage.goto(`/burners/${jabuId}`);
    await renPage
      .getByRole("button", { name: `Unblock ${jabu}`, exact: true })
      .click();
    await expect(
      renPage.getByRole("button", { name: `Block ${jabu}`, exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await jabuPage.reload();
    await expect(jabuPage.getByText(fromRen)).toBeVisible();
  });

  test("reporting a team message sends only that copy to the safety queue", async ({
    makeAppPage,
  }) => {
    test.skip(
      test.info().project.name === "mobile-360",
      "the org console is desktop-shaped; reporting on mobile is the same component as the direct chat's",
    );
    skipUnlessGod();
    test.setTimeout(420_000);
    const alicePage = await makeAppPage("web");
    const renPage = await makeAppPage("web");
    const jabuPage = await makeAppPage("web");

    const alice = uniqueUsername("alice_hatter");
    const ren = uniqueUsername("ren_notfound");
    const jabu = uniqueUsername("jabu");

    await signUpBurner(alicePage, { onboard: true, username: alice });
    const camp = await createCamp(alicePage, {
      name: uniqueName("Dust Bunnies"),
    });
    const invite = await inviteToCamp(alicePage, camp.slug, "member");
    await signUpBurner(renPage, { onboard: true, username: ren });
    await joinByInvite(renPage, invite.url);
    const invite2 = await inviteToCamp(alicePage, camp.slug, "member");
    await signUpBurner(jabuPage, { onboard: true, username: jabu });
    await joinByInvite(jabuPage, invite2.url);

    const team = teamName("Tea bar");
    const { teamPath } = await createTeam(alicePage, camp.slug, {
      name: team,
    });
    await joinTeamFromPage(renPage, teamPath, team);
    await joinTeamFromPage(jabuPage, teamPath, team);

    await openTeamChat(renPage, teamPath, team);
    const own = uniqueName("TEAMREPORT Ren's own message");
    await sendTeamMessage(renPage, team, own);
    await openTeamChat(jabuPage, teamPath, team);
    const harmless = uniqueName("TEAMREPORT harmless from Jabu");
    await sendTeamMessage(jabuPage, team, harmless);
    const reported = uniqueName("TEAMREPORT the message Ren reports");
    await sendTeamMessage(jabuPage, team, reported);

    // Ren ticks ONLY the one message and sends the report.
    await renPage.reload();
    await expect(renPage.getByText(reported)).toBeVisible();
    await renPage.getByRole("button", { name: "Report messages" }).click();
    await expect(
      renPage.getByRole("button", { name: "Send report (0)" }),
    ).toBeDisabled();
    await renPage.getByText(reported, { exact: true }).click();
    const sendReport = renPage.getByRole("button", {
      name: "Send report (1)",
    });
    await expect(sendReport).toBeEnabled();
    await sendReport.click();
    await expect(
      renPage.getByText(/report sent to afrikaburn's safety team/i),
    ).toBeVisible({ timeout: 15_000 });

    // ORG STAFF: the Open queue lists it as a one-message report naming Jabu.
    const staff = await provisionOrgStaff(makeAppPage);
    const org = staff.org;
    await org.goto("/safety?status=open");
    await expect(
      org.getByRole("heading", { name: "Message reports", exact: true }),
    ).toBeVisible();
    const row = org.getByRole("link", {
      name: new RegExp(`${ren}\\s+reported\\s+${jabu}`),
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText("1 message");
    await row.click();
    await org.waitForURL(/\/safety\/[0-9a-f-]{36}$/i);
    await expect(
      org.getByRole("heading", { name: `${ren} reported ${jabu}` }),
    ).toBeVisible();
    // The copy of the reported message, and nothing else from the chat.
    await expect(org.getByText(reported, { exact: true })).toBeVisible();
    await expect(org.getByText(harmless)).toHaveCount(0);
    await expect(org.getByText(own)).toHaveCount(0);
  });
});
