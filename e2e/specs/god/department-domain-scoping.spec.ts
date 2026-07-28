// Persona: SYSTEM MANAGER — giving a department a part of the console, and
// watching a departmental lead's reach shrink to it.
//
// Ryan, 27 Jul 2026: "supplier leads would be able to read the PII of anything
// supply-related." The operative word is RELATED. A department owns DOMAIN KEYS
// (@quagga/core `org-domains`), an entity's department is whichever department
// owns its domain, and `read_personal_information` is department-scoped like
// `delete`.
//
// THREE THINGS ONLY A BROWSER CAN PROVE, and they are why this spec exists
// rather than only a unit test of the resolver:
//
//   1. A department that owns NOTHING says so. Before this change, a
//      department-scoped grant resolved to nothing and the console rendered it
//      as though it were access. The empty state is the state a real console
//      spends its first week in.
//   2. Assigning a domain changes what the ACCOUNTS screen says a person can
//      do — the resolved union, server-rendered by the same function the guards
//      refuse with. If the summary and the resolver ever disagree, this goes red.
//   3. A DEPARTMENTAL LEAD DOES NOT READ EVERYONE'S DETAILS. This is the
//      regression the whole change exists to prevent: the seeded department
//      lead role carries `read_personal_information`, so before scoping it, a
//      Suppliers lead read every email address in the console. The proof is a
//      real sign-in as that lead and an accounts list with no addresses on it.
//
// HONEST SCOPE NOTE (registry §"TWO TIERS OF PROOF"). What is asserted here is
// the observable contract. The resolver's own matrix — every rank × every
// capability × owned/unowned/foreign domain — is longhand in
// packages/core/src/__tests__/org-permissions.test.ts, and the console's
// obedience to it (predicate before select, per domain) in
// apps/org/lib/__tests__/org-rank-enforcement.test.ts.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { elevateToGod, signInAs, signUpBurner } from "../../personas/factories";
import { elevateVisibleRow, gotoAccount } from "./support";

/** A department name no earlier run can have taken (names are unique org-wide). */
function departmentName(): string {
  return `QA Scope ${Date.now().toString(36)}${Math.floor(Math.random() * 900 + 100)}`;
}

test.describe("system manager · what a department owns is what its roles reach", () => {
  test.beforeEach(() => {
    skipUnlessGod();
  });

  test("a department owning nothing says so, and owning suppliers says that instead", async ({
    orgPage,
  }) => {
    await elevateToGod(orgPage);
    await orgPage.goto("/system/roles");

    const name = departmentName();
    await orgPage.getByLabel(/new department/i).fill(name);
    await orgPage.getByRole("button", { name: /add department/i }).click();
    await expect(orgPage.getByText(/department created/i)).toBeVisible();

    // (1) BORN OWNING NOTHING — and it does not pretend otherwise. A role
    // scoped here would look granted and grant nothing, so the screen warns
    // before anyone assigns one rather than after someone is refused.
    await expect(
      orgPage.getByText(/owns no part of the console yet/i).first(),
    ).toBeVisible();

    // …and the lead role's own summary agrees: its sharp rights reach nothing.
    await expect(
      orgPage.getByText(/owns no part of the console, so this reaches nothing/i).first(),
    ).toBeVisible();

    // (2) GIVE IT THE SUPPLY-RELATED PART OF THE CONSOLE.
    await orgPage
      .getByRole("button", { name: `Choose what ${name} owns` })
      .click();
    const owns = orgPage.getByRole("dialog");
    await expect(owns).toBeVisible();
    // The dialog is explicit that this is a personal-information decision, not
    // an org-chart one.
    await expect(
      owns.getByText(/whose contact details and medical notes/i),
    ).toBeVisible();
    // Named explicitly rather than "the first checkbox": the domain list has an
    // order, and a spec that silently follows it stops proving what it says.
    await owns.getByLabel(/the supplier repository/i).check();
    await owns.getByRole("button", { name: /save what it owns/i }).click();
    await expect(orgPage.getByText(/saved what this department owns/i)).toBeVisible();

    // (3) DURABLE, AND RESOLVED. A fresh server render shows the ownership on
    // the department and the lead role's delete confined to it BY NAME.
    await orgPage.goto("/system/roles");
    const departmentBlock = orgPage
      .locator("div")
      .filter({ hasText: new RegExp(`^${name}`) })
      .first();
    await expect(departmentBlock).toContainText(/owns/i);
    await expect(
      orgPage.getByText(new RegExp(`in ${name} only`, "i")).first(),
    ).toBeVisible();

    // Clean up: the department and its two seeded roles go together, and the
    // domain it held goes back to being owned by nobody (which the confirm says).
    await orgPage.getByRole("button", { name: `Delete ${name}` }).click();
    const confirm = orgPage.getByRole("dialog");
    await expect(confirm).toBeVisible();
    await expect(
      confirm.getByText(/goes back to being owned by nobody/i),
    ).toBeVisible();
    await confirm
      .getByRole("button", { name: /delete department and its roles/i })
      .click();
    await expect(orgPage.getByText(/department deleted/i)).toBeVisible();
  });

  test("a departmental lead reads NO email addresses — the scoped PII rule, in a browser", async ({
    orgPage,
    webPage,
    makeAppPage,
  }) => {
    await elevateToGod(orgPage);

    // A department that owns the supply side of the console…
    await orgPage.goto("/system/roles");
    const name = departmentName();
    await orgPage.getByLabel(/new department/i).fill(name);
    await orgPage.getByRole("button", { name: /add department/i }).click();
    await expect(orgPage.getByText(/department created/i)).toBeVisible();
    await orgPage
      .getByRole("button", { name: `Choose what ${name} owns` })
      .click();
    const owns = orgPage.getByRole("dialog");
    await owns.getByLabel(/the supplier repository/i).check();
    await owns.getByRole("button", { name: /save what it owns/i }).click();
    await expect(orgPage.getByText(/saved what this department owns/i)).toBeVisible();

    // …and a real person holding ONLY that department's lead role. The seeded
    // lead role carries `read_personal_information`, which is exactly why this
    // is the interesting case: the grant is real, and it is confined.
    const burner = await signUpBurner(webPage, { onboard: true });
    await gotoAccount(orgPage, burner.email);
    await elevateVisibleRow(orgPage);

    await gotoAccount(orgPage, burner.email);
    await orgPage
      .getByRole("button", { name: "Roles", exact: true })
      .filter({ visible: true })
      .click();
    const roles = orgPage.getByRole("dialog");
    await expect(roles).toBeVisible();
    // Exactly one role: the department's lead. Elevation assigns the org-wide
    // "Org staff" role by default, and leaving it on would make this prove
    // nothing — an org-wide grant reaches everything by design.
    for (const box of await roles.getByRole("checkbox").all()) {
      if (await box.isChecked()) await box.uncheck();
    }
    await roles.getByLabel(new RegExp(`${name} lead`, "i")).check();
    await roles.getByRole("button", { name: /save roles/i }).click();
    await expect(orgPage.getByText(/roles saved/i)).toBeVisible();

    // THE PROOF. Signed in as that lead: the console opens, and the accounts
    // screen carries no email addresses — the `accounts` domain belongs to no
    // department, so a departmental grant does not reach it. Before personal
    // information was scoped, this same account read every address here.
    const leadOrg = await makeAppPage("org");
    await signInAs(leadOrg, burner, "org");
    // An EMPTY query, deliberately: searching by their own address would return
    // nothing (a refused caller's search matches usernames only, so the box is
    // not an oracle) and an empty table proves nothing about withheld columns.
    // The unfiltered list contains their freshly-created row.
    await leadOrg.goto("/accounts?q=");
    await expect(
      leadOrg.getByRole("heading", { name: /accounts/i }).first(),
    ).toBeVisible();
    // The page states the reason, and states the RIGHT one — a department lead
    // is not an engineer, and being told they are is the kind of small lie that
    // teaches people to stop reading the console.
    await expect(
      leadOrg.getByText(/in your own department only/i),
    ).toBeVisible();
    // No address in the TABLE. Scoped to the table on purpose: the console
    // header names the signed-in account, which is their own address shown back
    // to them and not a disclosure — the rule is about other people's data
    // arriving in a payload, and the row is where that would happen.
    await expect(
      leadOrg.getByRole("table").getByText(burner.email),
    ).toHaveCount(0);
    // …and the search box does not offer to match one either, because a match
    // would be an oracle for exactly the data they may not hold.
    await expect(
      leadOrg.getByPlaceholder(/search by username/i),
    ).toBeVisible();

    // The medical-notes census is refused whole, for the same reason: the audit
    // log spans every camp, and no department owns it.
    await leadOrg.goto("/audit");
    await expect(
      leadOrg.getByRole("heading", { name: /audit log/i }),
    ).toBeVisible();
    await expect(
      leadOrg.getByText(/in your own department only/i),
    ).toBeVisible();

    // Clean up the department (its roles and this person's hold on them go too).
    await orgPage.goto("/system/roles");
    await orgPage.getByRole("button", { name: `Delete ${name}` }).click();
    await orgPage
      .getByRole("dialog")
      .getByRole("button", { name: /delete department and its roles/i })
      .click();
    await expect(orgPage.getByText(/department deleted/i)).toBeVisible();
  });
});
