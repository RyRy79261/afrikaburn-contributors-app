// god-privilege-escalation-refused.spec.ts — the GOD ADMIN negative space.
//
// Proves the escalation ceiling holds from every angle:
//   1. A non-org burner cannot reach the accounts surface at all (server gate).
//   2. An org_staff account reaching the accounts surface is offered NO
//      role-mutating control, and the panel says so — access changes are the
//      system owner's alone.
//   3. Even a god cannot MINT another god through the panel: the only account
//      action, setOrgStaffRole, tops out at org_staff. There is no god-granting
//      affordance anywhere, and god itself comes solely from GOD_EMAILS.
//   4. A god cannot manage the god membership from the panel — their own row is
//      inert ("You"), so god cannot self-demote or reassign god here either.
//
// On the org_staff→god path specifically: the sole god-only server boundary is
// setOrgStaffRole (`requireOrgSession({ god: true })`). There is no org_staff-
// reachable trigger for it — which is the correct posture, not a gap — so the
// server refusal of a non-god CALLER is covered by the action-level tests
// (roadmap M3-02/M3-03), while this file proves, end-to-end, that no UI path
// exposes escalation to an org_staff and that the action's OUTCOME can never be
// god. (Hidden controls are asserted here as a supporting fact, never as the
// security boundary — the boundary is the server action's god check.)

import { test, expect, skipUnlessGod } from "../../fixtures";
import { elevateToGod, signInAs, signUpBurner } from "../../personas/factories";
import {
  elevateVisibleRow,
  expectConsoleForbidden,
  gotoAccount,
  rowElevateButton,
  rowRemoveButton,
} from "./support";

test.describe("god privilege-escalation refused", () => {
  test.beforeEach(() => {
    skipUnlessGod();
  });

  test("a non-org burner is refused the accounts surface", async ({
    orgPage,
    webPage,
  }) => {
    const burner = await signUpBurner(webPage, { onboard: true });
    await signInAs(orgPage, burner, "org");
    // The server gate replaces the whole console — the accounts data never loads.
    await orgPage.goto("/accounts");
    await expectConsoleForbidden(orgPage);
    // Belt and braces: no accounts search field rendered behind the gate.
    await expect(
      orgPage.getByRole("searchbox", {
        name: /search accounts by email or username/i,
      }),
    ).toHaveCount(0);
  });

  test("org_staff can view accounts but is offered no way to change any role", async ({
    orgPage,
    webPage,
    makeAppPage,
  }) => {
    // God elevates a burner to org_staff (the real, sanctioned path).
    await elevateToGod(orgPage);
    const staff = await signUpBurner(webPage, { onboard: true });
    await gotoAccount(orgPage, staff.email);
    await elevateVisibleRow(orgPage);
    await gotoAccount(orgPage, staff.email);
    await expect(rowRemoveButton(orgPage)).toBeVisible();

    // The freshly-elevated org_staff opens the accounts panel themselves.
    const staffOrg = await makeAppPage("org");
    await signInAs(staffOrg, staff, "org");
    await staffOrg.goto(`/accounts?q=${encodeURIComponent(staff.email)}`);

    // They reached the surface (org_staff may read it) …
    await expect(
      staffOrg.getByRole("searchbox", {
        name: /search accounts by email or username/i,
      }),
    ).toBeVisible();
    // … but the copy tells them access is the owner's to change …
    await expect(
      staffOrg.getByText(/only the system owner can change access/i),
    ).toBeVisible();
    // … and NO elevate/demote control is rendered for any row.
    await expect(rowElevateButton(staffOrg)).toHaveCount(0);
    await expect(rowRemoveButton(staffOrg)).toHaveCount(0);
    // No god-granting affordance exists on the surface at all.
    await expect(
      staffOrg.getByRole("button", { name: /owner|make god|grant god/i }),
    ).toHaveCount(0);
  });

  test("even a god cannot grant god through the panel — the ceiling is org staff", async ({
    orgPage,
    webPage,
  }) => {
    await elevateToGod(orgPage);
    const burner = await signUpBurner(webPage, { onboard: true });

    // Elevate — the maximum the action can do.
    await gotoAccount(orgPage, burner.email);
    await elevateVisibleRow(orgPage);

    // On a fresh render the elevated row is org_staff ("Org staff" badge +
    // "Remove staff access"), NEVER a god row — the elevate action cannot produce
    // god. A god row would render "System owner — cannot change"; this one never
    // does. (We don't assert the header's "Owner" badge absent — that badge is
    // the god VIEWER's own role, present on every console page.)
    await gotoAccount(orgPage, burner.email);
    await expect(rowRemoveButton(orgPage)).toBeVisible();
    await expect(
      orgPage.getByText("Org staff", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      orgPage.getByText(/system owner — cannot change/i),
    ).toHaveCount(0);
    // No god-granting affordance exists on the surface at all.
    await expect(
      orgPage.getByRole("button", { name: /make (god|owner)|grant god/i }),
    ).toHaveCount(0);
  });

  test("a god cannot manage the god membership from the panel (own row is inert)", async ({
    orgPage,
  }) => {
    const { email } = await elevateToGod(orgPage);

    // The god searches for their OWN account. A god row is inert for everyone —
    // it renders "System owner — cannot change" (the role===god branch, which
    // precedes the self branch) and exposes no elevate/demote control. God cannot
    // self-demote or reassign the god membership here; GOD_EMAILS is the only
    // lever. (Even the server action refuses a god target and a self target.)
    await gotoAccount(orgPage, email);
    await expect(
      orgPage.getByText(/system owner — cannot change/i).first(),
    ).toBeVisible();
    await expect(rowElevateButton(orgPage)).toHaveCount(0);
    await expect(rowRemoveButton(orgPage)).toHaveCount(0);
  });
});
