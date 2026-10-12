// specs/camp-lead/work-access-passes.spec.ts
//
// Persona: CAMP LEAD (+ members, an art project's lead, and org staff) — Work
// Access Passes, epic #53 (docs/wap-spec.md).
//
// The round trip, in one journey because each step only means something
// against the state the one before it left:
//
//   1. Org staff open WAP requests for the edition (idempotent across workers:
//      the window is edition-wide, and opening twice is refused).
//   2. The camp lead finds the Passes tile, asks for 3 passes; "Ask for more"
//      is disabled while that ask waits.
//   3. The org grants 2 — fewer than asked. The lead is told so.
//   4. The lead names two members. A second, stale tab tries to name a third
//      and the SERVER refuses it (the cap is re-checked under the registration
//      row lock, not just by the disabled picker).
//   5. An art project — a second project kind — asks, is granted, and names one
//      of the camp's members too. Both leads see "Also has a pass from {the
//      other project}" next to that person, and only that person.
//   6. Submit locks the list; a member on it sees it is with AfrikaBurn.
//   7. The org returns it with a note; the lead sees the note, edits a pass
//      (shown as edited) and submits again.
//   8. The org approves. A member on the list sees their approved pass; a member
//      not on it sees no pass line.
//   9. The export CSV holds the names and the duplicate note, and its columns
//      are exactly the declared set — no phone, emergency contact, ID or medical.
//
// A second test covers who is refused the lead's page: a plain member and a
// stranger both get the project's ordinary not-found.
//
// Selector provenance (read from source 2026-10-13):
//   lead page ....... apps/web/app/(app)/_project-passes/passes-page.tsx
//   ask form ........ apps/web/components/passes/request-block.tsx
//   list / add ...... apps/web/components/passes/{pass-list-table,add-member-form,edit-pass-dialog}.tsx
//   tile / own line . apps/web/components/passes/passes-tile.tsx
//   org overview .... apps/org/app/(console)/registrations/passes/page.tsx
//   org panel ....... apps/org/app/(console)/registrations/[id]/passes/page.tsx,
//                     apps/org/components/passes/{grant-request,list-decision,wap-window-control}.tsx
//   export .......... apps/org/app/api/registrations/passes/export/route.ts

import { test, expect, skipUnlessGod } from "../../fixtures";
import type { Locator, Page } from "@playwright/test";
import {
  signUpBurner,
  signInAs,
  createCamp,
  createArtProject,
  inviteToCamp,
  joinByInvite,
  submitRegistration,
} from "../../personas/factories";
import { uniqueUsername } from "../../lib/identity";
import { appAlerts } from "../../lib/dom";
import { expectServerNotFound } from "../camp-member/support";
import { provisionOrgStaff } from "../org-staff/_helpers";

const CAP_REACHED =
  "Every granted pass is already allocated. Ask for more, or take someone off the list.";
const PENDING_EXISTS =
  "You can ask again once AfrikaBurn answers the request that's waiting.";

/** The rows of the pass list (desktop table row or phone card) for one name.
 * ResponsiveDataTable renders both layouts; only the visible one counts. */
function passRow(page: Page, name: string): Locator {
  return page
    .locator("table tr, ul[aria-label='Work Access Pass list'] > li")
    .filter({ hasText: name })
    .filter({ visible: true });
}

/** Open WAP requests if they are not open already. The window is
 * edition-wide and other workers may race to open it; whoever wins, the
 * outcome checked is the same — the overview offers "Close requests". */
async function ensureRequestsOpen(org: Page): Promise<void> {
  await org.goto("/registrations/passes");
  await expect(
    org.getByRole("heading", { name: "Work Access Passes" }),
  ).toBeVisible();
  const close = org.getByRole("button", { name: "Close requests" });
  const open = org.getByRole("button", { name: "Open requests" });
  await expect(close.or(open)).toBeVisible();
  if (await open.isVisible()) {
    await open.click();
    await org.getByRole("button", { name: "Open and notify" }).click();
    await expect(
      org
        .getByText("Requests are open. The projects' leads have been told.")
        .or(org.getByText("Could not change requests")),
    ).toBeVisible();
    await org.reload();
  }
  await expect(close).toBeVisible();
}

/** From the org overview, open one project's Work Access Passes panel. */
async function openOrgPanel(org: Page, projectName: string): Promise<string> {
  await org.goto("/registrations/passes");
  await expect(
    org.getByRole("heading", { name: "Work Access Passes" }),
  ).toBeVisible();
  await org
    .getByRole("link", { name: projectName, exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await org.waitForURL(/\/registrations\/[0-9a-f-]{36}\/passes$/i);
  return org.url();
}

/** Grant the pending request on an open org panel. */
async function grant(org: Page, n: number): Promise<void> {
  await org.getByLabel("Passes to grant").fill(String(n));
  await org.getByRole("button", { name: `Grant ${n}` }).click();
  await expect(org.getByText(`Granted ${n}`, { exact: true })).toBeVisible();
}

/** Ask for passes on the lead's page (the form is open for a first ask). */
async function askForPasses(
  page: Page,
  n: number,
  reason: string,
): Promise<void> {
  const count = page.getByRole("spinbutton", { name: /how many passes/i });
  await expect(count).toBeVisible();
  await count.fill(String(n));
  await page.getByRole("textbox", { name: /why does the/i }).fill(reason);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(`${n} more`, { exact: true })).toBeVisible();
}

/** "Choose a member…" → "Add to the list", settled on the row appearing. */
async function addToList(page: Page, name: string): Promise<void> {
  await page.getByRole("combobox", { name: "Choose a member" }).click();
  await page.getByRole("option", { name, exact: true }).click();
  await page.getByRole("button", { name: "Add to the list" }).click();
  await expect(passRow(page, name)).toBeVisible();
}

async function notificationTitles(page: Page): Promise<Page> {
  await page.goto("/notifications");
  await expect(
    page.getByRole("heading", { level: 1, name: "Notifications" }),
  ).toBeVisible();
  return page;
}

/** An art project that is SUBMITTED — passes need a submitted registration.
 * The fields are what `artworkSubmitGate` asks for. */
async function submittedArtProject(
  page: Page,
): Promise<{ name: string; slug: string }> {
  const art = await createArtProject(page);
  await page.goto(`/artworks/${art.slug}/edit`);
  await page.getByLabel("Artist or collective").fill("Karoo Collective");
  await page
    .getByLabel("Description")
    .fill("A steel baobab whose branches whisper recordings of the Karoo.");
  await page.getByLabel("Width (m)").fill("6");
  await page.getByLabel("Depth (m)").fill("6");
  await page.getByLabel("Height (m)").fill("9");
  await page
    .getByRole("group", { name: "Will this artwork be burned?" })
    .getByRole("button", { name: "No", exact: true })
    .click();
  await page
    .getByLabel("Build plan")
    .fill("Prefabricated in Cape Town, bolted together over three days.");
  await page
    .getByLabel("Strike & Leave No Trace plan")
    .fill("Unbolted and trucked out; the site is raked and MOOP-swept.");
  await page.getByRole("button", { name: /^submit project$/i }).click();
  await page.waitForURL(/\/camps\/[^/]+$/);
  await expect(page.getByText(/submitted/i).first()).toBeVisible();
  return art;
}

test.describe("camp lead — work access passes", () => {
  test("org opens requests, grants fewer, lead allocates, submits, is returned, resubmits, org approves", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(600_000);

    const leadPage = await makeAppPage("web");
    const m1Page = await makeAppPage("web");
    const m2Page = await makeAppPage("web");
    const m3Page = await makeAppPage("web");
    const artPage = await makeAppPage("web");
    const m1 = uniqueUsername("wap_thandi");
    const m2 = uniqueUsername("wap_pieter");
    const m3 = uniqueUsername("wap_nomsa");

    // ── Setup: a submitted camp with three members ──────────────────────
    const leadAccount = await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    for (const [page, username] of [
      [m1Page, m1],
      [m2Page, m2],
      [m3Page, m3],
    ] as const) {
      // One invite at a time: each is read from the newest <code>.
      const invite = await inviteToCamp(leadPage, camp.slug, "member");
      await signUpBurner(page, { onboard: true, username });
      await joinByInvite(page, invite.url);
    }
    await submitRegistration(leadPage, camp.slug);

    // A submitted art project whose crew includes m2.
    await signUpBurner(artPage, { onboard: true });
    const art = await submittedArtProject(artPage);
    const artInvite = await inviteToCamp(artPage, art.slug, "member");
    await joinByInvite(m2Page, artInvite.url);

    // ── 1. The org opens requests ────────────────────────────────────────
    const staff = await provisionOrgStaff(makeAppPage);
    const org = staff.org;
    await ensureRequestsOpen(org);

    // ── 2. The lead asks for 3 ──────────────────────────────────────────
    await leadPage.goto(`/camps/${camp.slug}`);
    await leadPage.getByRole("link", { name: /open passes/i }).click();
    await expect(leadPage).toHaveURL(new RegExp(`/camps/${camp.slug}/passes$`));
    await expect(
      leadPage.getByRole("heading", { level: 1, name: "Work Access Passes" }),
    ).toBeVisible();
    await expect(leadPage.getByText("Requests open").first()).toBeVisible();
    await askForPasses(leadPage, 3, "Our dome takes three days to raise.");
    // A second ask waits on the first, in the core rule's own words.
    await expect(leadPage.getByText(PENDING_EXISTS)).toBeVisible();
    await expect(
      leadPage
        .getByRole("button", { name: "Ask for more" })
        .filter({ visible: true }),
    ).toBeDisabled();

    // ── 3. The org grants 2 of 3 ────────────────────────────────────────
    const campPanel = await openOrgPanel(org, camp.name);
    await expect(org.getByText("Asks for 3", { exact: true })).toBeVisible();
    await expect(
      org.getByText("“Our dome takes three days to raise.”"),
    ).toBeVisible();
    await grant(org, 2);

    await notificationTitles(leadPage);
    await expect(
      leadPage.getByText(
        "AfrikaBurn granted 2 Work Access Passes (you asked for 3)",
      ),
    ).toBeVisible();

    // ── 4. The lead names two members; the third is refused ─────────────
    const passesUrl = `/camps/${camp.slug}/passes`;
    await leadPage.goto(passesUrl);
    await expect(
      leadPage.getByRole("progressbar", { name: "Passes allocated" }),
    ).toHaveAttribute("aria-valuemax", "2");
    await addToList(leadPage, m1);

    // A second tab, loaded while one pass is still free.
    const staleTab = await makeAppPage("web");
    await signInAs(staleTab, leadAccount);
    await staleTab.goto(passesUrl);
    await expect(passRow(staleTab, m1)).toBeVisible();
    await expect(
      staleTab.getByRole("combobox", { name: "Choose a member" }),
    ).toBeEnabled();

    await addToList(leadPage, m2);
    await expect(
      leadPage.getByRole("progressbar", { name: "Passes allocated" }),
    ).toHaveAttribute("aria-valuenow", "2");
    // The picker is closed, with the reason.
    await expect(leadPage.getByText(CAP_REACHED)).toBeVisible();
    await expect(
      leadPage.getByRole("combobox", { name: "Choose a member" }),
    ).toBeDisabled();

    // The stale tab still offers m3 — the SERVER has to say no.
    await staleTab.getByRole("combobox", { name: "Choose a member" }).click();
    await staleTab.getByRole("option", { name: m3, exact: true }).click();
    await staleTab.getByRole("button", { name: "Add to the list" }).click();
    await expect(
      appAlerts(staleTab).filter({ hasText: CAP_REACHED }),
    ).toBeVisible();
    await leadPage.reload();
    await expect(passRow(leadPage, m2)).toBeVisible();
    await expect(
      leadPage.getByRole("progressbar", { name: "Passes allocated" }),
    ).toHaveAttribute("aria-valuenow", "2");
    await expect(passRow(leadPage, m3)).toHaveCount(0);

    // ── 5. An art project holds m2 too ──────────────────────────────────
    // A camp URL for an art project lands on the artwork route.
    await artPage.goto(`/camps/${art.slug}/passes`);
    await expect(artPage).toHaveURL(
      new RegExp(`/artworks/${art.slug}/passes$`),
    );
    await expect(
      artPage.getByRole("heading", { level: 1, name: "Work Access Passes" }),
    ).toBeVisible();
    await askForPasses(artPage, 1, "The welder needs to be on site early.");
    await openOrgPanel(org, art.name);
    await expect(org.getByText("Asks for 1", { exact: true })).toBeVisible();
    await grant(org, 1);
    await artPage.reload();
    await addToList(artPage, m2);
    await expect(passRow(artPage, m2)).toContainText(
      `Also has a pass from ${camp.name}`,
    );

    await leadPage.reload();
    await expect(passRow(leadPage, m2)).toContainText(
      `Also has a pass from ${art.name}`,
    );
    // Only next to that person.
    await expect(passRow(leadPage, m1)).toBeVisible();
    await expect(passRow(leadPage, m1)).not.toContainText("Also has a pass");

    // ── 6. Submit locks the list ────────────────────────────────────────
    await leadPage
      .getByRole("button", { name: "Submit to AfrikaBurn" })
      .click();
    await expect(
      leadPage.getByText(
        /The list can't change until AfrikaBurn approves it or sends it back\./,
      ),
    ).toBeVisible();
    await expect(passRow(leadPage, m1)).toBeVisible();
    await expect(
      leadPage.getByRole("button", { name: "Add to the list" }),
    ).toHaveCount(0);
    await expect(
      leadPage.getByRole("button", { name: `Remove ${m1} from the list` }),
    ).toHaveCount(0);

    await m1Page.goto(`/camps/${camp.slug}`);
    await expect(
      m1Page.getByText(
        "You have a Work Access Pass — waiting for AfrikaBurn to approve the list",
      ),
    ).toBeVisible();

    // ── 7. The org returns it with a note ───────────────────────────────
    const note = "Please confirm who is on strike before we approve.";
    await org.goto(campPanel);
    await expect(passRow(org, m2)).toContainText(
      `Also has a pass from ${art.name}`,
    );
    await org.getByLabel(/note to the camp/i).fill(note);
    await org.getByRole("button", { name: "Return with note" }).click();
    await expect(org.getByText("List returned with your note.")).toBeVisible();

    await leadPage.reload();
    await expect(leadPage.getByText("Note from AfrikaBurn")).toBeVisible();
    await expect(leadPage.getByText(note)).toBeVisible();

    // The lead edits m1's pass: build → Yes, shown as edited.
    await leadPage
      .getByRole("button", { name: `Edit ${m1}'s pass` })
      .filter({ visible: true })
      .click();
    const dialog = leadPage.getByRole("dialog");
    await expect(dialog.getByText(`${m1}'s pass`)).toBeVisible();
    await dialog.getByRole("combobox", { name: "Build" }).click();
    await leadPage.getByRole("option", { name: "Yes", exact: true }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(passRow(leadPage, m1)).toContainText("edited");

    await leadPage
      .getByRole("button", { name: "Submit to AfrikaBurn" })
      .click();
    await expect(
      leadPage.getByText(
        /The list can't change until AfrikaBurn approves it or sends it back\./,
      ),
    ).toBeVisible();

    // ── 8. The org approves ─────────────────────────────────────────────
    await org.goto(campPanel);
    await expect(passRow(org, m1)).toContainText("edited");
    await org.getByRole("button", { name: "Approve list" }).click();
    await expect(org.getByText("List approved.")).toBeVisible();

    await leadPage.reload();
    await expect(
      leadPage.getByText(/^AfrikaBurn approved the list/),
    ).toBeVisible();

    await m1Page.goto(`/camps/${camp.slug}`);
    await expect(
      m1Page.getByText("You have a Work Access Pass — approved by AfrikaBurn"),
    ).toBeVisible();
    await notificationTitles(m1Page);
    await expect(
      m1Page.getByText(
        "You have a Work Access Pass — AfrikaBurn approved the list",
      ),
    ).toBeVisible();

    // m3 is a member but holds no pass: the page has painted (the camp's own
    // heading), and there is no pass line.
    await m3Page.goto(`/camps/${camp.slug}`);
    await expect(
      m3Page.getByRole("heading", { level: 1, name: camp.name }),
    ).toBeVisible();
    await expect(m3Page.getByText(/You have a Work Access Pass/)).toHaveCount(
      0,
    );

    // ── 9. The export ───────────────────────────────────────────────────
    await org.goto("/registrations/passes");
    const exportLink = org.getByRole("link", { name: /export csv/i });
    await expect(exportLink).toHaveAttribute(
      "href",
      "/api/registrations/passes/export",
    );
    const res = await org.request.get("/api/registrations/passes/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const csv = (await res.text()).replace(/^\uFEFF/, "");
    const [header, ...lines] = csv.trimEnd().split("\r\n");
    expect(header).toBe(
      "Project,Project type,List status,Name,Username,Email,Arrival,Departure,Build,Strike,Flags,Changed since approval",
    );
    expect(header).not.toMatch(/phone|emergency|passport|\bid\b|medical/i);
    const campLines = lines.filter((l) => l.startsWith(`${camp.name},`));
    expect(campLines).toHaveLength(2);
    const m1Line = campLines.find((l) => l.includes(`,${m1},`));
    const m2Line = campLines.find((l) => l.includes(`,${m2},`));
    expect(m1Line).toContain("Approved");
    expect(m2Line).toContain(`Also has a pass from ${art.name}`);
  });

  test("a plain member and a stranger get the project's not-found for Passes", async ({
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const strangerPage = await makeAppPage("web");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(memberPage, {
      onboard: true,
      username: uniqueUsername("wap_member"),
    });
    await joinByInvite(memberPage, invite.url);
    await signUpBurner(strangerPage, { onboard: true });

    // The lead reaches it (something PRESENT before the refusals below).
    await leadPage.goto(`/camps/${camp.slug}/passes`);
    await expect(
      leadPage.getByRole("heading", { level: 1, name: "Work Access Passes" }),
    ).toBeVisible();

    // A member sees the camp, but no Passes tile and no Passes page.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(
      memberPage.getByRole("heading", { level: 1, name: camp.name }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("link", { name: /open passes/i }),
    ).toHaveCount(0);
    await expectServerNotFound(memberPage, `/camps/${camp.slug}/passes`, [
      "Work Access Passes",
    ]);
    await expectServerNotFound(strangerPage, `/camps/${camp.slug}/passes`, [
      "Work Access Passes",
    ]);
  });
});
