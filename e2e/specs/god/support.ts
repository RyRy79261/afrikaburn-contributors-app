// e2e/specs/god/support.ts — shared vocabulary for the GOD ADMIN suite.
//
// NOT a spec (no `*.spec.ts` suffix → Playwright never collects it as a test).
// These helpers keep every god spec asserting the SAME observable truths about
// the org console gate and the accounts panel, so a failure reads in product
// terms ("B still reached the console after demotion") rather than selector
// terms. All selectors are role/label-based (task STYLE), and every one that a
// row renders is `.filter({ visible: true })`-scoped because ResponsiveDataTable
// renders BOTH layouts into the DOM at once (a real <table> at md+ AND the
// stacked mobile cards), so an unscoped role query would match twice and trip
// Playwright strict mode. Scoping to the visible instance makes each helper work
// identically on the desktop-chromium and mobile-360 projects.

import { expect, type Locator, type Page } from "@playwright/test";

/** The console's primary nav — present only once the org gate has been cleared. */
export function consoleNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Console" });
}

/**
 * Assert the current org page IS the console (gate cleared). We assert the
 * console chrome is present AND both gate headings are absent — a positive proof
 * of access, not merely "a link exists".
 */
export async function expectConsoleReached(page: Page): Promise<void> {
  await expect(consoleNav(page)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /this side is for afrikaburn staff/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /restricted to afrikaburn staff/i }),
  ).toHaveCount(0);
}

/**
 * Assert the current org page is the FORBIDDEN gate — a signed-in account with
 * no org role. This is the server's refusal (`resolveOrgSession → forbidden`),
 * not a hidden nav item: the console chrome is provably absent.
 */
export async function expectConsoleForbidden(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /this side is for afrikaburn staff/i }),
  ).toBeVisible();
  await expect(consoleNav(page)).toHaveCount(0);
}

/**
 * Assert the current session holds GOD specifically, not merely some org role.
 * Both god and org_staff clear the console gate, so "reached the console" alone
 * does not distinguish them. The accounts panel's heading copy DOES: only a god
 * is invited to "elevate trusted people to org staff" (org_staff is told only
 * the owner can change access). That copy is always rendered (viewport-robust),
 * unlike the header "Owner" badge which is hidden below the `sm` breakpoint.
 */
export async function expectGodPrivileges(page: Page): Promise<void> {
  await page.goto("/accounts");
  await expect(
    page.getByText(/elevate trusted people to org staff/i),
  ).toBeVisible();
}

/** Navigate the accounts panel filtered to exactly one account by email. */
export async function gotoAccount(page: Page, email: string): Promise<void> {
  await page.goto(`/accounts?q=${encodeURIComponent(email)}`);
  await expectConsoleReached(page); // only god/org_staff get here at all
}

// --- Row controls (visible instance only — see file header) ----------------

export function rowElevateButton(page: Page): Locator {
  return page
    .getByRole("button", { name: "Elevate to org staff", exact: true })
    .filter({ visible: true });
}

export function rowRemoveButton(page: Page): Locator {
  return page
    .getByRole("button", { name: "Remove staff access", exact: true })
    .filter({ visible: true });
}

/** The Confirm Overlay (Radix Dialog, portalled once — no viewport duplication). */
export function confirmDialog(page: Page): Locator {
  return page.getByRole("dialog");
}

/**
 * Open the elevate confirm dialog for the single visible account row and assert
 * it appeared with its warning copy. Returns the dialog locator.
 */
export async function openElevateDialog(page: Page): Promise<Locator> {
  await rowElevateButton(page).click();
  const dialog = confirmDialog(page);
  await expect(
    dialog.getByRole("heading", { name: /elevate to org staff\?/i }),
  ).toBeVisible();
  return dialog;
}

/** Open the demote confirm dialog for the single visible account row. */
export async function openDemoteDialog(page: Page): Promise<Locator> {
  await rowRemoveButton(page).click();
  const dialog = confirmDialog(page);
  await expect(
    dialog.getByRole("heading", { name: /remove org staff access\?/i }),
  ).toBeVisible();
  return dialog;
}

// --- Confirmed actions (open → confirm → wait for completion) ---------------
//
// The confirm handler closes the dialog ONLY on the server action's success
// path (setConfirming(null) after a successful setOrgStaffRole); an error keeps
// it open with a toast. So "dialog hidden" is a reliable completion+success
// signal — waiting on it prevents racing a re-navigation ahead of the DB write.

/** Elevate the single visible row to org_staff, confirming and awaiting success. */
export async function elevateVisibleRow(page: Page): Promise<void> {
  const dialog = await openElevateDialog(page);
  await dialog
    .getByRole("button", { name: "Elevate to org staff", exact: true })
    .click();
  await expect(dialog).toBeHidden();
}

/** Demote the single visible row (remove staff access), confirming and awaiting. */
export async function demoteVisibleRow(page: Page): Promise<void> {
  const dialog = await openDemoteDialog(page);
  await dialog
    .getByRole("button", { name: "Remove staff access", exact: true })
    .click();
  await expect(dialog).toBeHidden();
}
