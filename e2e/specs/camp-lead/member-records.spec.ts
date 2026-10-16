// specs/camp-lead/member-records.spec.ts
//
// Persona: CAMP LEAD — member records: private notes and duplicate hints
// (docs/member-records-spec.md, frames R1 / R1b / R2).
//
//   1. The lead adds, edits and deletes a private note on a member's profile;
//      the roster shows the member a "Notes 1" COUNT (never the text). The
//      member sees no card on their own profile. A plain camp-mate sees no
//      card either — until the lead gives them a role with "Can keep private
//      member notes", when the card appears with the lead's note and no edit
//      or delete on it.
//   2. Two members with similar usernames are both flagged "Possible
//      duplicate" on the roster; "Not the same person" hides the hint for the
//      whole camp.
//
// Selector provenance (verified against source on 2026-10-16):
//   notes card ........ apps/web/components/member-records/private-notes-card.tsx
//                       (data-testid private-notes / private-note)
//   roster chips ...... apps/web/components/member-records/roster-record-chips.tsx
//                       (roster-note-count / roster-possible-duplicate)
//   roster table ...... apps/web/components/roster/roster-table.tsx (both a
//                       <table> and a card list render; only one is visible)
//   privilege label ... apps/web/components/roles/privileges.tsx

import { randomBytes } from "node:crypto";
import { type Locator, type Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { assignRoleToMember, createCustomRole } from "./support";

const AUDIENCE_LINE =
  "Only the camp's leads and note-keepers see these. The member can request them under POPIA.";

/** A member's visible roster row — the <tr> on desktop, the card on mobile. */
function rosterRow(page: Page, name: string): Locator {
  return page
    .locator("tr, li")
    .filter({ hasText: name })
    .filter({ visible: true });
}

async function gotoRoster(page: Page, slug: string): Promise<void> {
  await page.goto(`/camps/${slug}/roster`);
  await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
}

/** A member's user id, read off their profile link on the roster. */
async function burnerIdFromRoster(
  page: Page,
  slug: string,
  username: string,
): Promise<string> {
  await gotoRoster(page, slug);
  const link = rosterRow(page, username)
    .getByRole("link", { name: username })
    .first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  const id = href?.match(/\/burners\/([0-9a-f-]{36})/i)?.[1];
  if (!id) throw new Error(`[member-records] no burner link for ${username}`);
  return id;
}

/** Open a profile and wait for its heading — something PRESENT first. */
async function gotoProfile(
  page: Page,
  userId: string,
  name: string,
): Promise<void> {
  await page.goto(`/burners/${userId}`);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

test.describe("camp lead — member records", () => {
  test("the lead keeps private notes on a member; only note people see them", async ({
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const keeperPage = await makeAppPage("web");
    const memberName = uniqueUsername("notes_jabu");
    const keeperName = uniqueUsername("notes_ren");
    const noteText = `Great on build week ${randomBytes(3).toString("hex")}`;
    const editedText = `${noteText}, needs a lift from Cape Town`;

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, invite.url);
    await signUpBurner(keeperPage, { onboard: true, username: keeperName });
    // Invites are single-use: one per person.
    const keeperInvite = await inviteToCamp(leadPage, camp.slug, "member");
    await joinByInvite(keeperPage, keeperInvite.url);

    const memberId = await burnerIdFromRoster(leadPage, camp.slug, memberName);

    // --- The lead: empty card, then add ------------------------------------
    await gotoProfile(leadPage, memberId, memberName);
    const card = leadPage.getByTestId("private-notes");
    await expect(card).toBeVisible();
    await expect(card).toContainText(`About ${memberName}, kept by the camp.`);
    await expect(card.getByText(AUDIENCE_LINE)).toBeVisible();
    await expect(card.getByText("No notes yet")).toBeVisible();
    await expect(card.getByText("0 / 2,000")).toBeVisible();

    const field = card.getByLabel("Add a note");
    const add = card.getByRole("button", { name: "Add note" });
    // Filled until React holds it: the button enables only once the
    // controlled textarea's state carries the text.
    await expect(async () => {
      await field.fill("");
      await field.fill(noteText);
      await expect(add).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(card.getByText(`${noteText.length} / 2,000`)).toBeVisible();
    await add.click();

    const note = card.getByTestId("private-note").filter({ hasText: noteText });
    await expect(note).toBeVisible();
    await expect(card.getByText("No notes yet")).toHaveCount(0);
    await expect(field).toHaveValue("");

    // --- Edit own note --------------------------------------------------------
    await note.getByRole("button", { name: /^edit note/i }).click();
    const editor = card.getByLabel("Edit note");
    await editor.fill(editedText);
    await card.getByRole("button", { name: "Save" }).click();
    const edited = card
      .getByTestId("private-note")
      .filter({ hasText: editedText });
    await expect(edited).toBeVisible();
    await expect(edited).toContainText("edited");

    // --- The roster: a COUNT, never the text ----------------------------------
    await gotoRoster(leadPage, camp.slug);
    const row = rosterRow(leadPage, memberName);
    await expect(row.getByTestId("roster-note-count")).toContainText("Notes 1");
    await expect(leadPage.getByText(editedText)).toHaveCount(0);
    // No count on a member with no notes.
    await expect(rosterRow(leadPage, keeperName)).toBeVisible();
    await expect(
      rosterRow(leadPage, keeperName).getByTestId("roster-note-count"),
    ).toHaveCount(0);

    // --- The member: nothing about themself -----------------------------------
    await gotoProfile(memberPage, memberId, memberName);
    await expect(memberPage.getByText(/edit your bio/i)).toBeVisible();
    await expect(memberPage.getByTestId("private-notes")).toHaveCount(0);
    await expect(memberPage.getByText(editedText)).toHaveCount(0);

    // --- A plain camp-mate: no card (frame R1b) -------------------------------
    await gotoProfile(keeperPage, memberId, memberName);
    await expect(keeperPage.getByText("Camp-mate profile")).toBeVisible();
    await expect(keeperPage.getByTestId("private-notes")).toHaveCount(0);
    await expect(keeperPage.getByText(editedText)).toHaveCount(0);

    // --- ...until they hold member_notes --------------------------------------
    const roleName = uniqueName("Welfare");
    await createCustomRole(leadPage, camp.slug, {
      name: roleName,
      emoji: "🫶",
      colorLabel: "Rust",
      privileges: ["Can keep private member notes"],
    });
    await assignRoleToMember(leadPage, camp.slug, keeperName, roleName);

    await gotoProfile(keeperPage, memberId, memberName);
    const keeperCard = keeperPage.getByTestId("private-notes");
    await expect(keeperCard).toBeVisible();
    const leadsNote = keeperCard
      .getByTestId("private-note")
      .filter({ hasText: editedText });
    await expect(leadsNote).toBeVisible();
    // Someone else's note: no edit, and no delete (only leads delete any).
    await expect(leadsNote.getByRole("button")).toHaveCount(0);

    // --- The lead deletes it, with a confirm ----------------------------------
    await gotoProfile(leadPage, memberId, memberName);
    const leadNote = leadPage
      .getByTestId("private-note")
      .filter({ hasText: editedText });
    await leadNote.getByRole("button", { name: /^delete note/i }).click();
    await expect(
      leadNote.getByText("Delete this note for good?"),
    ).toBeVisible();
    await leadNote.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      leadPage.getByTestId("private-notes").getByText("No notes yet"),
    ).toBeVisible();
    await expect(leadPage.getByText(editedText)).toHaveCount(0);

    await gotoRoster(leadPage, camp.slug);
    await expect(rosterRow(leadPage, memberName)).toBeVisible();
    await expect(
      rosterRow(leadPage, memberName).getByTestId("roster-note-count"),
    ).toHaveCount(0);
  });

  test("similar names are flagged as a possible duplicate; dismissing hides it for the camp", async ({
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    const leadPage = await makeAppPage("web");
    const firstPage = await makeAppPage("web");
    const secondPage = await makeAppPage("web");
    // One long shared word and a one-letter tail: trigram similarity ~0.76,
    // over the 0.55 threshold. Random, because usernames are globally unique.
    const stem = `t${randomBytes(8).toString("hex").slice(0, 13)}`;
    const firstName = `${stem}_a`;
    const secondName = `${stem}_b`;

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(firstPage, { onboard: true, username: firstName });
    await joinByInvite(firstPage, invite.url);
    await signUpBurner(secondPage, { onboard: true, username: secondName });
    const secondInvite = await inviteToCamp(leadPage, camp.slug, "member");
    await joinByInvite(secondPage, secondInvite.url);

    await gotoRoster(leadPage, camp.slug);
    const firstChip = rosterRow(leadPage, firstName).getByTestId(
      "roster-possible-duplicate",
    );
    await expect(firstChip).toBeVisible();
    await expect(
      rosterRow(leadPage, secondName).getByTestId("roster-possible-duplicate"),
    ).toBeVisible();

    await firstChip.click();
    const popover = leadPage.getByRole("dialog");
    await expect(
      popover.getByText(
        `${secondName} and ${firstName} have similar names. They may be one person with two accounts.`,
      ),
    ).toBeVisible();
    await expect(
      popover.getByText("Hides this hint for the whole camp."),
    ).toBeVisible();
    await popover.getByRole("button", { name: "Not the same person" }).click();

    // Gone from both rows (assert the rows PRESENT first).
    await expect(rosterRow(leadPage, firstName)).toBeVisible();
    await expect(
      leadPage
        .getByTestId("roster-possible-duplicate")
        .filter({ visible: true }),
    ).toHaveCount(0);
    await gotoRoster(leadPage, camp.slug);
    await expect(rosterRow(leadPage, secondName)).toBeVisible();
    await expect(
      leadPage
        .getByTestId("roster-possible-duplicate")
        .filter({ visible: true }),
    ).toHaveCount(0);
  });
});
