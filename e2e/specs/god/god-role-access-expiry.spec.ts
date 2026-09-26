// god-role-access-expiry.spec.ts — ORG ROLE ASSIGNMENTS CAN END (SEC-019).
//
// Sessions and invites expire; org role assignments used not to, so seasonal
// staff kept console access forever. A System manager can now give each
// assigned role an inclusive "last day of access" in the assignment dialog.
//
// What only a browser can prove here is the ROUND TRIP: the day picked in the
// dialog is stored, comes back on a fresh server render as the same day on the
// row, re-opens in the dialog as that day, and clears back to "no end date".
// Whether an EXPIRED assignment grants nothing is proved without a browser —
// the resolver (org-role-lockout.test.ts), the SQL predicate
// (packages/db org-role-expiry.test.ts) and the accounts projection
// (queries-projection.test.ts) — because a past last day cannot be entered
// through this dialog at all: the action refuses one.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { elevateToGod, signUpBurner } from "../../personas/factories";
import { elevateVisibleRow, gotoAccount } from "./support";

const LAST_DAY = "2099-12-31";
const LAST_DAY_TEXT = /until 31 december 2099/i;

test.describe("system manager · access expiry on org role assignments", () => {
  test.beforeEach(() => {
    skipUnlessGod();
  });

  test("a last day of access round-trips through the dialog and the row, and clears", async ({
    orgPage,
    webPage,
  }) => {
    await elevateToGod(orgPage);
    const burner = await signUpBurner(webPage, { onboard: true });

    // Elevation grants the door plus the seeded Org staff role — one role to
    // put an end date on.
    await gotoAccount(orgPage, burner.email);
    await elevateVisibleRow(orgPage);
    await gotoAccount(orgPage, burner.email);
    // Present first: the row has rendered its resolved grants…
    await expect(
      orgPage.getByText(/can permanently destroy records/i).first(),
    ).toBeVisible();
    // …and only then the absence: no end date yet.
    await expect(orgPage.getByText(LAST_DAY_TEXT)).toHaveCount(0);

    const openRoles = async () => {
      await orgPage
        .getByRole("button", { name: "Roles", exact: true })
        .filter({ visible: true })
        .click();
      const dialog = orgPage.getByRole("dialog");
      await expect(
        dialog.getByText(/with this selection, they will be able to/i),
      ).toBeVisible();
      return dialog;
    };

    // SET IT.
    let dialog = await openRoles();
    const field = dialog.getByLabel(/last day of access/i).first();
    await expect(field).toHaveValue("");
    await field.fill(LAST_DAY);
    await expect(
      dialog.getByText(/access through 31 december 2099/i),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Save roles" }).click();
    await expect(orgPage.getByText(/roles saved/i)).toBeVisible();

    // STORED: a fresh server render shows it on the row, and the grant still
    // resolves — a future end date takes nothing away today.
    await gotoAccount(orgPage, burner.email);
    await expect(orgPage.getByText(LAST_DAY_TEXT).first()).toBeVisible();
    await expect(
      orgPage.getByText(/can permanently destroy records/i).first(),
    ).toBeVisible();

    // RE-OPENS AS THE SAME DAY, then CLEARS.
    dialog = await openRoles();
    await expect(dialog.getByLabel(/last day of access/i).first()).toHaveValue(
      LAST_DAY,
    );
    await dialog.getByRole("button", { name: "No end date" }).first().click();
    await expect(
      dialog.getByText(/no end date — holds until someone removes it/i).first(),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Save roles" }).click();
    await expect(orgPage.getByText(/roles saved/i)).toBeVisible();

    await gotoAccount(orgPage, burner.email);
    await expect(
      orgPage.getByText(/can permanently destroy records/i).first(),
    ).toBeVisible();
    await expect(orgPage.getByText(LAST_DAY_TEXT)).toHaveCount(0);
  });
});
