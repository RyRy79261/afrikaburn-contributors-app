// specs/camp-member/camp-announcements.spec.ts
//
// Persona: CAMP MEMBER, receiving a camp ANNOUNCEMENT (epic #56).
//
// A lead publishes a MUST-ACKNOWLEDGE announcement to ONE role. Four things
// have to hold, and each is asserted against the real app:
//
//   1. A member holding that role is GATED — every surface routes to the
//      announcement, the nav is stripped to sign-out, and ticking the box is
//      the only way forward.
//   2. Acknowledging RELEASES them, and stamps their own delivery.
//   3. A member of the same camp OUTSIDE the role never sees it — not in the
//      inbox, not on the dashboard, and its URL answers exactly like an id
//      that does not exist.
//   4. The lead sees "1 of 1" acknowledged.
//
// Selector provenance (verified against source on 2026-09-26):
//   composer ....... apps/web/components/announcements/composer.tsx
//   gate ........... apps/web/components/announcements/acknowledge-gate.tsx
//                    apps/web/app/(app)/bulletins/[id]/page.tsx
//   sender detail .. apps/web/app/(app)/camps/[slug]/announcements/[id]/page.tsx

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { assignRoleToMember, createCustomRole } from "../camp-lead/support";

test.describe("camp member — camp announcements", () => {
  test("a must-acknowledge announcement to one role gates that role only, and the lead sees it acknowledged", async ({
    makeAppPage,
  }) => {
    // Three people sign up and onboard, and the lead builds a camp and a role,
    // before the announcement itself: well past the 90 s default (the other
    // multi-persona specs here allow 180-300 s).
    test.setTimeout(240_000);
    const leadPage = await makeAppPage("web");
    const cookPage = await makeAppPage("web");
    const builderPage = await makeAppPage("web");
    const cookName = uniqueUsername("cook_jabu");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(cookPage, { onboard: true, username: cookName });
    await joinByInvite(cookPage, invite.url);
    const invite2 = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(builderPage, { onboard: true });
    await joinByInvite(builderPage, invite2.url);

    const roleName = uniqueName("Kitchen crew");
    await createCustomRole(leadPage, camp.slug, {
      name: roleName,
      emoji: "🍳",
      colorLabel: "Rust",
    });
    await assignRoleToMember(leadPage, camp.slug, cookName, roleName);

    // --- The lead composes and publishes -----------------------------------
    const title = uniqueName("Kitchen fire drill");
    const marker = `Meet at the dome ${Date.now().toString(36)}`;
    await leadPage.goto(`/camps/${camp.slug}/announcements/new`);
    await expect(
      leadPage.getByRole("heading", { name: /new announcement/i }),
    ).toBeVisible();
    await leadPage.getByLabel(/^title/i).fill(title);
    const body = leadPage.getByRole("textbox", {
      name: /announcement message/i,
    });
    await body.click();
    await leadPage.keyboard.type(marker);
    await leadPage.getByRole("button", { name: /^by role$/i }).click();
    await leadPage.getByRole("button", { name: roleName }).click();
    await leadPage.getByRole("button", { name: /^must acknowledge/i }).click();
    await leadPage
      .getByRole("button", { name: /publish announcement/i })
      .click();

    // The lead is never in their own audience: they land on the detail page,
    // not a gate. Its id is the announcement's.
    await leadPage.waitForURL(/\/announcements\/[0-9a-f-]{36}$/i);
    const announcementId = leadPage
      .url()
      .match(/announcements\/([0-9a-f-]{36})$/i)?.[1];
    expect(announcementId).toBeTruthy();
    const gateUrl = new RegExp(`/bulletins/${announcementId}$`);
    const acknowledgedStat = leadPage
      .getByText("Acknowledged", { exact: true })
      .locator("..");
    await expect(acknowledgedStat).toContainText("0 of 1");

    // --- The member IN the role is gated ----------------------------------
    await cookPage.goto(`/camps/${camp.slug}`);
    await expect(cookPage).toHaveURL(gateUrl);
    await expect(cookPage.getByRole("heading", { name: title })).toBeVisible();
    await expect(cookPage.getByText(marker)).toBeVisible();
    // Stripped chrome: sign-out is offered, the app nav is not (asserted only
    // after the heading above proves the page painted).
    await expect(
      cookPage.getByRole("button", { name: /sign out/i }),
    ).toBeVisible();
    await expect(
      cookPage.getByRole("link", { name: /directory/i }),
    ).toHaveCount(0);
    await expect(
      cookPage.getByRole("link", { name: /back to notifications/i }),
    ).toHaveCount(0);
    // Other surfaces bounce straight back.
    await cookPage.goto("/profile");
    await expect(cookPage).toHaveURL(gateUrl);

    // The button is inert until the box is ticked.
    const acknowledge = cookPage.getByRole("button", {
      name: /^acknowledge$/i,
    });
    await expect(acknowledge).toBeDisabled();
    await cookPage
      .getByRole("checkbox", { name: /read and understood/i })
      .check();
    await acknowledge.click();
    await cookPage.waitForURL(/\/directory\/?$/);

    // Released: the dashboard renders instead of redirecting.
    await cookPage.goto(`/camps/${camp.slug}`);
    await expect(
      cookPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();
    await expect(cookPage).not.toHaveURL(gateUrl);

    // --- The member OUTSIDE the role never sees it -------------------------
    await builderPage.goto(`/camps/${camp.slug}`);
    await expect(
      builderPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();
    await expect(builderPage.getByText(title)).toHaveCount(0);

    await builderPage.goto("/notifications");
    await expect(
      builderPage.getByRole("heading", { name: /^notifications$/i }),
    ).toBeVisible();
    await expect(builderPage.getByText(title)).toHaveCount(0);

    // Its URL answers exactly like an id that does not exist.
    await builderPage.goto(`/bulletins/${announcementId}`);
    await expect(
      builderPage.getByRole("heading", { name: /we couldn['’]t find/i }),
    ).toBeVisible();
    await expect(builderPage.getByText(marker)).toHaveCount(0);

    // And the sender surface is not theirs: no post_announcements, no page.
    await builderPage.goto(`/camps/${camp.slug}/announcements`);
    await expect(
      builderPage.getByRole("heading", { name: /we couldn['’]t find/i }),
    ).toBeVisible();

    // --- The lead sees it acknowledged -------------------------------------
    await leadPage.reload();
    await expect(leadPage.getByRole("heading", { name: title })).toBeVisible();
    await expect(acknowledgedStat).toContainText("1 of 1");
  });
});
