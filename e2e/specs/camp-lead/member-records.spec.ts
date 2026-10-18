// specs/camp-lead/member-records.spec.ts
//
// Persona: CAMP LEAD — member records: private notes and duplicate hints
// (docs/member-records-spec.md, frames R1 / R1b / R2).
//
//   1. The lead adds, edits and deletes a private note on a member's profile;
//      the roster shows the member a "Notes N" COUNT (never the text). The
//      member sees no card on their own profile. A plain camp-mate sees no
//      card either — until the lead gives them a role with "Can keep private
//      member notes": then the card appears with the lead's note (no edit or
//      delete on it) and they add a note of their own, which the lead may
//      delete (leads delete any note).
//   2. A lead of ANOTHER camp sees no card about the member — not while the
//      member is a stranger to their camp, and not camp A's note once the
//      member joins their camp too (their own camp's card is empty).
//   3. Two members with similar usernames are both flagged "Possible
//      duplicate" — to the lead and to a roster viewer without
//      `member_notes`, who sees no "Notes" count chip. "Not the same person"
//      hides the hint for the whole camp, and it stays hidden after reload.
//   2b. POPIA export (#105): the lead downloads a text file of the member's
//      notes (oldest first, no author). A note-keeper without a lead role
//      sees the card but no export, and the route refuses them; the member
//      and another camp's lead are refused by the route directly. A member
//      given the camp's Captain role exports too.
//   4. Retention: archiving keeps the notes (the card still shows them on the
//      archived member's profile and after a restore); leaving the camp
//      deletes them (rejoining starts from "No notes yet").
//
// e2e/README.md "Selector traps": every absence below follows something
// PRESENT on the same rendered page.
//
// Selector provenance (verified against source on 2026-10-16):
//   notes card ........ apps/web/components/member-records/private-notes-card.tsx
//                       (data-testid private-notes / private-note)
//   roster chips ...... apps/web/components/member-records/roster-record-chips.tsx
//                       (roster-note-count / roster-possible-duplicate)
//   roster table ...... apps/web/components/roster/roster-table.tsx (both a
//                       <table> and a card list render; only one is visible)
//   archive action .... apps/web/components/roster/member-archive-button.tsx
//   leave camp ........ apps/web/components/leave-camp-button.tsx
//   privilege labels .. apps/web/components/roles/privileges.tsx

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type Download, type Locator, type Page } from "@playwright/test";
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

/** A note body nobody else's test can produce. */
function noteBody(label: string): string {
  return `${label} ${randomBytes(4).toString("hex")}`;
}

/** A member's visible roster row — the <tr> on desktop, the card on mobile. */
function rosterRow(page: Page, name: string): Locator {
  return page
    .locator("tr, li")
    .filter({ hasText: name })
    .filter({ visible: true });
}

async function gotoRoster(page: Page, slug: string, query = ""): Promise<void> {
  await page.goto(`/camps/${slug}/roster${query}`);
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

/**
 * Add a note through the card's form and wait for it to be listed. Filled
 * until React holds it: the button enables only once the controlled
 * textarea's state carries the text.
 */
async function addNote(card: Locator, text: string): Promise<Locator> {
  const field = card.getByLabel("Add a note");
  const add = card.getByRole("button", { name: "Add note" });
  await expect(async () => {
    await field.fill("");
    await field.fill(text);
    await expect(add).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await add.click();
  const note = card.getByTestId("private-note").filter({ hasText: text });
  await expect(note).toBeVisible();
  await expect(field).toHaveValue("");
  return note;
}

/** Delete a note through its inline confirm. */
async function deleteNote(note: Locator): Promise<void> {
  await expect(async () => {
    await note.getByRole("button", { name: /^delete note/i }).click();
    await expect(note.getByText("Delete this note for good?")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await note.getByRole("button", { name: "Delete", exact: true }).click();
}

const EXPORT_BUTTON = "Export notes about this member";

/**
 * Click the card's export action ONCE and return the download. Callers have
 * already driven the card's form (so it is hydrated); one click, one export,
 * one audit row — a retried click would export twice.
 */
async function exportNotes(page: Page, card: Locator): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    card.getByRole("button", { name: EXPORT_BUTTON }).click(),
  ]);
  return download;
}

/** The export route answers this page's session with the not-found 404 and
 * none of the notes. */
async function expectExportRefused(
  page: Page,
  url: string,
  secrets: readonly string[],
): Promise<void> {
  const res = await page.request.get(url);
  expect(res.status()).toBe(404);
  expect(res.headers()["content-disposition"]).toBeUndefined();
  const body = await res.text();
  for (const s of secrets) expect(body).not.toContain(s);
}

/** A new member joins `slug` on a fresh, single-use invite. */
async function joinCamp(
  leadPage: Page,
  memberPage: Page,
  slug: string,
): Promise<void> {
  const invite = await inviteToCamp(leadPage, slug, "member");
  await joinByInvite(memberPage, invite.url);
}

test.describe("camp lead — member records", () => {
  test("the lead keeps private notes on a member; only note people see them", async ({
    makeAppPage,
  }) => {
    test.setTimeout(300_000);
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const keeperPage = await makeAppPage("web");
    const memberName = uniqueUsername("notes_jabu");
    const keeperName = uniqueUsername("notes_ren");
    const noteText = noteBody("Great on build week");
    const editedText = `${noteText}, needs a lift from Cape Town`;
    const keeperText = noteBody("Asked not to be on night shifts");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinCamp(leadPage, memberPage, camp.slug);
    await signUpBurner(keeperPage, { onboard: true, username: keeperName });
    await joinCamp(leadPage, keeperPage, camp.slug);

    const memberId = await burnerIdFromRoster(leadPage, camp.slug, memberName);

    // --- The lead: empty card, then add ------------------------------------
    await gotoProfile(leadPage, memberId, memberName);
    const card = leadPage.getByTestId("private-notes");
    await expect(card).toBeVisible();
    await expect(card).toContainText(`About ${memberName}, kept by the camp.`);
    await expect(card.getByText(AUDIENCE_LINE)).toBeVisible();
    await expect(card.getByText("No notes yet")).toBeVisible();
    await expect(card.getByText("0 / 2,000")).toBeVisible();

    await addNote(card, noteText);
    await expect(card.getByText("No notes yet")).toHaveCount(0);

    // --- Edit own note --------------------------------------------------------
    await card
      .getByTestId("private-note")
      .filter({ hasText: noteText })
      .getByRole("button", { name: /^edit note/i })
      .click();
    const editor = card.getByLabel("Edit note");
    await editor.fill(editedText);
    await expect(card.getByText(`${editedText.length} / 2,000`)).toBeVisible();
    await card.getByRole("button", { name: "Save" }).click();
    const edited = card
      .getByTestId("private-note")
      .filter({ hasText: editedText });
    await expect(edited).toBeVisible();
    await expect(edited).toContainText("edited");
    // Survives a reload: it is stored, not just client state.
    await gotoProfile(leadPage, memberId, memberName);
    await expect(edited).toBeVisible();

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

    // The note-keeper writes one of their own: edit and delete on it.
    const keepersNote = await addNote(keeperCard, keeperText);
    await expect(
      keepersNote.getByRole("button", { name: /^edit note/i }),
    ).toBeVisible();
    await expect(
      keepersNote.getByRole("button", { name: /^delete note/i }),
    ).toBeVisible();
    // Newest first.
    await expect(keeperCard.getByTestId("private-note").first()).toContainText(
      keeperText,
    );

    // The roster counts both for the lead.
    await gotoRoster(leadPage, camp.slug);
    await expect(
      rosterRow(leadPage, memberName).getByTestId("roster-note-count"),
    ).toContainText("Notes 2");

    // --- The lead deletes both — their own and the keeper's -------------------
    await gotoProfile(leadPage, memberId, memberName);
    const keepersAsLead = leadPage
      .getByTestId("private-note")
      .filter({ hasText: keeperText });
    await expect(keepersAsLead).toBeVisible();
    // Not theirs to edit, but a lead may delete it.
    await expect(
      keepersAsLead.getByRole("button", { name: /^edit note/i }),
    ).toHaveCount(0);
    await deleteNote(keepersAsLead);
    await expect(keepersAsLead).toHaveCount(0);

    const leadNote = leadPage
      .getByTestId("private-note")
      .filter({ hasText: editedText });
    await deleteNote(leadNote);
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

  test("a lead of another camp never sees this camp's notes", async ({
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    const leadPage = await makeAppPage("web");
    const otherLeadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const memberName = uniqueUsername("notes_two_camps");
    const noteText = noteBody("Camp A only");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    await signUpBurner(otherLeadPage, { onboard: true });
    const otherCamp = await createCamp(otherLeadPage);
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinCamp(leadPage, memberPage, camp.slug);

    const memberId = await burnerIdFromRoster(leadPage, camp.slug, memberName);
    await gotoProfile(leadPage, memberId, memberName);
    await addNote(leadPage.getByTestId("private-notes"), noteText);

    // A stranger's lead: the profile renders, no card, no text.
    await gotoProfile(otherLeadPage, memberId, memberName);
    await expect(otherLeadPage.getByTestId("private-notes")).toHaveCount(0);
    await expect(otherLeadPage.getByText(noteText)).toHaveCount(0);

    // The member joins the other camp too. Its lead now gets THEIR camp's
    // card — empty — and still never camp A's note.
    await joinCamp(otherLeadPage, memberPage, otherCamp.slug);
    await gotoProfile(otherLeadPage, memberId, memberName);
    const otherCard = otherLeadPage.getByTestId("private-notes");
    await expect(otherCard).toHaveCount(1);
    await expect(otherCard.getByText("No notes yet")).toBeVisible();
    await expect(otherLeadPage.getByText(noteText)).toHaveCount(0);

    // And camp A's roster still counts only its own.
    await gotoRoster(leadPage, camp.slug);
    await expect(
      rosterRow(leadPage, memberName).getByTestId("roster-note-count"),
    ).toContainText("Notes 1");
  });

  test("a lead or captain exports a member's notes for a POPIA request; nobody else can", async ({
    makeAppPage,
  }) => {
    test.setTimeout(360_000);
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const keeperPage = await makeAppPage("web");
    const otherLeadPage = await makeAppPage("web");
    const captainPage = await makeAppPage("web");
    const leadName = uniqueUsername("export_lead");
    const captainName = uniqueUsername("export_captain");
    const memberName = uniqueUsername("export_jabu");
    const keeperName = uniqueUsername("export_ren");
    const firstText = noteBody("Great on build week");
    const secondText = noteBody("Asked for a quiet tent spot");

    await signUpBurner(leadPage, { onboard: true, username: leadName });
    const camp = await createCamp(leadPage);
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinCamp(leadPage, memberPage, camp.slug);
    await signUpBurner(keeperPage, { onboard: true, username: keeperName });
    await joinCamp(leadPage, keeperPage, camp.slug);
    await signUpBurner(captainPage, { onboard: true, username: captainName });
    await joinCamp(leadPage, captainPage, camp.slug);
    await signUpBurner(otherLeadPage, { onboard: true });
    await createCamp(otherLeadPage);

    const memberId = await burnerIdFromRoster(leadPage, camp.slug, memberName);
    const exportUrl = `/camps/${camp.slug}/member-notes/${memberId}/export`;

    // --- The lead writes two notes, then exports -----------------------------
    await gotoProfile(leadPage, memberId, memberName);
    const card = leadPage.getByTestId("private-notes");
    await addNote(card, firstText);
    await addNote(card, secondText);

    const download = await exportNotes(leadPage, card);
    expect(download.suggestedFilename()).toMatch(
      /^member-notes-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.txt$/,
    );
    const file = await readFile(await download.path(), "utf8");
    expect(file).toContain(`Private notes kept by ${camp.name}`);
    expect(file).toContain(`About: ${memberName}`);
    expect(file).toContain("section 23 of the Protection of Personal Information Act (POPIA)");
    // Both notes, oldest first.
    expect(file).toContain(firstText);
    expect(file).toContain(secondText);
    expect(file.indexOf(firstText)).toBeLessThan(file.indexOf(secondText));
    expect(file).toContain("--- Note 2 of 2 ---");
    // No author: the lead's name is nowhere in the file.
    expect(file).not.toContain(leadName);
    await expect(leadPage.getByText("Notes exported")).toBeVisible();

    // --- A note-keeper who is not a lead: card yes, export no ----------------
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
    // PRESENT first: the card and the lead's note render for the keeper...
    await expect(
      keeperCard.getByTestId("private-note").filter({ hasText: firstText }),
    ).toBeVisible();
    // ...and the export action does not.
    await expect(
      keeperCard.getByRole("button", { name: EXPORT_BUTTON }),
    ).toHaveCount(0);
    // The route refuses them directly too — UI hiding is not the boundary.
    await expectExportRefused(keeperPage, exportUrl, [firstText, secondText]);

    // --- The member themself, and a lead of another camp: refused ------------
    await expectExportRefused(memberPage, exportUrl, [firstText, secondText]);
    await expectExportRefused(otherLeadPage, exportUrl, [firstText, secondText]);

    // --- A captain of the camp (Ryan, 18 Oct 2026): may export ---------------
    // A plain member until the lead gives them the camp's Captain role.
    await assignRoleToMember(leadPage, camp.slug, captainName, "Captain");
    await gotoProfile(captainPage, memberId, memberName);
    const captainCard = captainPage.getByTestId("private-notes");
    await expect(
      captainCard.getByTestId("private-note").filter({ hasText: firstText }),
    ).toBeVisible();
    // Hydrate the card the way a person would before clicking: type into the
    // add form (and clear it) until React holds the text.
    const captainField = captainCard.getByLabel("Add a note");
    await expect(async () => {
      await captainField.fill("x");
      await expect(
        captainCard.getByRole("button", { name: "Add note" }),
      ).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await captainField.fill("");
    const captainDownload = await exportNotes(captainPage, captainCard);
    const captainFile = await readFile(await captainDownload.path(), "utf8");
    expect(captainFile).toContain(firstText);
    expect(captainFile).toContain(secondText);
    expect(captainFile).not.toContain(leadName);

    // The lead still can, straight off the route (the refusals above are not
    // a broken route).
    const direct = await leadPage.request.get(exportUrl);
    expect(direct.status()).toBe(200);
    expect(direct.headers()["cache-control"]).toContain("no-store");
    expect(await direct.text()).toContain(firstText);
  });

  test("similar names are flagged as a possible duplicate; the count chip is for note people only", async ({
    makeAppPage,
  }) => {
    test.setTimeout(300_000);
    const leadPage = await makeAppPage("web");
    const firstPage = await makeAppPage("web");
    const secondPage = await makeAppPage("web");
    const readerPage = await makeAppPage("web");
    // One long shared word and a one-letter tail: trigram similarity ~0.76,
    // over the 0.55 threshold. Random, because usernames are globally unique.
    const stem = `t${randomBytes(8).toString("hex").slice(0, 13)}`;
    const firstName = `${stem}_a`;
    const secondName = `${stem}_b`;
    const readerName = uniqueUsername("roster_reader");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    await signUpBurner(firstPage, { onboard: true, username: firstName });
    await joinCamp(leadPage, firstPage, camp.slug);
    await signUpBurner(secondPage, { onboard: true, username: secondName });
    await joinCamp(leadPage, secondPage, camp.slug);
    await signUpBurner(readerPage, { onboard: true, username: readerName });
    await joinCamp(leadPage, readerPage, camp.slug);

    // A roster viewer WITHOUT member_notes.
    const roleName = uniqueName("Roster");
    await createCustomRole(leadPage, camp.slug, {
      name: roleName,
      emoji: "📋",
      colorLabel: "Teal",
      privileges: ["Can see private member info"],
    });
    await assignRoleToMember(leadPage, camp.slug, readerName, roleName);

    // The lead keeps one note on the first member.
    const firstId = await burnerIdFromRoster(leadPage, camp.slug, firstName);
    await gotoProfile(leadPage, firstId, firstName);
    await addNote(leadPage.getByTestId("private-notes"), noteBody("Duplicate?"));

    // --- The lead: count chip and both duplicate chips ------------------------
    await gotoRoster(leadPage, camp.slug);
    await expect(
      rosterRow(leadPage, firstName).getByTestId("roster-note-count"),
    ).toContainText("Notes 1");
    await expect(
      rosterRow(leadPage, firstName).getByTestId("roster-possible-duplicate"),
    ).toBeVisible();
    await expect(
      rosterRow(leadPage, secondName).getByTestId("roster-possible-duplicate"),
    ).toBeVisible();
    // The reader is not similar to anyone.
    await expect(
      rosterRow(leadPage, readerName).getByTestId("roster-possible-duplicate"),
    ).toHaveCount(0);

    // --- The roster reader: duplicate hints yes, note count no ----------------
    await gotoRoster(readerPage, camp.slug);
    const readerFirstRow = rosterRow(readerPage, firstName);
    await expect(
      readerFirstRow.getByTestId("roster-possible-duplicate"),
    ).toBeVisible();
    await expect(readerPage.getByTestId("roster-note-count")).toHaveCount(0);
    // ...and no card on the profile either.
    await gotoProfile(readerPage, firstId, firstName);
    await expect(readerPage.getByTestId("private-notes")).toHaveCount(0);

    // --- Dismiss ---------------------------------------------------------------
    await gotoRoster(leadPage, camp.slug);
    const firstChip = rosterRow(leadPage, firstName).getByTestId(
      "roster-possible-duplicate",
    );
    await firstChip.click();
    const popover = leadPage.getByRole("dialog");
    await expect(
      popover.getByText(
        `${secondName} and ${firstName} have similar names. They may be one person with two accounts.`,
      ),
    ).toBeVisible();
    await expect(
      popover.getByText(
        "This is only a hint from the names. Nothing is merged or changed.",
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
    // Stays gone after a reload — it is stored, not client state.
    await gotoRoster(leadPage, camp.slug);
    await expect(rosterRow(leadPage, secondName)).toBeVisible();
    await expect(
      leadPage
        .getByTestId("roster-possible-duplicate")
        .filter({ visible: true }),
    ).toHaveCount(0);
    // ...and for the whole camp: the reader's roster too.
    await gotoRoster(readerPage, camp.slug);
    await expect(rosterRow(readerPage, secondName)).toBeVisible();
    await expect(
      readerPage
        .getByTestId("roster-possible-duplicate")
        .filter({ visible: true }),
    ).toHaveCount(0);
  });

  test("archiving keeps a member's notes; leaving the camp deletes them", async ({
    makeAppPage,
  }) => {
    test.setTimeout(300_000);
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const memberName = uniqueUsername("notes_former");
    const noteText = noteBody("Brings the shade cloth");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinCamp(leadPage, memberPage, camp.slug);

    const memberId = await burnerIdFromRoster(leadPage, camp.slug, memberName);
    await gotoProfile(leadPage, memberId, memberName);
    await addNote(leadPage.getByTestId("private-notes"), noteText);

    // --- Archive: the notes stay -----------------------------------------------
    await gotoRoster(leadPage, camp.slug);
    await confirmRowAction(leadPage, memberName, "Archive");
    await gotoProfile(leadPage, memberId, memberName);
    await expect(
      leadPage.getByTestId("private-note").filter({ hasText: noteText }),
    ).toBeVisible();

    // Restored, they come back with their notes.
    await gotoRoster(leadPage, camp.slug, "?status=former");
    await confirmRowAction(leadPage, memberName, "Restore");
    await gotoRoster(leadPage, camp.slug);
    await expect(
      rosterRow(leadPage, memberName).getByTestId("roster-note-count"),
    ).toContainText("Notes 1");

    // --- Leave: the notes go ---------------------------------------------------
    await memberPage.goto(`/camps/${camp.slug}`);
    await memberPage.getByRole("button", { name: /leave camp/i }).click();
    await memberPage.getByRole("button", { name: /^leave$/i }).click();
    await memberPage.waitForURL(/\/directory\/?$/);
    await expect(memberPage.getByText(/you['’]ve left the camp/i)).toBeVisible();

    // No shared camp: no card at all.
    await gotoProfile(leadPage, memberId, memberName);
    await expect(leadPage.getByTestId("private-notes")).toHaveCount(0);
    await expect(leadPage.getByText(noteText)).toHaveCount(0);

    // They rejoin: the card is back, and empty — the note was deleted, not
    // merely hidden.
    await joinCamp(leadPage, memberPage, camp.slug);
    await gotoProfile(leadPage, memberId, memberName);
    const card = leadPage.getByTestId("private-notes");
    await expect(card.getByText("No notes yet")).toBeVisible();
    await expect(leadPage.getByText(noteText)).toHaveCount(0);
    await gotoRoster(leadPage, camp.slug);
    await expect(rosterRow(leadPage, memberName)).toBeVisible();
    await expect(
      rosterRow(leadPage, memberName).getByTestId("roster-note-count"),
    ).toHaveCount(0);
  });
});

/**
 * Run a roster row's archive/restore action through its inline confirm.
 * Opened until the confirm shows: a click that lands before hydration does
 * nothing. (The same flow as former-members.spec.ts.)
 */
async function confirmRowAction(
  page: Page,
  name: string,
  mode: "Archive" | "Restore",
): Promise<void> {
  const row = rosterRow(page, name);
  const prompt =
    mode === "Archive"
      ? /they lose access to the camp\. sure\?/i
      : /they come back as a member, without their old roles\. sure\?/i;
  await expect(async () => {
    await row.getByRole("button", { name: `${mode} ${name}` }).click();
    await expect(row.getByText(prompt)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await row.getByRole("button", { name: mode, exact: true }).click();
  await expect(
    page.getByText(
      mode === "Archive"
        ? `${name} is now a former member`
        : `${name} is back in the camp`,
    ),
  ).toBeVisible();
}
