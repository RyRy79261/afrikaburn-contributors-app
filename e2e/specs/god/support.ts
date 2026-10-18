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
 * does not distinguish them. The accounts panel's copy DOES: only a System
 * manager (the RANK, which no role may hold or be granted) is
 * pointed at the roles surface in the system panel. That line is always
 * rendered (viewport-robust), unlike the header "Owner" badge which is hidden
 * below the `sm` breakpoint.
 */
export async function expectGodPrivileges(page: Page): Promise<void> {
  await page.goto("/accounts");
  await expect(
    page.getByText(/roles, departments and what each role may do/i),
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
    .getByRole("button", { name: "Give org staff access", exact: true })
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
    dialog.getByRole("heading", { name: /give org staff access\?/i }),
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
    .getByRole("button", { name: "Give org staff access", exact: true })
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

// --- Department domain ownership: leave it as it was found -----------------
//
// A domain has ONE owner (`org_department_domains.domain` is the primary key),
// so a spec that gives its own fresh department "the supplier repository"
// TAKES it from the seeded Suppliers department — and deleting that fresh
// department afterwards leaves the domain owned by NOBODY, not handed back.
// Measured 18 Oct 2026 on the local stack: one run of
// department-domain-scoping.spec.ts took the department-domain rows from four
// (registrations + camp_categories under Theme camps, suppliers +
// supplier_documents under Suppliers) to two. Every later spec on that
// database then ran against a console where no department owned suppliers or
// registrations.
//
// So a spec that moves ownership snapshots it first and restores it in an
// afterEach — through the console, like everything else here (no DB back
// doors), and on a page of its own, so a test that died mid-dialog on ITS page
// cannot wedge the restore. Call both while holding the "department-domains"
// lock: afterEach hooks run before fixture teardown, so the lock is still held
// when the restore writes.
//
// WHAT IS SNAPSHOTTED: the PERMANENT departments (the seeded pair) only. They
// are where ownership lives between runs, and they cannot disappear mid-read.
// Other specs (god-roles-management) create and delete throwaway departments
// WITHOUT the lock — they move no domains — so reading or deleting "every
// department not in the snapshot" would race them. The restore deletes only
// the departments its caller says are its own.

/** What each permanent department owns: its name → domain label → ticked. */
export type DepartmentDomainSnapshot = Map<string, Map<string, boolean>>;

const PERMANENT_DELETE = /^Delete (.+) — permanent, cannot be deleted$/;
const OWNS_BUTTON = /^Choose what (.+) owns$/;

async function gotoRolesPanel(page: Page): Promise<void> {
  await page.goto("/system/roles");
  // Something PRESENT before the list is read: an unrendered page has no
  // department buttons, and an empty snapshot would restore nothing.
  await expect(page.getByLabel(/new department/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: PERMANENT_DELETE }).first(),
  ).toBeVisible();
}

/** The name `pattern` captures from every matching button's aria-label. */
async function namesFromButtons(
  page: Page,
  pattern: RegExp,
): Promise<string[]> {
  const labels = await page
    .getByRole("button", { name: pattern })
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  return labels.flatMap((label) => {
    const match = pattern.exec(label);
    return match?.[1] ? [match[1]] : [];
  });
}

/** Open one department's "what it owns" dialog and return its checkboxes. */
async function openOwnsDialog(
  page: Page,
  name: string,
): Promise<{ dialog: Locator; boxes: Array<{ label: string; box: Locator }> }> {
  await page.getByRole("button", { name: `Choose what ${name} owns` }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: `What does ${name} own?` }),
  ).toBeVisible();
  const boxes: Array<{ label: string; box: Locator }> = [];
  for (const row of await dialog.locator("fieldset label").all()) {
    const label = (await row.innerText()).split("\n")[0]?.trim() ?? "";
    boxes.push({ label, box: row.getByRole("checkbox") });
  }
  expect(boxes.length, `no domain checkboxes for ${name}`).toBeGreaterThan(0);
  return { dialog, boxes };
}

/** Read what every permanent department owns right now. */
export async function snapshotDepartmentDomains(
  page: Page,
): Promise<DepartmentDomainSnapshot> {
  await gotoRolesPanel(page);
  const snapshot: DepartmentDomainSnapshot = new Map();
  for (const name of await namesFromButtons(page, PERMANENT_DELETE)) {
    const { dialog, boxes } = await openOwnsDialog(page, name);
    const owned = new Map<string, boolean>();
    for (const { label, box } of boxes) owned.set(label, await box.isChecked());
    snapshot.set(name, owned);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  }
  expect(snapshot.size, "no departments on /system/roles").toBeGreaterThan(0);
  return snapshot;
}

/** Plain arrays, so a mismatch prints as a readable diff. */
function snapshotRows(
  snapshot: DepartmentDomainSnapshot,
): Array<[string, string[]]> {
  return [...snapshot].map(([name, owned]) => [
    name,
    [...owned].filter(([, ticked]) => ticked).map(([label]) => label),
  ]);
}

/**
 * Put ownership back as `before` recorded it. First delete the caller's own
 * departments that are still there (a test that failed midway never reached
 * its cleanup; deleting one releases what it took), then re-tick each
 * permanent department's domains — ticking takes a domain from whoever holds
 * it. Saves only a department that differs, so a clean run writes nothing.
 * Ends by re-reading and asserting the result matches the snapshot.
 */
export async function restoreDepartmentDomains(
  page: Page,
  before: DepartmentDomainSnapshot,
  isOwnDepartment: (name: string) => boolean,
): Promise<void> {
  // Retried from a fresh render: a test's own cleanup can still be in flight
  // when this starts. Seen once (18 Oct 2026): the confirm for a department
  // the test had just deleted itself stayed open, its delete refused. A fresh
  // read settles it — gone is gone, and anything still listed is deleted.
  await expect(async () => {
    await gotoRolesPanel(page);
    const leftovers = (await namesFromButtons(page, OWNS_BUTTON)).filter(
      (name) => isOwnDepartment(name) && !before.has(name),
    );
    for (const name of leftovers) {
      await page
        .getByRole("button", { name: `Delete ${name}`, exact: true })
        .click();
      const confirm = page.getByRole("dialog");
      await confirm
        .getByRole("button", { name: /delete department and its roles/i })
        .click();
      // The dialog closes only on the action's success path (roles-manager
      // `run`); an error keeps it open and this attempt is retried.
      await expect(confirm).toBeHidden({ timeout: 10_000 });
    }
  }).toPass({ timeout: 60_000 });
  await gotoRolesPanel(page);

  for (const [name, owned] of before) {
    const { dialog, boxes } = await openOwnsDialog(page, name);
    let changed = false;
    for (const { label, box } of boxes) {
      const want = owned.get(label) ?? false;
      if ((await box.isChecked()) === want) continue;
      changed = true;
      await box.setChecked(want);
    }
    await dialog
      .getByRole("button", { name: changed ? /save what it owns/i : "Cancel" })
      .click();
    await expect(dialog).toBeHidden();
  }

  const after = await snapshotDepartmentDomains(page);
  expect(
    snapshotRows(after),
    "department domain ownership was not restored",
  ).toEqual(snapshotRows(before));
}
