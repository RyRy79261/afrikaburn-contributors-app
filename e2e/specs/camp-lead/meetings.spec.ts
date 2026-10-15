// specs/camp-lead/meetings.spec.ts
//
// Persona: CAMP LEAD (+ two members and a stranger) — camp meetings and the
// camp calendar (docs/camp-meetings-spec.md).
//
// One journey, because each step only means something against the state the
// one before it left:
//
//   1. The lead makes a "Kitchen" role and gives it to member A (not B). The
//      camp page's Meetings tile leads to an empty list.
//   2. The lead schedules a meeting for Kitchen only. The form's reach line
//      counts A and the lead; the page shows Join call as a plain external
//      link (rel="noopener noreferrer").
//   3. A sees it in the list, on the calendar and in the notices, and can
//      download its .ics; A has no Edit or Cancel.
//   4. B — a member outside the audience — gets the 404 an unknown meeting
//      gets, for the page and the .ics, and the list does not name it.
//   5. The lead writes the notes (autosave) and ticks A as came; A reads both.
//   6. The lead cancels it: it stays readable, moves to Past and cancelled,
//      offers no .ics, and A is told.
//   7. A stranger gets the camp's not-found for Meetings and the calendar.
//
// Selector provenance (verified against source on 2026-10-15):
//   tile ............ apps/web/components/meetings/meetings-tile.tsx
//   list / rows ..... apps/web/app/(app)/camps/[slug]/meetings/page.tsx,
//                     apps/web/components/meetings/meeting-row.tsx
//   form ............ apps/web/components/meetings/meeting-form.tsx
//   meeting page .... apps/web/app/(app)/camps/[slug]/meetings/[id]/page.tsx,
//                     apps/web/components/meetings/{meeting-notes,who-came,
//                     cancel-meeting}.tsx
//   calendar ........ apps/web/components/meetings/camp-calendar.tsx

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

test.describe("camp lead — meetings", () => {
  test("a lead schedules a meeting for one role; only that role sees it", async ({
    makeAppPage,
  }) => {
    test.setTimeout(300_000);

    const leadPage = await makeAppPage("web");
    const aPage = await makeAppPage("web");
    const bPage = await makeAppPage("web");
    const strangerPage = await makeAppPage("web");
    const aName = uniqueUsername("meet_jabu");
    const bName = uniqueUsername("meet_lerato");
    const roleName = uniqueName("Kitchen");
    const title = uniqueName("Kitchen team menu");
    const notesMarker = `Buy rooibos ${Date.now().toString(36)}`;

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const inviteA = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(aPage, { onboard: true, username: aName });
    await joinByInvite(aPage, inviteA.url);
    const inviteB = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(bPage, { onboard: true, username: bName });
    await joinByInvite(bPage, inviteB.url);
    await signUpBurner(strangerPage, { onboard: true });

    // ── 1. A role for A only; the empty list ─────────────────────────────
    await createCustomRole(leadPage, camp.slug, {
      name: roleName,
      emoji: "🍳",
      colorLabel: "Teal",
    });
    await assignRoleToMember(leadPage, camp.slug, aName, roleName);

    await leadPage.goto(`/camps/${camp.slug}`);
    await leadPage.getByRole("link", { name: "All meetings" }).click();
    await expect(
      leadPage.getByRole("heading", { level: 1, name: "Meetings" }),
    ).toBeVisible();
    await expect(leadPage.getByText("No meetings yet")).toBeVisible();

    // ── 2. Schedule it, for the Kitchen role ─────────────────────────────
    await leadPage
      .getByRole("link", { name: "Schedule meeting" })
      .first()
      .click();
    await expect(
      leadPage.getByRole("heading", { name: "Schedule a meeting" }),
    ).toBeVisible();
    await leadPage.getByLabel("Title").fill(title);
    await leadPage.getByLabel("Date").fill("2027-03-21");
    await leadPage.getByLabel("Start time").fill("18:30");
    await leadPage
      .getByLabel("Call link")
      .fill("https://meet.example.com/mad-hatters");
    await leadPage.getByRole("button", { name: "Chosen roles" }).click();
    await leadPage.getByRole("button", { name: roleName }).click();
    // A and the lead: B is in no chosen role.
    await expect(leadPage.getByText(/shows to\s*2 members/i)).toBeVisible();
    await leadPage.getByRole("button", { name: "Schedule meeting" }).click();

    await expect(
      leadPage.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    const meetingUrl = new URL(leadPage.url()).pathname;
    expect(meetingUrl).toMatch(
      new RegExp(`^/camps/${camp.slug}/meetings/[0-9a-f-]{36}$`),
    );
    const join = leadPage.getByRole("link", { name: "Join call" });
    await expect(join).toHaveAttribute(
      "href",
      "https://meet.example.com/mad-hatters",
    );
    await expect(join).toHaveAttribute("rel", "noopener noreferrer");
    await expect(leadPage.getByText("Sunday 21 March 2027")).toBeVisible();

    // ── 3. A sees it ─────────────────────────────────────────────────────
    await aPage.goto(`/camps/${camp.slug}/meetings`);
    await expect(
      aPage.getByRole("heading", { level: 1, name: "Meetings" }),
    ).toBeVisible();
    await aPage.getByRole("link", { name: title }).click();
    await expect(
      aPage.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(aPage.getByRole("link", { name: "Join call" })).toBeVisible();
    await expect(aPage.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(
      aPage.getByRole("button", { name: "Cancel meeting" }),
    ).toHaveCount(0);

    const ics = await aPage.request.get(`${meetingUrl}/ics`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    expect(await ics.text()).toContain("BEGIN:VEVENT");

    await aPage.goto(`/camps/${camp.slug}/calendar?month=2027-03`);
    await expect(
      aPage.getByRole("heading", { level: 2, name: "March 2027" }),
    ).toBeVisible();
    await expect(
      aPage.getByRole("link", { name: new RegExp(title) }),
    ).toBeVisible();

    await aPage.goto("/notifications");
    await expect(
      aPage.getByRole("heading", { name: /^notifications$/i }),
    ).toBeVisible();
    await expect(
      aPage.getByText(`scheduled ${title}`, { exact: false }),
    ).toBeVisible();

    // ── 4. B is outside the audience ─────────────────────────────────────
    await bPage.goto(`/camps/${camp.slug}/meetings`);
    await expect(bPage.getByText("Nothing scheduled yet")).toBeVisible();
    await expect(bPage.getByText(title)).toHaveCount(0);
    await expectServerNotFound(bPage, meetingUrl, [title]);
    const bIcs = await bPage.request.get(`${meetingUrl}/ics`);
    expect(bIcs.status()).toBe(404);
    expect(await bIcs.text()).not.toContain(title);

    // ── 5. Notes (autosave) and who came ─────────────────────────────────
    await leadPage.getByRole("button", { name: "Edit notes" }).click();
    const notes = leadPage.getByRole("textbox", { name: "Meeting notes" });
    await notes.click();
    await leadPage.keyboard.type(notesMarker);
    await expect(leadPage.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await leadPage.getByRole("button", { name: "Done" }).click();
    await expect(leadPage.getByText(notesMarker)).toBeVisible();
    await expect(leadPage.getByText(/last edited by/i)).toBeVisible();

    const tick = leadPage.getByRole("checkbox", { name: aName });
    await expect(tick).not.toBeChecked();
    await tick.check();
    await expect(leadPage.getByText(/1 of 2/)).toBeVisible();
    // The tick is optimistic: prove it reached the server before A looks.
    await expect(tick).toBeEnabled();
    await leadPage.reload();
    await expect(
      leadPage.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(tick).toBeChecked();

    await aPage.goto(meetingUrl);
    await expect(
      aPage.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(aPage.getByText(notesMarker)).toBeVisible();
    await expect(aPage.getByText("1 came")).toBeVisible();
    // A reads the list; only note-takers get tick boxes.
    await expect(aPage.getByRole("checkbox")).toHaveCount(0);

    // ── 6. Cancel ────────────────────────────────────────────────────────
    await leadPage.reload();
    await leadPage.getByRole("button", { name: "Cancel meeting" }).click();
    const dialog = leadPage.getByRole("dialog", {
      name: "Cancel this meeting?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel meeting" }).click();
    await expect(leadPage.getByText(/^Cancelled on /)).toBeVisible();
    await expect(leadPage.getByText(notesMarker)).toBeVisible();
    await expect(
      leadPage.getByRole("link", { name: "Add to my calendar" }),
    ).toHaveCount(0);
    expect((await leadPage.request.get(`${meetingUrl}/ics`)).status()).toBe(
      404,
    );

    await leadPage.goto(`/camps/${camp.slug}/meetings`);
    await expect(
      leadPage.getByRole("heading", { name: "Past and cancelled" }),
    ).toBeVisible();
    await expect(leadPage.getByRole("link", { name: title })).toBeVisible();

    await aPage.goto("/notifications");
    await expect(
      aPage.getByRole("heading", { name: /^notifications$/i }),
    ).toBeVisible();
    await expect(
      aPage.getByText(`cancelled ${title}`, { exact: false }),
    ).toBeVisible();

    // ── 7. A stranger ────────────────────────────────────────────────────
    await expectServerNotFound(strangerPage, `/camps/${camp.slug}/meetings`);
    await expectServerNotFound(strangerPage, `/camps/${camp.slug}/calendar`);
    await expectServerNotFound(strangerPage, meetingUrl, [title]);
  });
});
