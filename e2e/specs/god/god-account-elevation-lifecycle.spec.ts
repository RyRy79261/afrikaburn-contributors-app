// god-account-elevation-lifecycle.spec.ts — the GOD ADMIN happy path, part 2.
//
// The full elevate → demote lifecycle, proved by EFFECT, not by badge text: a
// burner who is refused the console becomes able to reach it after elevation,
// and is refused again after demotion. Both directions go through the Confirm
// Overlay, and dismissing that overlay must NEVER perform the action. Because
// Playwright runs every spec on both the desktop and mobile-360 projects, this
// primary journey is exercised on the 360px stacked-card layout too (task:
// "the mobile viewport for at least the primary journey").
//
// Counterpart personas (the burner being elevated) are created through the real
// UI with the harness factories — never mocked (task requirement).

import { test, expect, skipUnlessGod } from "../../fixtures";
import { godCredentials } from "../../lib/env";
import { elevateToGod, signInAs, signUpBurner } from "../../personas/factories";
import {
  demoteVisibleRow,
  elevateVisibleRow,
  expectConsoleForbidden,
  expectConsoleReached,
  gotoAccount,
  openDemoteDialog,
  openElevateDialog,
  rowElevateButton,
  rowRemoveButton,
} from "./support";

test.describe("god elevate/demote lifecycle", () => {
  test.beforeEach(() => {
    skipUnlessGod();
  });

  test("god elevates a burner to org staff, then demotes them — proved by console access", async ({
    orgPage,
    webPage,
    makeAppPage,
  }) => {
    // God is live on the console.
    await elevateToGod(orgPage);

    // A fresh burner (the person being trusted) — created through the real app.
    const burner = await signUpBurner(webPage, { onboard: true });

    // Baseline: the burner signs into the console and is REFUSED (no org role).
    // This is the "before" that makes the elevation's effect meaningful.
    const burnerOrg = await makeAppPage("org");
    await signInAs(burnerOrg, burner, "org");
    await burnerOrg.goto("/");
    await expectConsoleForbidden(burnerOrg);

    // God finds the burner and confirms the elevation through the dialog.
    await gotoAccount(orgPage, burner.email);
    await expect(rowElevateButton(orgPage)).toBeVisible();
    await elevateVisibleRow(orgPage);

    // Durable state: on a FRESH server render the row now offers "Remove staff
    // access" — the write committed (not just an optimistic client toast).
    await gotoAccount(orgPage, burner.email);
    await expect(rowRemoveButton(orgPage)).toBeVisible();

    // THE effect: the same burner session can now reach the console. This proves
    // the grant took effect server-side, the strongest possible assertion.
    await burnerOrg.goto("/");
    await expectConsoleReached(burnerOrg);

    // Now demote, again through the confirm dialog.
    await gotoAccount(orgPage, burner.email);
    await demoteVisibleRow(orgPage);

    // Durable state flips back to "Give org staff access".
    await gotoAccount(orgPage, burner.email);
    await expect(rowElevateButton(orgPage)).toBeVisible();

    // THE effect: access closes immediately — the burner is refused again.
    await burnerOrg.goto("/");
    await expectConsoleForbidden(burnerOrg);
  });

  test("dismissing the ELEVATE dialog does not grant access", async ({
    orgPage,
    webPage,
    makeAppPage,
  }) => {
    await elevateToGod(orgPage);
    const burner = await signUpBurner(webPage, { onboard: true });

    // Cancel button.
    await gotoAccount(orgPage, burner.email);
    const dialog = await openElevateDialog(orgPage);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();

    // Esc key.
    await openElevateDialog(orgPage);
    await orgPage.keyboard.press("Escape");
    await expect(orgPage.getByRole("dialog")).toBeHidden();

    // Nothing was granted: a fresh render still offers "Elevate", never "Remove".
    await gotoAccount(orgPage, burner.email);
    await expect(rowElevateButton(orgPage)).toBeVisible();
    await expect(rowRemoveButton(orgPage)).toHaveCount(0);

    // And the burner is still refused the console — the role genuinely did not
    // change server-side, not merely "the row still looks unelevated".
    const burnerOrg = await makeAppPage("org");
    await signInAs(burnerOrg, burner, "org");
    await burnerOrg.goto("/");
    await expectConsoleForbidden(burnerOrg);
  });

  test("dismissing the DEMOTE dialog does not remove access", async ({
    orgPage,
    webPage,
    makeAppPage,
  }) => {
    await elevateToGod(orgPage);
    const burner = await signUpBurner(webPage, { onboard: true });

    // First genuinely elevate, so there is access to (fail to) remove.
    await gotoAccount(orgPage, burner.email);
    await elevateVisibleRow(orgPage);
    await gotoAccount(orgPage, burner.email);
    await expect(rowRemoveButton(orgPage)).toBeVisible();

    // Open the demote dialog and dismiss it (Cancel).
    const demoteDialog = await openDemoteDialog(orgPage);
    await demoteDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(demoteDialog).toBeHidden();

    // Access is intact: still "Remove staff access" on a fresh render …
    await gotoAccount(orgPage, burner.email);
    await expect(rowRemoveButton(orgPage)).toBeVisible();

    // … and the burner can still reach the console.
    const burnerOrg = await makeAppPage("org");
    await signInAs(burnerOrg, burner, "org");
    await burnerOrg.goto("/");
    await expectConsoleReached(burnerOrg);
  });

  test("an elevation is committed durably (persists across a fresh god session)", async ({
    orgPage,
    webPage,
    makeAppPage,
  }) => {
    // NOTE ON AUDIT (task: "verify the elevation is audited"): setOrgStaffRole
    // writes the role change and its `account.elevate` audit_events row inside a
    // SINGLE transaction (apps/org/lib/actions/accounts.ts) — "access can never
    // change without its audit trail". There is no console surface that renders
    // account-level audit events (the only audit UI is per-registration), and
    // the harness deliberately has no DB back door, so the audit ROW itself is
    // not directly assertable here. The honest observable proxy is DURABILITY:
    // an elevation that survives a fresh server render AND a brand-new god
    // session is one that committed the whole transaction — audit row included.
    // Direct audit-row assertion is a documented gap (needs an action-level test,
    // roadmap M3-03, or a future audit surface).
    await elevateToGod(orgPage);
    const burner = await signUpBurner(webPage, { onboard: true });

    await gotoAccount(orgPage, burner.email);
    await elevateVisibleRow(orgPage);
    await gotoAccount(orgPage, burner.email);
    await expect(rowRemoveButton(orgPage)).toBeVisible();

    // A brand-new god browser context re-reads the same durable server state.
    const creds = godCredentials()!;
    const freshGod = await makeAppPage("org");
    await signInAs(freshGod, creds, "org");
    await gotoAccount(freshGod, burner.email);
    await expect(rowRemoveButton(freshGod)).toBeVisible();
    await expect(rowElevateButton(freshGod)).toHaveCount(0);
  });
});
