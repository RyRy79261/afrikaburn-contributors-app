// specs/camp-lead/support.ts — camp-lead-specific choreography the shared
// persona factories (e2e/personas/factories.ts) don't cover. These DRIVE THE
// REAL UI exactly like the factories do — no DB back doors. Kept local to this
// persona's suite so they can't collide with another owner's edits to the shared
// factory file, and because they encode role/officer/review choreography that
// only the camp-lead specs need.
//
// NOT a spec (no `*.spec.ts` suffix → Playwright never collects it as a test).
//
// Selector provenance (verified against source on 2026-07-26):
//   create camp ..... apps/web/components/create-camp-form.tsx
//   roles settings .. apps/web/app/camps/[slug]/settings/roles/page.tsx
//                     apps/web/components/roles/{roles-settings,new-role-card,
//                     appearance,privileges,role-row,officer-row}.tsx
//   quick-assign .... apps/web/components/camp-members.tsx (AssignRolesDialog)
//   officer consent . apps/web/components/roles/officer-consent-banner.tsx
//   bio (w/ phone) .. apps/web/components/onboarding/bio-flow.tsx (DetailsStep)
//   org review ...... apps/org/components/{registration-review,section-review-
//                     thread,decision-panel}.tsx
//                     apps/org/app/(console)/registrations/[id]/page.tsx

import { expect, type Locator, type Page } from "@playwright/test";
import { uniqueUsername } from "../../lib/identity";
import { appAlerts } from "../../lib/dom";

// --- Camp creation (raw form, for the dedupe paths) ------------------------
//
// The shared `createCamp` factory clicks "Create camp" once and waits for the
// redirect — perfect for the happy path, but it can't observe the soft-dedupe
// WARN state or the exact-name REFUSAL, which don't navigate. These helpers
// drive the same three-field form (create-camp-form.tsx) and return control at
// the decision point so a spec can assert what the server said.

/** True for a real camp-detail URL (/camps/<slug>) but NOT the /camps/new form. */
function isCampSlugUrl(url: URL): boolean {
  return (
    /\/camps\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/camps/new")
  );
}

/** Fill the create-camp form's name (+ optional description) without submitting. */
async function fillCampForm(
  page: Page,
  name: string,
  description?: string,
): Promise<void> {
  await page.goto("/camps/new");
  await page.getByLabel(/camp name/i).fill(name);
  if (description)
    await page.getByLabel(/short description/i).fill(description);
}

/**
 * Attempt to create a camp with `name` and RETURN the server's verdict without
 * confirming a warning. `created` → it navigated to the camp; `warn` → the
 * soft-dedupe banner appeared (near-duplicate, still allowed); `error` → a hard
 * refusal (exact normalized-name collision). The verb reads like the product.
 */
export async function attemptCreateCamp(
  page: Page,
  name: string,
  description?: string,
): Promise<{ outcome: "created" | "warn" | "error"; message?: string }> {
  await fillCampForm(page, name, description);
  const submit = page.getByRole("button", { name: /create camp/i });
  await submit.click();

  // Race the three observable outcomes. Whichever resolves first is the verdict.
  // NB: waitForURL resolves IMMEDIATELY when the current URL already matches
  // (playwright-core frame.waitForURL), and we START on /camps/new — which a
  // naive /\/camps\/[^/]+$/ regex would false-match. The predicate excludes the
  // form's own route so only a real redirect to a camp counts as "created".
  const navigated = page
    .waitForURL((url) => isCampSlugUrl(url), { timeout: 10_000 })
    .then(() => "created" as const)
    .catch(() => null);
  const warn = page
    .getByText(/similar to existing camp/i)
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => "warn" as const)
    .catch(() => null);
  const error = appAlerts(page)
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => "error" as const)
    .catch(() => null);

  const outcome = await Promise.race([navigated, warn, error]);
  if (outcome === "created") return { outcome };
  if (outcome === "warn") {
    const message =
      (await page.getByText(/similar to existing camp/i).textContent()) ??
      undefined;
    return { outcome: "warn", message: message ?? undefined };
  }
  if (outcome === "error") {
    const message = (await appAlerts(page).textContent()) ?? undefined;
    return { outcome: "error", message: message ?? undefined };
  }
  throw new Error(
    "attemptCreateCamp: no outcome (created/warn/error) observed",
  );
}

/** Confirm a warned (near-duplicate) create by clicking "Create camp" again. */
export async function confirmWarnedCreate(
  page: Page,
): Promise<{ slug: string }> {
  await page.getByRole("button", { name: /create camp/i }).click();
  await page.waitForURL((url) => isCampSlugUrl(url));
  const slug = new URL(page.url()).pathname.split("/").filter(Boolean).pop()!;
  return { slug };
}

// --- Burner Bio with a phone number ----------------------------------------
//
// The shared `completeBio` factory intentionally leaves the phone blank. The
// officer → org phone-sharing journey needs a real phone on the member's bio to
// assert on, so this local helper completes onboarding WITH a phone. It drives
// the same DetailsStep, so it is not a back door — just a fuller fill.

export async function completeBioWithPhone(
  page: Page,
  opts: { username?: string; phone: string },
): Promise<{ username: string; phone: string }> {
  const username = opts.username ?? uniqueUsername("officer_ren");
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("textbox", { name: /username/i }).fill(username);
  // The Field wires htmlFor="phone" to the react-phone-number-input's input id,
  // so the accessible label is exactly "Phone" (distinct from the emergency-
  // contact phones, which are labelled "On-site … contact" etc).
  await page.getByLabel("Phone", { exact: true }).fill(opts.phone);
  await page.getByRole("button", { name: "Save & continue" }).click(); // details
  await page.getByRole("button", { name: "Save & continue" }).click(); // burns
  await page.getByRole("button", { name: "Complete my bio" }).click();
  await expect(page.getByText(/you['’]re all set/i)).toBeVisible();
  return { username, phone: opts.phone };
}

// --- Custom roles (Roles & Officers settings) ------------------------------

export async function gotoRolesSettings(
  page: Page,
  slug: string,
): Promise<void> {
  await page.goto(`/camps/${slug}/settings/roles`);
  await expect(
    page.getByRole("heading", { name: /roles & officers/i }),
  ).toBeVisible();
}

export interface CustomRoleInput {
  name: string;
  emoji: string;
  /** A ROLE_COLOR_LABELS label, e.g. "Rust" (the swatch's aria-label). */
  colorLabel: string;
  /** Privilege switch labels to turn ON (PrivilegeToggles aria-labels). */
  privileges?: string[];
}

/**
 * Create a custom role through the "New role" card: name → emoji + colour →
 * privileges → Create. Asserts the appearance took (colour swatch pressed) and
 * that the role PERSISTS in the Custom roles list after the server round-trip.
 */
export async function createCustomRole(
  page: Page,
  slug: string,
  role: CustomRoleInput,
): Promise<void> {
  await gotoRolesSettings(page, slug);
  await page.getByRole("button", { name: /^new role$/i }).click();

  await page.getByLabel("Name", { exact: true }).fill(role.name);
  await page.getByLabel("Role icon").fill(role.emoji);

  const swatch = page.getByRole("button", {
    name: role.colorLabel,
    exact: true,
  });
  await swatch.click();
  await expect(swatch).toHaveAttribute("aria-pressed", "true");

  for (const label of role.privileges ?? []) {
    await page.getByRole("switch", { name: new RegExp(label, "i") }).click();
  }

  await page.getByRole("button", { name: /create role/i }).click();

  // Persistence, not a toast: the new role appears as a row in the list, and the
  // empty-state copy is gone.
  await expect(page.getByText(role.name).first()).toBeVisible();
  await expect(page.getByText(/no custom roles yet/i)).toHaveCount(0);
}

// --- Quick-assign a custom role to a member (camp dashboard) ----------------

/** The camp-members list row for a given member (own <li>). */
function memberRow(page: Page, memberName: string): Locator {
  return page.locator("li").filter({ hasText: memberName });
}

/** Open the quick-assign dialog for `memberName` (requires assign_roles). */
async function openAssignDialog(
  page: Page,
  slug: string,
  memberName: string,
): Promise<Locator> {
  await page.goto(`/camps/${slug}`);
  await memberRow(page, memberName)
    .getByRole("button", { name: /^assign$/i })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText(new RegExp(`roles for ${memberName}`, "i")),
  ).toBeVisible();
  return dialog;
}

/** Grant `roleName` to `memberName` via the quick-assign dialog. */
export async function assignRoleToMember(
  page: Page,
  slug: string,
  memberName: string,
  roleName: string,
): Promise<void> {
  const dialog = await openAssignDialog(page, slug, memberName);
  await dialog.getByRole("button", { name: new RegExp(roleName, "i") }).click();
  await dialog.getByRole("button", { name: /save roles/i }).click();
  await expect(dialog).toHaveCount(0);
}

/** Revoke `roleName` from `memberName` (toggle it off again, then save). */
export async function revokeRoleFromMember(
  page: Page,
  slug: string,
  memberName: string,
  roleName: string,
): Promise<void> {
  const dialog = await openAssignDialog(page, slug, memberName);
  // The chip renders pressed; clicking it de-selects.
  await dialog.getByRole("button", { name: new RegExp(roleName, "i") }).click();
  await dialog.getByRole("button", { name: /save roles/i }).click();
  await expect(dialog).toHaveCount(0);
}

// --- Officers --------------------------------------------------------------

/**
 * Assign `memberName` to the officer role `officerName` (e.g. "Safety Officer").
 * This creates a PENDING officer registration — nothing is shared until the
 * member accepts. Drives the officer accordion row's member Select + "Ask them
 * to accept".
 */
export async function assignOfficer(
  page: Page,
  slug: string,
  officerName: string,
  memberName: string,
): Promise<void> {
  await gotoRolesSettings(page, slug);
  // Expand the officer's accordion row (the trigger's accessible name contains
  // the officer's badge name).
  await page
    .getByRole("button", { name: new RegExp(officerName, "i") })
    .filter({ visible: true })
    .first()
    .click();

  // Pick the member in the row's Select, then request acceptance.
  await page.getByRole("combobox").filter({ visible: true }).first().click();
  await page.getByRole("option", { name: memberName }).click();
  await page.getByRole("button", { name: /ask them to accept/i }).click();

  // The row now reflects a pending consent (no contact shared yet).
  await expect(
    page.getByText(/awaiting (their )?acceptance/i).first(),
  ).toBeVisible();
}

/** As the assigned member, accept the pending officer request (consent banner). */
export async function acceptOfficerRequest(
  page: Page,
  slug: string,
): Promise<void> {
  await page.goto(`/camps/${slug}`);
  await expect(
    page.getByRole("heading", { name: /asked to be a camp officer/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^accept$/i }).click();
}

// --- Org console (needs a god session — see elevateToGod / skipUnlessGod) ---

/**
 * From the registrations queue, open the detail page for the camp named
 * `campName`. The queue is ordered by `updated_at DESC` (queries.ts), so a
 * just-submitted/just-acted-on registration sits at the top; the camp name is
 * unique per worker, so the link is unambiguous.
 */
export async function openRegistrationInConsole(
  orgPage: Page,
  campName: string,
): Promise<string> {
  // updated_at DESC is NOT enough under parallel load: 4 workers each bump
  // updated_at, so a just-submitted camp can be pushed off page 1 before we
  // click. The camp name is unique per worker, so page until we find it.
  const MAX_PAGES = 25;
  for (let p = 1; p <= MAX_PAGES; p++) {
    await orgPage.goto(`/registrations?page=${p}`);
    const link = orgPage
      .getByRole("link", { name: campName })
      .filter({ visible: true });
    if (await link.count()) {
      await link.first().click();
      await orgPage.waitForURL(/\/registrations\/[0-9a-f-]{36}/i);
      await expect(
        orgPage.getByRole("heading", { name: campName }),
      ).toBeVisible();
      // RETURN THE URL so a spec that needs the detail again can `goto` it.
      //
      // Calling this helper a SECOND time inside one test has failed twice now
      // (camp-lead/decision-outcomes 28 Jul, camp-lead/review-loop 29 Jul) with
      // the console rendering its chrome over an empty body. I have not
      // root-caused that, and I am not pretending otherwise — but the first
      // call is reliable and the URL it lands on is stable, so re-walking the
      // queue is a hop with nothing to gain: it depends on `updated_at`
      // ordering and pagination that the test does not care about. Specs that
      // need to come back should hold this and navigate straight there.
      return orgPage.url();
    }
    // SAY WHICH FAILURE THIS IS. The console renders a full-screen gate for an
    // unauthenticated or non-org session, and a gate has no camp links — so a
    // lost session surfaced as "never appeared in the registrations queue",
    // which sends the reader to look at the queue, the ordering and the seed
    // data. Measured 29 Jul 2026: six tests failed exactly this way in one run
    // and the cause was upstream of the queue entirely.
    if (
      (await orgPage.getByText(/restricted to afrikaburn staff/i).count()) ||
      (await orgPage.getByText(/this side is for afrikaburn staff/i).count())
    ) {
      throw new Error(
        `[camp-lead] The console showed the STAFF GATE, not the queue — this session is not an org session. "${campName}" may well be in the queue; nothing here could see it.`,
      );
    }
    if (await orgPage.getByText(/no registrations/i).count()) break;
  }
  throw new Error(
    `[camp-lead] "${campName}" never appeared in the registrations queue within ${MAX_PAGES} pages.`,
  );
}

/** The section review Card for a given section key (id={sectionKey}). */
function sectionCard(orgPage: Page, sectionKey: string): Locator {
  return orgPage.locator(`#${sectionKey}`);
}

/** As org staff, post a section-review comment (opens a thread on that section). */
export async function addSectionComment(
  orgPage: Page,
  sectionKey: string,
  comment: string,
): Promise<void> {
  const card = sectionCard(orgPage, sectionKey);
  await card.getByRole("button", { name: /add comment/i }).click();
  await card.getByRole("textbox").fill(comment);
  await card.getByRole("button", { name: /post comment/i }).click();
  await expect(card.getByText(comment)).toBeVisible();
}

/**
 * Run a reviewer decision from the DecisionPanel. `request_changes` / `reject`
 * open a reason dialog; `start_review` / `approve` fire immediately.
 */
export async function decide(
  orgPage: Page,
  action: "Start review" | "Approve" | "Request changes" | "Reject",
  reason?: string,
): Promise<void> {
  await orgPage.getByRole("button", { name: action, exact: true }).click();
  if (action === "Request changes" || action === "Reject") {
    const dialog = orgPage.getByRole("dialog");
    await dialog.getByRole("textbox").fill(reason ?? "Please revise this.");
    await dialog.getByRole("button", { name: /^confirm$/i }).click();
    await expect(dialog).toHaveCount(0);
  }
}
