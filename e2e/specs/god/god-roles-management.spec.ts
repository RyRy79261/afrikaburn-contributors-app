// god-roles-management.spec.ts — DEPARTMENTS, ROLES AND WHAT THEY COST.
//
// Org roles v1 made console permissions DATA (migration 0018): a System manager
// creates departments, edits what each role may do, and decides who holds them.
// Three things about that surface can only be proved in a browser, and each is a
// promise the product makes in words rather than in types:
//
//   1. CREATING A DEPARTMENT SEEDS ITS PERMANENT PAIR. "Team leads and team
//      members for each department domain" (Ryan, 27 Jul 2026) — one form
//      submission has to produce two roles, named after the department, marked
//      permanent. A unit test can prove `departmentRoleRows` returns two rows;
//      only this can prove the screen actually creates them.
//   2. PERMANENCE IS EXPLAINED, NOT GREYED OUT. The lead role offers NO delete
//      control at all, and says why — a disabled button with no explanation
//      teaches nobody the rule, and this is the screen where not knowing the
//      rule costs someone their access.
//   3. DELETING SAYS WHAT IT COSTS BEFORE IT COSTS IT. The confirm names every
//      role that dies with the department and every person who loses one.
//      "Nobody is silently stripped" is a claim about rendered copy, which is
//      exactly the class of claim static analysis cannot check.
//
// The surface lives INSIDE the system panel (`/system/roles`), reached from the
// panel's own card, so this drives it the way a System manager would rather than
// by typing a URL.
//
// Department names are per-run unique: role and department names are unique
// (normalized) across the org, and this suite runs against a database that
// persists between runs.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { elevateToGod, signInAs, signUpBurner } from "../../personas/factories";
import { elevateVisibleRow, gotoAccount } from "./support";

/** A department name no earlier run can have taken. */
function departmentName(): string {
  return `QA Dept ${Date.now().toString(36)}${Math.floor(Math.random() * 900 + 100)}`;
}

test.describe("system manager · departments, roles and what deleting costs", () => {
  test.beforeEach(() => {
    skipUnlessGod();
  });

  test("a new department arrives with two permanent roles, and deleting it says what goes with it", async ({
    orgPage,
  }) => {
    await elevateToGod(orgPage);

    // Reached the way it is meant to be reached: from the system panel.
    await orgPage.goto("/system");
    await orgPage
      .getByRole("link", { name: /manage roles and departments/i })
      .click();
    await expect(
      orgPage.getByRole("heading", { name: /roles and departments/i }),
    ).toBeVisible();

    // The org-wide roles come FIRST — they are what most people hold, and the
    // two seeded ones carry what the hardcoded ranks used to.
    await expect(orgPage.getByText("Org staff").first()).toBeVisible();
    await expect(orgPage.getByText("Engineer").first()).toBeVisible();

    const name = departmentName();
    await orgPage.getByLabel(/new department/i).fill(name);
    await orgPage.getByRole("button", { name: /add department/i }).click();
    await expect(orgPage.getByText(/department created/i)).toBeVisible();

    // (1) THE PAIR. Both seeded, both named after the department.
    const lead = `${name} lead`;
    const member = `${name} member`;
    await expect(orgPage.getByText(lead, { exact: true })).toBeVisible();
    await expect(orgPage.getByText(member, { exact: true })).toBeVisible();

    // (2) PERMANENCE, EXPLAINED. Open the lead role's editor: no delete control
    // anywhere in it, and the reason is legible.
    await orgPage
      .getByRole("button", { name: `Edit rights for ${lead}` })
      .click();
    const editor = orgPage.getByRole("dialog");
    await expect(editor).toBeVisible();
    await expect(
      editor.getByRole("button", { name: /delete role/i }),
    ).toHaveCount(0);
    await expect(editor.getByText(new RegExp(`permanent: ${name}`, "i"))).toBeVisible();

    // The checklist speaks in consequences, not in permission keys — this is the
    // screen where someone decides what a colleague can destroy.
    await expect(
      // The delete copy no longer names one department's things: it used to say
      // "permanently remove suppliers and their documents" on EVERY department's
      // rights screen, which is the defect that prompted the CRUD rework. It now
      // describes the verb, and the domain list beside it says where it lands.
      editor.getByText(/permanently destroys records/i),
    ).toBeVisible();
    // …and the draft is resolved back to them before they save it.
    await expect(
      editor.getByText(/someone whose only role is this can/i),
    ).toBeVisible();
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor).toBeHidden();

    // (3) DELETING SAYS WHAT IT COSTS. Both roles are named in the confirm, and
    // nobody holds them yet — which the dialog says out loud rather than leaving
    // the reader to assume.
    await orgPage.getByRole("button", { name: `Delete ${name}` }).click();
    const confirm = orgPage.getByRole("dialog");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(lead, { exact: true })).toBeVisible();
    await expect(confirm.getByText(member, { exact: true })).toBeVisible();
    await expect(confirm.getByText(/nobody holds any of them/i)).toBeVisible();

    await confirm
      .getByRole("button", { name: /delete department and its roles/i })
      .click();
    await expect(orgPage.getByText(/department deleted/i)).toBeVisible();

    // Durable: a fresh server render has neither the department nor its roles.
    await orgPage.goto("/system/roles");
    await expect(orgPage.getByText(lead, { exact: true })).toHaveCount(0);
    await expect(orgPage.getByText(member, { exact: true })).toHaveCount(0);
  });

  test("dismissing the delete-department confirm destroys nothing", async ({
    orgPage,
  }) => {
    await elevateToGod(orgPage);
    await orgPage.goto("/system/roles");

    const name = departmentName();
    await orgPage.getByLabel(/new department/i).fill(name);
    await orgPage.getByRole("button", { name: /add department/i }).click();
    await expect(orgPage.getByText(/department created/i)).toBeVisible();

    await orgPage.getByRole("button", { name: `Delete ${name}` }).click();
    await orgPage
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(orgPage.getByRole("dialog")).toBeHidden();

    // Still there on a fresh render — the dismissal did not act.
    await orgPage.goto("/system/roles");
    await expect(
      orgPage.getByText(`${name} lead`, { exact: true }),
    ).toBeVisible();

    // Clean up after ourselves: the database persists between runs.
    await orgPage.getByRole("button", { name: `Delete ${name}` }).click();
    await orgPage
      .getByRole("dialog")
      .getByRole("button", { name: /delete department and its roles/i })
      .click();
    await expect(orgPage.getByText(/department deleted/i)).toBeVisible();
  });

  test("the accounts screen answers 'what can this person delete?' without leaving it", async ({
    orgPage,
    webPage,
  }) => {
    await elevateToGod(orgPage);
    const burner = await signUpBurner(webPage, { onboard: true });

    // Elevation grants the DOOR and the seeded Org staff role with it, so the
    // resolved answer is immediately meaningful.
    await gotoAccount(orgPage, burner.email);
    await elevateVisibleRow(orgPage);
    await gotoAccount(orgPage, burner.email);

    // THE RESOLVED UNION, on the row — not a role chip a reviewer has to decode.
    // The seeded Org staff role carries `delete`, so the honest answer here is
    // that this person can permanently remove suppliers.
    await expect(
      orgPage
        .getByText(/can permanently remove suppliers and their documents/i)
        .first(),
    ).toBeVisible();

    // And the live preview in the assignment dialog resolves the DRAFT, so the
    // consequence is read before it is saved rather than after.
    await orgPage
      .getByRole("button", { name: "Roles", exact: true })
      .filter({ visible: true })
      .click();
    const dialog = orgPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/with this selection, they will be able to/i),
    ).toBeVisible();

    // Untick every role: the preview must say the console opens empty — the
    // fail-closed state, said out loud instead of discovered.
    for (const box of await dialog.getByRole("checkbox").all()) {
      if (await box.isChecked()) await box.uncheck();
    }
    await expect(
      dialog.getByText(/they keep console access and it opens empty/i),
    ).toBeVisible();

    // Dismissed, so nothing was saved: the row still resolves the same answer.
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await gotoAccount(orgPage, burner.email);
    await expect(
      orgPage
        .getByText(/can permanently remove suppliers and their documents/i)
        .first(),
    ).toBeVisible();
  });

  test("an org staff account is refused the roles surface it can see the effects of", async ({
    orgPage,
    webPage,
    makeAppPage,
  }) => {
    await elevateToGod(orgPage);
    const burner = await signUpBurner(webPage, { onboard: true });
    await gotoAccount(orgPage, burner.email);
    await elevateVisibleRow(orgPage);

    // The elevated account reaches the console — and is refused the surface that
    // decides what it may do. `manage_accounts` is not grantable to any role, so
    // this refusal cannot be edited away by anyone but a System manager.
    const staffOrg = await makeAppPage("org");
    await signInAs(staffOrg, burner, "org");
    await staffOrg.goto("/system/roles");
    await expect(
      staffOrg.getByRole("heading", { name: /roles and departments/i }),
    ).toBeVisible();
    await expect(staffOrg.getByText(/not your screen/i)).toBeVisible();
    await expect(
      staffOrg.getByRole("button", { name: /add department/i }),
    ).toHaveCount(0);
  });
});
