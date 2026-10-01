// specs/camp-lead/shifts.spec.ts
//
// Persona: CAMP LEAD (+ two members) — camp shifts, epic #57.
//
// One journey, because each step only means something against the state the
// one before it left:
//
//   1. The camp page's Shifts tile is the way in. The lead opens Shifts; the
//      starter team list is there; they create a one-person shift on one day.
//      The overview shows it as "0 of 1" with a gap.
//   2. Member A finds it in Open shifts and signs up. It moves into their My
//      shifts and out of Open shifts; the lead's overview now says Full.
//   3. Member A can't make it and offers it up ("needs a replacement"). They
//      stay on it meanwhile — My shifts says "In open shifts".
//   4. Member B takes it. It is B's now (their My shifts), gone from A's, and
//      the lead's overview names B. No lead approved anything.
//   5. The notices: A is told B took it; the lead is told it changed hands.
//   6. The lead takes B off and assigns A back through the Assign dialog —
//      the write that locks two memberships (the lead's and A's) before the
//      shift row, run against real Postgres. A is told they were put on it.
//   7. A stranger (no membership) gets the camp's not-found for Shifts.
//
// Selector provenance (verified against source on 2026-10-01):
//   tile ............ apps/web/components/shifts/shifts-tile.tsx
//   overview ........ apps/web/components/shifts/lead-overview.tsx
//                     (rows: data-testid="lead-shift-row")
//   new shift ....... apps/web/components/shifts/shift-form.tsx
//   member view ..... apps/web/components/shifts/member-shifts.tsx
//                     (data-testid="my-shift" / "open-shift")
//   hand on ......... apps/web/components/shifts/hand-on-form.tsx
//   edit / assign ... apps/web/app/(app)/camps/[slug]/shifts/[id]/edit/page.tsx,
//                     apps/web/components/shifts/assign-dialog.tsx

import { test, expect } from "../../fixtures";
import type { Page } from "@playwright/test";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { expectServerNotFound } from "../camp-member/support";

async function gotoMyShifts(page: Page, slug: string): Promise<void> {
  await page.goto(`/camps/${slug}/shifts/mine`);
  await expect(page.getByRole("heading", { level: 1, name: "Shifts", exact: true })).toBeVisible();
}

test.describe("camp lead — shifts", () => {
  test("a lead creates a shift, a member signs up and offers it up, another member takes it", async ({
    makeAppPage,
  }) => {
    test.setTimeout(300_000);

    const leadPage = await makeAppPage("web");
    const aPage = await makeAppPage("web");
    const bPage = await makeAppPage("web");
    const strangerPage = await makeAppPage("web");
    const aName = uniqueUsername("shift_jabu");
    const bName = uniqueUsername("shift_lerato");
    const shiftName = uniqueName("Tea bar night");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    // One invite at a time: each is read from the newest <code> on the camp
    // page, so minting the second before the first is used can read the first.
    const inviteA = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(aPage, { onboard: true, username: aName });
    await joinByInvite(aPage, inviteA.url);
    const inviteB = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(bPage, { onboard: true, username: bName });
    await joinByInvite(bPage, inviteB.url);

    // ── 1. The lead sets up a shift ──────────────────────────────────────
    await leadPage.goto(`/camps/${camp.slug}`);
    await leadPage.getByRole("link", { name: /set up shifts/i }).click();
    await expect(leadPage.getByRole("heading", { name: "Shifts", exact: true })).toBeVisible();
    // Nothing yet — and the starter team list was written for this camp.
    await expect(leadPage.getByText("No shifts yet")).toBeVisible();

    await leadPage.getByRole("link", { name: /new shift/i }).first().click();
    await expect(
      leadPage.getByRole("heading", { name: "New shift" }),
    ).toBeVisible();
    await expect(leadPage.getByRole("radio", { name: "Tea bar" })).toBeVisible();
    await leadPage.getByLabel(/shift name/i).fill(shiftName);
    await leadPage.getByRole("radio", { name: "Tea bar" }).click();
    // One person, on Thursday of the event.
    await leadPage.getByRole("button", { name: "Fewer people" }).click();
    await expect(
      leadPage.getByRole("textbox", { name: "How many people" }),
    ).toHaveValue("1");
    await leadPage
      .getByRole("toolbar", { name: "Event days" })
      .getByRole("button", { name: "Thu 29" })
      .click();
    await expect(
      leadPage.getByText(/makes 1 shift, thu 29 apr · 1 spot to fill/i),
    ).toBeVisible();
    await leadPage.getByRole("button", { name: "Create shift" }).click();

    const leadRow = leadPage
      .getByTestId("lead-shift-row")
      .filter({ hasText: shiftName });
    await expect(leadRow).toBeVisible();
    await expect(leadRow).toContainText("0 of 1");
    await expect(leadRow).toContainText("1 gap");
    await expect(leadRow).toContainText("Nobody yet");

    // ── 2. Member A signs up ─────────────────────────────────────────────
    await aPage.goto(`/camps/${camp.slug}/shifts`);
    await expect(aPage.getByRole("heading", { name: "Shifts", exact: true })).toBeVisible();
    const openForA = aPage
      .getByTestId("open-shift")
      .filter({ hasText: shiftName });
    await expect(openForA).toContainText("1 spot left");
    await openForA.getByRole("button", { name: /sign up/i }).click();
    const mineA = aPage.getByTestId("my-shift").filter({ hasText: shiftName });
    await expect(mineA).toBeVisible();
    await expect(openForA).toHaveCount(0);

    await leadPage.reload();
    await expect(leadRow).toContainText("1 of 1");
    await expect(leadRow).toContainText("Full");
    await expect(leadRow).toContainText(aName);

    // Member B sees nothing to sign up for — the one spot is taken.
    await gotoMyShifts(bPage, camp.slug);
    await expect(bPage.getByText("You're not on any shifts yet.")).toBeVisible();
    await expect(
      bPage.getByTestId("open-shift").filter({ hasText: shiftName }),
    ).toHaveCount(0);

    // ── 3. Member A offers it up ─────────────────────────────────────────
    await mineA.getByRole("link", { name: /offer or swap/i }).click();
    await expect(
      aPage.getByRole("heading", { name: "Hand on a shift" }),
    ).toBeVisible();
    await aPage.getByRole("radio", { name: /needs a replacement/i }).click();
    await aPage
      .getByRole("button", { name: /put it up for a replacement/i })
      .click();
    await expect(aPage.getByRole("heading", { level: 1, name: "Shifts", exact: true })).toBeVisible();
    await expect(mineA).toContainText(/in open shifts/i);

    // ── 4. Member B takes it ─────────────────────────────────────────────
    await gotoMyShifts(bPage, camp.slug);
    const offeredForB = bPage
      .getByTestId("open-shift")
      .filter({ hasText: shiftName });
    await expect(offeredForB).toContainText(`${aName} needs a replacement`);
    await offeredForB.getByRole("button", { name: /take it/i }).click();
    await expect(
      bPage.getByTestId("my-shift").filter({ hasText: shiftName }),
    ).toBeVisible();

    await gotoMyShifts(aPage, camp.slug);
    await expect(aPage.getByText("You're not on any shifts yet.")).toBeVisible();

    await leadPage.reload();
    await expect(leadRow).toContainText(bName);
    await expect(leadRow).not.toContainText(aName);
    await expect(leadRow).toContainText("1 of 1");

    // ── 5. The notices ───────────────────────────────────────────────────
    await aPage.goto("/notifications");
    await expect(
      aPage.getByRole("heading", { name: /^notifications$/i }),
    ).toBeVisible();
    await expect(
      aPage.getByText(`${bName} took your ${shiftName}`, { exact: false }),
    ).toBeVisible();

    await leadPage.goto("/notifications");
    await expect(
      leadPage.getByRole("heading", { name: /^notifications$/i }),
    ).toBeVisible();
    await expect(
      leadPage.getByText(`changed hands — ${aName} to ${bName}`, {
        exact: false,
      }),
    ).toBeVisible();

    // ── 6. The lead takes B off and assigns A ────────────────────────────
    await leadPage.goto(`/camps/${camp.slug}/shifts`);
    await expect(leadRow).toContainText(bName);
    await leadRow.getByRole("link", { name: `Edit ${shiftName}` }).click();
    const onShift = leadPage.getByRole("listitem").filter({ hasText: bName });
    await expect(onShift).toBeVisible();
    await onShift.getByRole("button", { name: "Take off" }).click();
    await onShift.getByRole("button", { name: "Take off" }).click();
    await expect(leadPage.getByText("Nobody yet.")).toBeVisible();

    await leadPage.getByRole("button", { name: "Assign", exact: true }).click();
    const dialog = leadPage.getByRole("dialog", { name: "Assign someone" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "Who" }).click();
    await leadPage.getByRole("option", { name: aName }).click();
    await dialog.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await leadPage.goto(`/camps/${camp.slug}/shifts`);
    await expect(leadRow).toContainText(aName);
    await expect(leadRow).not.toContainText(bName);
    await expect(leadRow).toContainText("1 of 1");

    await gotoMyShifts(aPage, camp.slug);
    await expect(
      aPage.getByTestId("my-shift").filter({ hasText: shiftName }),
    ).toBeVisible();
    await aPage.goto("/notifications");
    await expect(
      aPage.getByRole("heading", { name: /^notifications$/i }),
    ).toBeVisible();
    await expect(
      aPage.getByText(`put you on ${shiftName}`, { exact: false }),
    ).toBeVisible();

    // ── 7. A stranger gets the camp's not-found ─────────────────────────
    await signUpBurner(strangerPage, { onboard: true });
    await expectServerNotFound(strangerPage, `/camps/${camp.slug}/shifts`, [
      shiftName,
    ]);
  });
});
