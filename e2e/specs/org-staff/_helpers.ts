// e2e/specs/org-staff/_helpers.ts — the ORG STAFF persona's setup vocabulary.
//
// An `org_staff` account is NEVER self-service (packages/core + auth-platform
// spec §5): the only way one comes into being is a `god` admin elevating a
// signed-in account through the Accounts panel. So every org-staff spec has a
// hard dependency on a pre-provisioned god (E2E_GOD_EMAIL/E2E_GOD_PASSWORD) and
// skips cleanly without one — exactly like the god journeys in the base harness.
//
// These helpers COMPOSE the existing factories (signUpBurner / signInAs /
// elevateToGod) and drive the REAL Accounts UI to elevate — no DB back door, no
// mock. That is deliberate: the elevation itself is part of what the ORG STAFF
// persona's existence proves.

import { expect, type Page } from "@playwright/test";
import type { AppName } from "../../lib/env";
import {
  elevateToGod,
  signInAs,
  signUpBurner,
  type Account,
} from "../../personas/factories";

/** The fixture that mints an isolated page against any of the three apps. */
export type MakeAppPage = (app: AppName) => Promise<Page>;

/**
 * A provisioned org-staff principal: the credentials, and an org-app page
 * already signed in AND elevated (a reload lands in the console, not the gate).
 */
export interface OrgStaff {
  account: Account;
  /** An org-app page signed in as this account, cleared into the console. */
  org: Page;
}

/**
 * Elevate the account identified by `email` to `org_staff`, driving the god's
 * Accounts panel exactly as an admin would. Filtering the table by the exact
 * email guarantees a single matching row, so the "Elevate to org staff" control
 * is unambiguous in BOTH the desktop table and the mobile stacked-card layout —
 * no row-scoping that would only work on one of them.
 *
 * Proves the write happened by waiting for the server action's success toast,
 * not by inspecting a client-only badge.
 */
export async function elevateAccountToOrgStaff(
  godOrg: Page,
  email: string,
): Promise<void> {
  await godOrg.goto(`/accounts?q=${encodeURIComponent(email)}`);
  // The searched account is present before we touch anything (server-rendered).
  // Scoped to the visible layout: ResponsiveDataTable renders the desktop table
  // AND the mobile cards into the DOM together, so an unscoped text locator
  // matches twice and trips strict mode.
  await expect(
    godOrg.getByText(email, { exact: false }).filter({ visible: true }).first(),
  ).toBeVisible();

  // Row-level control (the only "Elevate to org staff" on the page pre-dialog).
  await godOrg
    .getByRole("button", { name: "Elevate to org staff", exact: true })
    .filter({ visible: true })
    .click();
  // Confirm inside the overlay (a second button of the same name now exists).
  await godOrg
    .getByRole("dialog")
    .getByRole("button", { name: "Elevate to org staff", exact: true })
    .click();

  await expect(godOrg.getByText(/elevated to org staff/i)).toBeVisible();
}

/**
 * Grant the account identified by `email` the ENGINEER rank, driving the god's
 * Accounts panel exactly as an admin would. Same shape as
 * `elevateAccountToOrgStaff` — filter to the exact email so the row control is
 * unambiguous in both the desktop table and the mobile stacked cards.
 */
export async function makeAccountEngineer(
  godOrg: Page,
  email: string,
): Promise<void> {
  await godOrg.goto(`/accounts?q=${encodeURIComponent(email)}`);
  // ResponsiveDataTable renders BOTH layouts into the DOM at once (the desktop
  // <table> and the mobile stacked cards), so every row-level locator here is
  // scoped to the VISIBLE instance — an unscoped one matches twice and trips
  // Playwright strict mode. Same convention as specs/god/support.ts.
  await expect(
    godOrg.getByText(email, { exact: false }).filter({ visible: true }).first(),
  ).toBeVisible();

  await godOrg
    .getByRole("button", { name: "Make engineer", exact: true })
    .filter({ visible: true })
    .click();
  await godOrg
    .getByRole("dialog")
    .getByRole("button", { name: "Elevate to engineer", exact: true })
    .click();

  await expect(godOrg.getByText(/elevated to engineer/i)).toBeVisible();
}

/**
 * Create a fresh account and grant it the ENGINEER rank.
 *
 * Same provisioning sequence as `provisionOrgStaff` — sign up for real, hit the
 * forbidden wall, get granted by a god — because an engineer is no more
 * self-service than org staff is.
 */
export async function provisionEngineer(
  makeAppPage: MakeAppPage,
): Promise<OrgStaff> {
  const web = await makeAppPage("web");
  const account = await signUpBurner(web);

  const org = await makeAppPage("org");
  await signInAs(org, account, "org");
  await expect(
    org.getByText(/this side is for afrikaburn staff/i),
  ).toBeVisible();

  const godOrg = await makeAppPage("org");
  await elevateToGod(godOrg);
  await makeAccountEngineer(godOrg, account.email);

  // "Access everywhere" is the engineer's defining grant, so the proof that the
  // rank resolved is the SAME console page org staff reach, not a lesser one.
  await org.goto("/registrations");
  await expect(
    org.getByRole("heading", { name: /registration pipeline/i }),
  ).toBeVisible();
  await expect(
    org.getByText(/this side is for afrikaburn staff/i),
  ).toHaveCount(0);

  return { account, org };
}

/**
 * Create a fresh account and elevate it to `org_staff`.
 *
 * The sequence mirrors reality: the person signs up on the participant app, then
 * signs into the console once (which materialises their `users` join row and,
 * lacking an org role, lands them on the polite "for AfrikaBurn staff" wall).
 * A god then finds them by email and elevates them; on the next console load the
 * same page resolves to `org_staff` and the console renders.
 *
 * Callers must `skipUnlessGod()` first — without god credentials no org_staff
 * can exist and the whole persona is un-testable, honestly skipped.
 */
export async function provisionOrgStaff(
  makeAppPage: MakeAppPage,
): Promise<OrgStaff> {
  // 1) Real participant sign-up (creates the Better Auth identity).
  const web = await makeAppPage("web");
  const account = await signUpBurner(web);

  // 2) First console sign-in: creates the users join row, hits the forbidden
  //    gate (no org role yet). This is the pre-elevation ground truth.
  const org = await makeAppPage("org");
  await signInAs(org, account, "org");
  await expect(
    org.getByText(/this side is for afrikaburn staff/i),
  ).toBeVisible();

  // 3) God elevates them through the Accounts panel.
  const godOrg = await makeAppPage("org");
  await elevateToGod(godOrg);
  await elevateAccountToOrgStaff(godOrg, account.email);

  // 4) Re-resolve as org_staff — the console now renders (no forbidden wall).
  await org.goto("/registrations");
  await expect(
    org.getByRole("heading", { name: /registration pipeline/i }),
  ).toBeVisible();
  await expect(
    org.getByText(/this side is for afrikaburn staff/i),
  ).toHaveCount(0);

  return { account, org };
}

/** Skip the whole file on the mobile project (console tables/builders are
 * desktop-shaped; the registration-review loop is the designated mobile journey). */
export function desktopOnly(
  test: { skip: (condition: boolean, reason: string) => void },
  projectName: string,
): void {
  test.skip(
    projectName === "mobile-360",
    "console tables/builder are desktop-shaped; the registration-review loop covers the mobile viewport",
  );
}
