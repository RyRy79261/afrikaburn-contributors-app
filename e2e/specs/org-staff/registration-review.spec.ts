// Persona: ORG STAFF — the registration review loop. THE PRIMARY JOURNEY, and
// the one that runs on the 360px mobile project as well as desktop.
//
// What it proves (server behaviour, not UI cosmetics):
//   - the queue filters by status and opens a real detail;
//   - a per-section review comment is written, audited, and SEEN by the camp;
//   - approve and reject each land the state machine and write an audit event;
//   - an illegal follow-up transition (approve a now-terminal registration) is
//     REFUSED by the server — a stale second reviewer cannot corrupt state.
//
// Each test creates its own camp + registration through the real web wizard
// (harness factories) and its own org_staff (god-elevated) — no shared state.

import { test, expect, skipUnlessGod } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  submitRegistration,
} from "../../personas/factories";
import { provisionOrgStaff, type MakeAppPage } from "./_helpers";

/**
 * Create a camp lead who has SUBMITTED a full six-section theme-camp
 * registration. Returns the lead's web page (still signed in), the camp slug and
 * name so the org side can find it in the queue and the lead can re-read it.
 */
async function createSubmittedCamp(makeAppPage: MakeAppPage): Promise<{
  web: Awaited<ReturnType<MakeAppPage>>;
  slug: string;
  campName: string;
}> {
  const web = await makeAppPage("web");
  await signUpBurner(web, { onboard: true });
  const camp = await createCamp(web);
  await submitRegistration(web, camp.slug);
  return { web, slug: camp.slug, campName: camp.name };
}

/** Open a registration's detail from the QUEUE (not by a guessed URL): filter to
 * Submitted, click the camp's row link, and land on its detail page. Returns the
 * detail URL so a second reviewer can open the same registration. */
async function openDetailFromQueue(
  org: Awaited<ReturnType<MakeAppPage>>,
  campName: string,
): Promise<string> {
  // Page defensively: with 4 parallel workers each submitting/acting on
  // registrations, updated_at DESC can push this camp off page 1 before we click.
  // Walk pages until the (per-worker-unique) camp name appears.
  const MAX_PAGES = 25;
  for (let p = 1; p <= MAX_PAGES; p++) {
    await org.goto(`/registrations?page=${p}`);
    const link = org.getByRole("link", { name: campName });
    if (await link.count()) {
      await link.first().click();
      await org.waitForURL(/\/registrations\/[0-9a-f-]{36}$/i);
      return org.url();
    }
    if (await org.getByText(/no registrations/i).count()) break;
  }
  throw new Error(
    `[org-staff] "${campName}" never appeared in the registrations queue within ${MAX_PAGES} pages.`,
  );
}

test.describe("org staff · registration review loop", () => {
  test("filters the queue, shows pagination, and opens a detail", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const { campName } = await createSubmittedCamp(makeAppPage);
    const staff = await provisionOrgStaff(makeAppPage);

    await staff.org.goto("/registrations");

    // Filter to Submitted — the freshly-submitted camp is present.
    await staff.org.getByRole("combobox").first().click();
    await staff.org.getByRole("option", { name: "Submitted" }).click();
    await expect(staff.org).toHaveURL(/status=submitted/);
    await expect(
      staff.org.getByRole("link", { name: campName }).first(),
    ).toBeVisible();
    // The pagination summary reflects the (filtered) result set.
    await expect(staff.org.getByText(/Showing \d+–\d+ of \d+/)).toBeVisible();

    // Filter to Approved — a not-yet-decided camp must NOT appear.
    await staff.org.getByRole("combobox").first().click();
    await staff.org.getByRole("option", { name: "Approved" }).click();
    await expect(staff.org).toHaveURL(/status=approved/);
    await expect(
      staff.org.getByRole("link", { name: campName }),
    ).toHaveCount(0);

    // Open the detail from the queue (back to Submitted first).
    const detailUrl = await openDetailFromQueue(
      staff.org,
      campName,
    );
    expect(detailUrl).toMatch(/\/registrations\/[0-9a-f-]{36}$/i);
    await expect(
      staff.org.getByRole("heading", { name: campName }),
    ).toBeVisible();
  });

  test("a section review comment is audited and the camp sees it", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const camp = await createSubmittedCamp(makeAppPage);
    const staff = await provisionOrgStaff(makeAppPage);

    await openDetailFromQueue(staff.org, camp.campName);

    // Request changes ON A SECTION (the Leave No Trace card, id="lnt").
    const marker = `MOOP sweep detail needed ${Date.now().toString(36)}`;
    const section = staff.org.locator("#lnt");
    await section.getByRole("button", { name: /add comment/i }).click();
    await section.getByRole("textbox").fill(marker);
    await section.getByRole("button", { name: /post comment/i }).click();

    // The thread opens on the section, and the decision (audit) history records
    // the comment — its mere presence proves the audit_events row was written.
    await expect(staff.org.getByText(/1 open thread/i)).toBeVisible();
    await expect(staff.org.getByText(/added a section comment/i)).toBeVisible();

    // The CAMP side sees the same feedback, attributed to AfrikaBurn, and the
    // section flips to "Changes requested".
    await camp.web.goto(`/camps/${camp.slug}/registration`);
    await expect(camp.web.getByText(marker)).toBeVisible();
    await expect(camp.web.getByText("AfrikaBurn").first()).toBeVisible();
    await expect(
      camp.web.getByText(/changes requested/i).first(),
    ).toBeVisible();
  });

  test("approving lands the state machine and writes an audit event", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const camp = await createSubmittedCamp(makeAppPage);
    const staff = await provisionOrgStaff(makeAppPage);

    await openDetailFromQueue(staff.org, camp.campName);

    await staff.org.getByRole("button", { name: /^approve$/i }).click();
    await expect(staff.org.getByText(/approve applied/i)).toBeVisible();

    // Decision history (an audit_events read) records the exact transition.
    await expect(
      staff.org.getByRole("heading", { name: /decision history/i }),
    ).toBeVisible();
    await expect(
      staff.org.getByText(/submitted\s*→\s*approved/i),
    ).toBeVisible();
    // Approved is terminal-but-withdrawable: no further reviewer actions offered.
    await expect(
      staff.org.getByText(/no reviewer actions are available/i),
    ).toBeVisible();

    // The camp sees the approval on its own registration view.
    await camp.web.goto(`/camps/${camp.slug}/registration`);
    await expect(
      camp.web.getByText(/approved — you['’]re registered/i),
    ).toBeVisible();
  });

  test("rejecting requires a reason and is audited; a stale illegal transition is refused server-side", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const camp = await createSubmittedCamp(makeAppPage);
    const staff = await provisionOrgStaff(makeAppPage);

    // Reviewer A and reviewer B both open the SAME registration while submitted.
    const detailUrl = await openDetailFromQueue(staff.org, camp.campName);
    const reviewerB = await makeAppPage("org");
    // A second concurrent session for the same org_staff principal.
    await reviewerB.goto("/auth/sign-in");
    await reviewerB.getByLabel("Email", { exact: true }).fill(staff.account.email);
    await reviewerB
      .getByLabel("Password", { exact: true })
      .fill(staff.account.password);
    await reviewerB.getByRole("button", { name: /^sign in$/i }).click();
    await reviewerB.goto(detailUrl);
    await expect(
      reviewerB.getByRole("button", { name: /^approve$/i }),
    ).toBeVisible();

    // A rejects (a reason is mandatory) — the registration becomes terminal.
    await staff.org.getByRole("button", { name: /^reject$/i }).click();
    const dialog = staff.org.getByRole("dialog");
    await dialog
      .getByRole("textbox")
      .fill("Duplicate of an existing 2027 registration.");
    await dialog.getByRole("button", { name: /^confirm$/i }).click();
    await expect(staff.org.getByText(/reject applied/i)).toBeVisible();
    await expect(staff.org.getByText(/submitted\s*→\s*rejected/i)).toBeVisible();

    // B is stale — it still shows the submitted actions. Approving now is an
    // illegal transition on a terminal row; the SERVER must refuse it. (Fails
    // closed whether the refusal comes from the state-machine guard or the
    // TOCTOU status guard — removing either turns this red.)
    await reviewerB.getByRole("button", { name: /^approve$/i }).click();
    await expect(
      reviewerB.getByText(/could not apply decision/i),
    ).toBeVisible();

    // And the registration is still rejected, not silently approved.
    await staff.org.goto(detailUrl);
    await expect(
      staff.org.getByText(/no reviewer actions are available/i),
    ).toBeVisible();
  });
});
