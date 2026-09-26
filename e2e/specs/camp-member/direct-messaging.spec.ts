// specs/camp-member/direct-messaging.spec.ts
//
// Persona: CAMP MEMBER — direct messaging (epic #69). Private 1:1 chats between
// burners, gated on the recipient's own "Who can contact you" setting, with a
// user-chosen disappearing-messages timer.
//
// Every refusal here is the SERVER's (@quagga/core `canStartConversation` via
// lib/messages-store), and each is paired with a POSITIVE control on the same
// camp so the guard is proven discriminating rather than blanket-deny:
//
//   · two camp-mates, one of whom is contactable by camp mates, chat — both
//     ways — and the unread count reaches the recipient's inbox as a count and
//     a sender, never the message text;
//   · a third member of the SAME camp, who left "Who can contact you" at its
//     default (Nobody), offers no Message button — while the contactable
//     member's profile, viewed by the same person, does;
//   · changing the timer posts a system line into the chat, seen by both.
//
// Selectors: components/campmate-settings-fields.tsx ("Who can contact you:
// <level>"), components/messages/profile-message-actions.tsx (Message),
// components/messages/conversation-thread.tsx (composer label "Message
// <name>", timer items "Disappearing messages: <label>").

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

/** Set "Who can contact you" from the profile card and prove it persisted. */
async function setContactable(
  page: Page,
  level: "Nobody" | "Camp mates" | "Anyone",
): Promise<void> {
  await page.goto("/profile");
  const item = page.getByRole("radio", { name: `Who can contact you: ${level}` });
  await expect(item).toBeVisible();
  await item.click();
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByRole("radio", { name: `Who can contact you: ${level}` }),
    ).toHaveAttribute("aria-checked", "true", { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

/** A burner's id, read from their roster link on the camp page. */
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
  if (!id) throw new Error(`[direct-messaging] no burner link for ${username}`);
  return id;
}

async function sendMessage(page: Page, to: string, text: string): Promise<void> {
  const box = page.getByRole("textbox", { name: `Message ${to}` });
  await box.fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(text)).toBeVisible();
  await expect(box).toHaveValue("");
}

test.describe("camp member — direct messaging", () => {
  test("two contactable camp-mates chat; a non-contactable member cannot be started with", async ({
    makeAppPage,
  }) => {
    test.setTimeout(300_000);
    const alicePage = await makeAppPage("web");
    const renPage = await makeAppPage("web");
    const jabuPage = await makeAppPage("web");

    const alice = uniqueUsername("alice_hatter");
    const ren = uniqueUsername("ren_notfound");
    const jabu = uniqueUsername("jabu");

    // ALICE leads the camp and is contactable by camp mates.
    await signUpBurner(alicePage, { onboard: true, username: alice });
    const camp = await createCamp(alicePage, { name: uniqueName("Dust Bunnies") });
    await setContactable(alicePage, "Camp mates");
    const invite = await inviteToCamp(alicePage, camp.slug, "member");

    // REN and JABU join the same camp. Jabu leaves contactability at Nobody.
    await signUpBurner(renPage, { onboard: true, username: ren });
    await joinByInvite(renPage, invite.url);
    const invite2 = await inviteToCamp(alicePage, camp.slug, "member");
    await signUpBurner(jabuPage, { onboard: true, username: jabu });
    await joinByInvite(jabuPage, invite2.url);

    const aliceId = await burnerIdFromRoster(renPage, camp.slug, alice);
    const jabuId = await burnerIdFromRoster(renPage, camp.slug, jabu);

    // REFUSAL: Jabu has not opted in, so Ren is offered no Message button.
    // Assert the profile rendered (and offers Block) BEFORE asserting absence.
    await renPage.goto(`/burners/${jabuId}`);
    await expect(renPage.getByRole("heading", { name: jabu })).toBeVisible();
    await expect(
      renPage.getByRole("button", { name: `Block ${jabu}` }),
    ).toBeVisible();
    await expect(
      renPage.getByRole("button", { name: "Message", exact: true }),
    ).toHaveCount(0);

    // POSITIVE CONTROL: Alice (camp mates) — same viewer, same camp.
    await renPage.goto(`/burners/${aliceId}`);
    await expect(renPage.getByRole("heading", { name: alice })).toBeVisible();
    await renPage.getByRole("button", { name: "Message", exact: true }).click();
    await renPage.waitForURL(/\/messages\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const conversationUrl = renPage.url();

    const hello = uniqueName("DMSENTINEL hello from Ren");
    await sendMessage(renPage, alice, hello);

    // Alice's inbox names the sender and a count — never the message text.
    await alicePage.goto("/messages");
    await expect(
      alicePage.getByRole("heading", { name: "Messages", exact: true }),
    ).toBeVisible();
    await expect(alicePage.getByText(`1 new message from ${ren}`)).toBeVisible();
    await expect(alicePage.locator("body")).not.toContainText(hello);

    // Alice opens it, reads it, and replies.
    await alicePage.getByRole("link", { name: new RegExp(ren) }).click();
    await alicePage.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
    expect(new URL(alicePage.url()).pathname).toBe(
      new URL(conversationUrl).pathname,
    );
    await expect(alicePage.getByText(hello)).toBeVisible();
    const reply = uniqueName("DMSENTINEL reply from Alice");
    await sendMessage(alicePage, ren, reply);

    await renPage.reload();
    await expect(renPage.getByText(reply)).toBeVisible();

    // A third camp member cannot read the conversation by its URL: the same
    // not-found as an id that does not exist.
    await expectServerNotFound(jabuPage, new URL(conversationUrl).pathname, [
      hello,
      reply,
    ]);
  });

  test("changing the timer posts a system message both people see", async ({
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    const alicePage = await makeAppPage("web");
    const renPage = await makeAppPage("web");
    const alice = uniqueUsername("alice_hatter");
    const ren = uniqueUsername("ren_notfound");

    await signUpBurner(alicePage, { onboard: true, username: alice });
    const camp = await createCamp(alicePage, { name: uniqueName("Stofpad Saloon") });
    await setContactable(alicePage, "Camp mates");
    const invite = await inviteToCamp(alicePage, camp.slug, "member");
    await signUpBurner(renPage, { onboard: true, username: ren });
    await joinByInvite(renPage, invite.url);

    const aliceId = await burnerIdFromRoster(renPage, camp.slug, alice);
    await renPage.goto(`/burners/${aliceId}`);
    await renPage.getByRole("button", { name: "Message", exact: true }).click();
    await renPage.waitForURL(/\/messages\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const path = new URL(renPage.url()).pathname;

    // Off by default.
    await expect(
      renPage.getByRole("radio", { name: "Disappearing messages: Off" }),
    ).toHaveAttribute("aria-checked", "true");
    await renPage
      .getByRole("radio", { name: "Disappearing messages: 7 days" })
      .click();
    await expect(
      renPage.getByText(/You set disappearing messages to 7 days/),
    ).toBeVisible({ timeout: 15_000 });

    // A message sent after the change carries its own expiry.
    const text = uniqueName("DMSENTINEL after the timer");
    await sendMessage(renPage, alice, text);
    await expect(renPage.getByText(/disappears/).first()).toBeVisible();

    // Alice sees the same system line, attributed to Ren.
    await alicePage.goto(path);
    await expect(
      alicePage.getByText(new RegExp(`${ren} set disappearing messages to 7 days`)),
    ).toBeVisible();
    await expect(
      alicePage.getByRole("radio", { name: "Disappearing messages: 7 days" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
