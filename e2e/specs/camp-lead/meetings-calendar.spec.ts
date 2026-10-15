// specs/camp-lead/meetings-calendar.spec.ts
//
// Persona: CAMP LEAD (+ a member holding a custom "can schedule meetings"
// role, and a plain member) — the whole-camp meeting, moving and cancelling
// it, and the camp calendar (docs/camp-meetings-spec.md).
//
// The companion spec (meetings.spec.ts) covers the role-only audience, notes,
// who came and the stranger. This one covers what that one does not:
//
//   1. The lead makes a role whose only privilege is "Can schedule meetings"
//      and gives it to S. M, a plain member, has no Schedule meeting button
//      and gets the camp's not-found for the form.
//   2. S (not a lead) schedules a WHOLE-CAMP meeting with a call link during
//      the event. The reach line counts all three members.
//   3. M sees it, its Join call is a plain external link (href + rel only —
//      the call is never opened), and M downloads the .ics through the
//      button; the file names the meeting at its SAST time.
//   4. The calendar shows the meeting with the build, event and strike days:
//      the month grid on desktop, the agenda on the 360 phone.
//   5. S moves it: M is told, and the .ics follows the new time.
//   6. S cancels it: M is told.
//
// Selector provenance (verified against source on 2026-10-15):
//   privilege switch . apps/web/components/roles/privileges.tsx
//   form ............. apps/web/components/meetings/meeting-form.tsx
//   meeting page ..... apps/web/app/(app)/camps/[slug]/meetings/[id]/page.tsx
//   calendar ......... apps/web/components/meetings/camp-calendar.tsx
//   notice copy ...... packages/core/src/camp-meetings.ts (meeting*Notice)

import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
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

/** A text's VISIBLE matches: the month grid and the agenda are both in the
 * DOM at every width, one of them hidden by CSS. */
function visibleText(page: Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true });
}

/** The .ics body with RFC 5545 line folding undone, so a long SUMMARY reads
 * as one line. */
function unfoldIcs(body: string): string {
  return body.replace(/\r\n[ \t]/g, "");
}

/** Open the notifications page and wait for it to have painted. */
async function gotoNotifications(page: Page): Promise<void> {
  await page.goto("/notifications");
  await expect(
    page.getByRole("heading", { name: /^notifications$/i }),
  ).toBeVisible();
}

test.describe("camp lead — meetings for the whole camp and the calendar", () => {
  test("a scheduler role schedules, moves and cancels a whole-camp meeting; the calendar shows it", async ({
    makeAppPage,
  }) => {
    test.setTimeout(300_000);
    const mobile = test.info().project.name === "mobile-360";

    const leadPage = await makeAppPage("web");
    const sPage = await makeAppPage("web");
    const mPage = await makeAppPage("web");
    const sName = uniqueUsername("meet_ren");
    const mName = uniqueUsername("meet_alice");
    const roleName = uniqueName("Meetings");
    const title = uniqueName("Build week");
    const link = "https://meet.example.com/camp-404";

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const inviteS = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(sPage, { onboard: true, username: sName });
    await joinByInvite(sPage, inviteS.url);
    const inviteM = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(mPage, { onboard: true, username: mName });
    await joinByInvite(mPage, inviteM.url);

    // ── 1. A scheduler role for S; M cannot schedule ─────────────────────
    await createCustomRole(leadPage, camp.slug, {
      name: roleName,
      emoji: "📅",
      colorLabel: "Teal",
      privileges: ["Can schedule meetings"],
    });
    await assignRoleToMember(leadPage, camp.slug, sName, roleName);

    await mPage.goto(`/camps/${camp.slug}/meetings`);
    await expect(
      mPage.getByRole("heading", { level: 1, name: "Meetings" }),
    ).toBeVisible();
    await expect(mPage.getByText("Nothing scheduled yet")).toBeVisible();
    await expect(
      mPage.getByRole("link", { name: "Schedule meeting" }),
    ).toHaveCount(0);
    await expectServerNotFound(mPage, `/camps/${camp.slug}/meetings/new`);

    // ── 2. S schedules a whole-camp meeting with a call link ─────────────
    await sPage.goto(`/camps/${camp.slug}/meetings`);
    await expect(
      sPage.getByRole("heading", { level: 1, name: "Meetings" }),
    ).toBeVisible();
    await sPage.getByRole("link", { name: "Schedule meeting" }).first().click();
    await expect(
      sPage.getByRole("heading", { name: "Schedule a meeting" }),
    ).toBeVisible();
    await sPage.getByLabel("Title").fill(title);
    await sPage.getByLabel("Date").fill("2027-04-28");
    await sPage.getByLabel("Start time").fill("18:30");
    await sPage.getByLabel("Call link").fill(link);
    await expect(
      sPage.getByRole("button", { name: "Whole camp" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The lead, S and M.
    await expect(sPage.getByText(/shows to\s*3 members/i)).toBeVisible();
    await sPage.getByRole("button", { name: "Schedule meeting" }).click();

    await expect(
      sPage.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    const meetingUrl = new URL(sPage.url()).pathname;
    expect(meetingUrl).toMatch(
      new RegExp(`^/camps/${camp.slug}/meetings/[0-9a-f-]{36}$`),
    );
    await expect(sPage.getByRole("link", { name: "Edit" })).toBeVisible();

    // ── 3. M sees it, its link, and downloads the .ics ───────────────────
    await mPage.goto(`/camps/${camp.slug}/meetings`);
    await expect(
      mPage.getByRole("heading", { name: "Upcoming" }),
    ).toBeVisible();
    await mPage.getByRole("link", { name: title }).click();
    await expect(
      mPage.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(mPage.getByText("Wednesday 28 April 2027")).toBeVisible();
    const join = mPage.getByRole("link", { name: "Join call" });
    await expect(join).toHaveAttribute("href", link);
    await expect(join).toHaveAttribute("rel", "noopener noreferrer");
    await expect(mPage.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(
      mPage.getByRole("button", { name: "Cancel meeting" }),
    ).toHaveCount(0);

    const downloading = mPage.waitForEvent("download");
    await mPage.getByRole("link", { name: "Add to my calendar" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.ics$/);
    const icsPath = await download.path();
    const ics = unfoldIcs(await readFile(icsPath, "utf8"));
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain(`SUMMARY:${title}`);
    expect(ics).toContain("DTSTART;TZID=Africa/Johannesburg:20270428T183000");
    expect(ics).toContain(`URL:${link}`);

    await gotoNotifications(mPage);
    await expect(
      mPage.getByText(`scheduled ${title}`, { exact: false }),
    ).toBeVisible();

    // ── 4. The calendar: the meeting among build, event and strike ───────
    await mPage.goto(`/camps/${camp.slug}/calendar?month=2027-04`);
    await expect(
      mPage.getByRole("heading", { level: 2, name: "April 2027" }),
    ).toBeVisible();
    const chip = mPage
      .getByRole("link", { name: new RegExp(title) })
      .filter({ visible: true });
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText("18:30");
    if (mobile) {
      // The agenda: the legend plus the phase card that opens each phase
      // inside April. Strike (3 May) is next month's.
      await expect(visibleText(mPage, "Build")).toHaveCount(2);
      await expect(visibleText(mPage, "AfrikaBurn 2027")).toHaveCount(2);
      await expect(visibleText(mPage, "Strike")).toHaveCount(1);
      await mPage.getByRole("link", { name: /^next month/i }).click();
      await expect(
        mPage.getByRole("heading", { level: 2, name: "May 2027" }),
      ).toBeVisible();
      await expect(visibleText(mPage, "Strike")).toHaveCount(2);
      await expect(chip).toHaveCount(0);
    } else {
      // The month grid (29 Mar – 9 May): the legend plus one band label per
      // phase — build from Thu 22, the event from Mon 26, strike Mon 3 May.
      await expect(visibleText(mPage, "Mon")).toHaveCount(1);
      await expect(visibleText(mPage, "Build")).toHaveCount(2);
      await expect(visibleText(mPage, "AfrikaBurn 2027")).toHaveCount(2);
      await expect(visibleText(mPage, "Strike")).toHaveCount(2);
    }

    // ── 5. S moves it; M is told and the .ics follows ────────────────────
    await sPage.getByRole("link", { name: "Edit" }).click();
    await expect(sPage.getByLabel("Start time")).toHaveValue("18:30");
    await sPage.getByLabel("Start time").fill("19:15");
    await sPage.getByRole("button", { name: "Save changes" }).click();
    await expect(
      sPage.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(sPage.getByText(/19:15/).first()).toBeVisible();

    await gotoNotifications(mPage);
    await expect(
      mPage.getByText(`moved ${title}`, { exact: false }),
    ).toBeVisible();
    const moved = await mPage.request.get(`${meetingUrl}/ics`);
    expect(moved.status()).toBe(200);
    expect(unfoldIcs(await moved.text())).toContain(
      "DTSTART;TZID=Africa/Johannesburg:20270428T191500",
    );

    // ── 6. S cancels it; M is told ───────────────────────────────────────
    await sPage.getByRole("button", { name: "Cancel meeting" }).click();
    const dialog = sPage.getByRole("dialog", {
      name: "Cancel this meeting?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel meeting" }).click();
    await expect(sPage.getByText(/^Cancelled on /)).toBeVisible();

    await gotoNotifications(mPage);
    await expect(
      mPage.getByText(`cancelled ${title}`, { exact: false }),
    ).toBeVisible();
    await mPage.goto(meetingUrl);
    await expect(
      mPage.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(mPage.getByText(/^Cancelled on /)).toBeVisible();
    await expect(mPage.getByRole("link", { name: "Join call" })).toHaveCount(0);
  });
});
