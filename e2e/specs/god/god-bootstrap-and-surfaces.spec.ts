// god-bootstrap-and-surfaces.spec.ts — the GOD ADMIN happy path, part 1.
//
// Proves the two foundational god facts:
//   1. GOD_EMAILS bootstrap: a pre-provisioned account whose email is on the
//      deployment's GOD_EMAILS list AND is verified self-elevates to `god` on
//      first authenticated load of the console (resolveOrgSession bootstrap).
//   2. A god can reach EVERY console surface — no org surface is closed to it.
//
// God cannot be minted through the UI (canBootstrapGod needs a verified, listed
// email; a fresh sign-up is never verified when mail is off), so these run only
// against a pre-provisioned E2E_GOD_EMAIL/E2E_GOD_PASSWORD and skip otherwise.
// Both projects (desktop + mobile-360) exercise this.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { elevateToGod } from "../../personas/factories";
import {
  consoleNav,
  expectConsoleReached,
  expectGodPrivileges,
} from "./support";

// Every entry in the console header nav (apps/org/components/console-header.tsx).
// A god must clear the gate on each — the suite fails loudly if a new surface is
// added that a god cannot reach, or if one silently starts refusing god.
const CONSOLE_SURFACES: Array<{ path: string; label: string }> = [
  { path: "/", label: "Overview" },
  { path: "/status", label: "Status board" },
  { path: "/registrations", label: "Registrations" },
  { path: "/questionnaires", label: "Questionnaires" },
  { path: "/bulletins", label: "Bulletins" },
  { path: "/suppliers", label: "Suppliers" },
  { path: "/categories", label: "Categories" },
  { path: "/accounts", label: "Accounts" },
  { path: "/audit", label: "Audit" },
  // The IT panel, and the roles surface INSIDE it (org roles v1). `/system` is
  // `read_system` (engineer + System manager); `/system/roles` renders its
  // controls only for the anchor. Both are listed with the "System" nav label
  // because the nav marks a parent entry active for its children — so this also
  // proves the sub-route did not fall out of the bar.
  { path: "/system", label: "System" },
  { path: "/system/roles", label: "System" },
];

test.describe("god bootstrap + console reach", () => {
  test.beforeEach(() => {
    skipUnlessGod();
  });

  test("a GOD_EMAILS + verified account self-elevates to god on first console load @smoke", async ({
    orgPage,
  }) => {
    // elevateToGod signs the pre-provisioned account in and lands on the console
    // overview, where resolveOrgSession runs the bootstrap. Reaching the console
    // (chrome present, no gate) is the observable proof the god membership was
    // granted — a non-god lands on the forbidden gate instead.
    const { email } = await elevateToGod(orgPage);
    expect(email).toContain("@");
    await expectConsoleReached(orgPage);

    // …and to GOD specifically (not merely org_staff): the accounts panel shows
    // the System-manager-only pointer at the Roles screen. This is
    // viewport-robust, unlike the header Owner badge (hidden below `sm`).
    await expectGodPrivileges(orgPage);
  });

  test("a god can reach every console surface", async ({ orgPage }) => {
    await elevateToGod(orgPage);

    for (const surface of CONSOLE_SURFACES) {
      await orgPage.goto(surface.path);
      // Gate cleared on this surface (chrome present, neither gate heading shown).
      await expectConsoleReached(orgPage);
      // And the nav marks THIS surface active — we are actually on it, not
      // bounced elsewhere. Scoped to the nav so a same-named link elsewhere on
      // the page can never satisfy (or break) the assertion.
      await expect(
        consoleNav(orgPage).getByRole("link", {
          name: surface.label,
          exact: true,
        }),
      ).toHaveAttribute("aria-current", "page");
    }
  });
});
