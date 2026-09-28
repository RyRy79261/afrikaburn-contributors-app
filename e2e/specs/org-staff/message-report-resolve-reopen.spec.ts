// specs/org-staff/message-report-resolve-reopen.spec.ts
//
// Persona: ORG STAFF — the direct-message report queue (epic #69, PR #80).
//
// A burner reports a message from a private chat; the safety tier sees ONLY
// that copied message, marks it resolved, and can reopen a resolve made by
// mistake. The org side lives here (not under camp-member) because it is the
// security-relevant half and needs the god account to provision staff.
//
// Two claims, each asserted so it can fail:
//   1. Report mode makes the WHOLE message row a <label> around its tick box,
//      so clicking the message TEXT selects it. We assert the box is unticked
//      and the send button reads "Send report (0)" first, then click the text —
//      if the row stops being a label, the box stays unticked and the count
//      stays 0.
//   2. /safety lists the report under Open; its page shows the reported copy;
//      "Mark resolved" moves it to Resolved (badge + Reopen, and it changes
//      queue tab); "Reopen" moves it back (Mark resolved again, Open tab).
//
// Selectors: apps/web/components/messages/conversation-thread.tsx (ReportRow,
// checkbox "Select message from <name>: …", "Send report (n)", success toast),
// apps/org/app/(console)/safety/page.tsx (row link "<reporter> reported
// <reported>", nav "Report status"), apps/org/app/(console)/safety/[id]/page.tsx
// + components/safety/{resolve,reopen}-report-button.tsx.

import { type Page } from "@playwright/test";
import { test, expect, skipUnlessGod } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

/** Set "Who can contact you" from the profile card and prove it persisted.
 * Same choreography as specs/camp-member/direct-messaging.spec.ts. */
async function setContactable(page: Page, level: "Camp mates"): Promise<void> {
  await page.goto("/profile");
  const item = page.getByRole("radio", {
    name: `Who can contact you: ${level}`,
  });
  await expect(item).toBeVisible();
  await item.click();
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByRole("radio", { name: `Who can contact you: ${level}` }),
    ).toHaveAttribute("aria-checked", "true", { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

async function burnerIdFromRoster(
  page: Page,
  slug: string,
  username: string,
): Promise<string> {
  await page.goto(`/camps/${slug}`);
  const link = page.getByRole("link", { name: username }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  const id = href?.match(/\/burners\/([0-9a-f-]{36})/i)?.[1];
  if (!id) throw new Error(`[message-report] no burner link for ${username}`);
  return id;
}

async function sendMessage(
  page: Page,
  to: string,
  text: string,
): Promise<void> {
  const box = page.getByRole("textbox", { name: `Message ${to}` });
  await box.fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(text)).toBeVisible();
  await expect(box).toHaveValue("");
}

/** The queue tab for a status, asserted RENDERED (aria-current) so a later
 * absence check runs against a painted list, not an empty document. */
async function openQueue(
  org: Page,
  status: "open" | "resolved",
): Promise<void> {
  await org.goto(`/safety?status=${status}`);
  await expect(
    org.getByRole("heading", { name: "Message reports", exact: true }),
  ).toBeVisible();
  await expect(
    org.getByRole("navigation", { name: "Report status" }).getByRole("link", {
      name: status === "open" ? "Open" : "Resolved",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");
}

test.describe("org staff · message reports are resolved and reopened", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("a member reports a message by clicking its text; staff resolve and reopen it", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(360_000);

    const alicePage = await makeAppPage("web");
    const renPage = await makeAppPage("web");
    const alice = uniqueUsername("alice_hatter");
    const ren = uniqueUsername("ren_notfound");

    // ALICE leads the camp and is contactable by camp mates; REN joins.
    await signUpBurner(alicePage, { onboard: true, username: alice });
    const camp = await createCamp(alicePage, {
      name: uniqueName("Karoo Kombuis"),
    });
    await setContactable(alicePage, "Camp mates");
    const invite = await inviteToCamp(alicePage, camp.slug, "member");
    await signUpBurner(renPage, { onboard: true, username: ren });
    await joinByInvite(renPage, invite.url);

    // Ren starts the chat; Alice replies with the message Ren will report.
    const aliceId = await burnerIdFromRoster(renPage, camp.slug, alice);
    await renPage.goto(`/burners/${aliceId}`);
    await renPage.getByRole("button", { name: "Message", exact: true }).click();
    await renPage.waitForURL(/\/messages\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const conversationPath = new URL(renPage.url()).pathname;

    const hello = uniqueName("DMREPORT hello from Ren");
    await sendMessage(renPage, alice, hello);
    await alicePage.goto(conversationPath);
    await expect(alicePage.getByText(hello)).toBeVisible();
    const reported = uniqueName("DMREPORT the message Ren reports");
    await sendMessage(alicePage, ren, reported);

    // ── 1. REPORT MODE: select by clicking the message TEXT ──────────────
    await renPage.reload();
    await expect(renPage.getByText(reported)).toBeVisible();
    await renPage.getByRole("button", { name: "Report messages" }).click();
    await expect(
      renPage.getByRole("heading", { name: "Report messages" }),
    ).toBeVisible();

    const aliceBox = renPage.getByRole("checkbox", {
      name: `Select message from ${alice}`,
    });
    const ownBox = renPage.getByRole("checkbox", {
      name: "Select message from you",
    });
    // Baseline, so the click below is what moves both.
    await expect(aliceBox).not.toBeChecked();
    await expect(ownBox).not.toBeChecked();
    await expect(
      renPage.getByRole("button", { name: "Send report (0)" }),
    ).toBeDisabled();

    // Click the words, NOT the 18px box: the row is the label.
    await renPage.getByText(reported, { exact: true }).click();
    await expect(aliceBox).toBeChecked();
    // Only the clicked row — the other message is still unticked.
    await expect(ownBox).not.toBeChecked();
    const sendReport = renPage.getByRole("button", {
      name: "Send report (1)",
    });
    await expect(sendReport).toBeEnabled();

    const reason = uniqueName("DMREPORT reason for the safety team");
    await renPage
      .getByRole("textbox", { name: "Reason for the report (optional)" })
      .fill(reason);
    await sendReport.click();

    await expect(
      renPage.getByText(/report sent to afrikaburn's safety team/i),
    ).toBeVisible({ timeout: 15_000 });
    // Report mode closed; the composer is back.
    await expect(
      renPage.getByRole("textbox", { name: `Message ${alice}` }),
    ).toBeVisible();
    await expect(
      renPage.getByRole("heading", { name: "Report messages" }),
    ).toHaveCount(0);

    // ── 2. ORG STAFF: queue → report → resolve → reopen ─────────────────
    const staff = await provisionOrgStaff(makeAppPage);
    const org = staff.org;
    const row = org.getByRole("link", {
      name: new RegExp(`${ren}\\s+reported\\s+${alice}`),
    });

    // Not resolved yet: the Resolved tab (rendered) does not list it…
    await openQueue(org, "resolved");
    await expect(row).toHaveCount(0);
    // …the Open tab does, as a one-message report.
    await openQueue(org, "open");
    await expect(row).toBeVisible();
    await expect(row).toContainText("1 message");

    await row.click();
    await org.waitForURL(/\/safety\/[0-9a-f-]{36}$/i);
    const reportPath = new URL(org.url()).pathname;
    await expect(
      org.getByRole("heading", { name: `${ren} reported ${alice}` }),
    ).toBeVisible();
    // The copied message and the reporter's reason — and ONLY the selected
    // message: Ren's own unselected hello is not part of the report.
    await expect(org.getByText(reported, { exact: true })).toBeVisible();
    await expect(org.getByText(reason, { exact: true })).toBeVisible();
    await expect(org.getByText(hello)).toHaveCount(0);

    // RESOLVE.
    const resolve = org.getByRole("button", { name: "Mark resolved" });
    const reopen = org.getByRole("button", { name: "Reopen" });
    await expect(reopen).toHaveCount(0);
    await resolve.click();
    await expect(org.getByText("Report marked resolved.")).toBeVisible();
    await expect(reopen).toBeVisible({ timeout: 15_000 });
    await expect(org.getByText("Resolved", { exact: true })).toBeVisible();
    await expect(resolve).toHaveCount(0);

    // The queue filter moved it: Resolved lists it, Open does not.
    await openQueue(org, "resolved");
    await expect(row).toBeVisible();
    await openQueue(org, "open");
    await expect(row).toHaveCount(0);

    // REOPEN.
    await org.goto(reportPath);
    await expect(
      org.getByRole("heading", { name: `${ren} reported ${alice}` }),
    ).toBeVisible();
    await reopen.click();
    await expect(org.getByText("Report reopened.")).toBeVisible();
    await expect(resolve).toBeVisible({ timeout: 15_000 });
    await expect(reopen).toHaveCount(0);

    // And back in the Open queue, out of Resolved.
    await openQueue(org, "open");
    await expect(row).toBeVisible();
    await openQueue(org, "resolved");
    await expect(row).toHaveCount(0);
  });
});
