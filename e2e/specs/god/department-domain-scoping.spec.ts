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
import {
  createCamp,
  elevateToGod,
  signInAs,
  signUpBurner,
  submitRegistration,
} from "../../personas/factories";
import { openRegistrationInConsole } from "../camp-lead/support";
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
      orgPage
        .getByText(/owns no part of the console, so this reaches nothing/i)
        .first(),
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
    await expect(
      orgPage.getByText(/saved what this department owns/i),
    ).toBeVisible();

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

  test("a supply lead is refused the DECISION on someone else's department, and told whose it is", async ({
    orgPage,
    webPage,
    makeAppPage,
  }) => {
    // THE FOREIGN-DEPARTMENT BRANCH. The suite proved a departmental grant does
    // not reach a domain NOBODY owns (accounts, audit — the test below). It had
    // never proved the other branch: a domain ANOTHER department owns, whose
    // refusal is a different sentence written by `scopeReason` and which names
    // the owner so the reader knows where to send the work.
    //
    // Registrations is the sharpest case. Approve and Reject are the console's
    // most consequential controls and until 28 Jul 2026 they rendered live for
    // every account, refusing only in a toast after the click.
    // DEPARTMENT OWNERSHIP IS DEPLOYMENT-WIDE STATE, so the teardown is in a
    // `finally`. Giving a department the `registrations` domain changes what
    // EVERY other spec's org_staff account may decide; a run that died between
    // the assignment and the delete would leave the whole review suite refused,
    // and the next person would be debugging their own change.
    await elevateToGod(orgPage);
    await orgPage.goto("/system/roles");
    const created: string[] = [];
    try {
      // Two departments: one owns suppliers, the other owns registrations.
      const supply = departmentName();
      const placement = departmentName();
      for (const [name, owns] of [
        [supply, /the supplier repository/i],
        [placement, /registration/i],
      ] as const) {
        await orgPage.getByLabel(/new department/i).fill(name);
        await orgPage.getByRole("button", { name: /add department/i }).click();
        await expect(orgPage.getByText(/department created/i)).toBeVisible();
        created.push(name);
        await orgPage
          .getByRole("button", { name: `Choose what ${name} owns` })
          .click();
        const dialog = orgPage.getByRole("dialog");
        await dialog.getByLabel(owns).first().check();
        await dialog
          .getByRole("button", { name: /save what it owns/i })
          .click();
        await expect(
          orgPage.getByText(/saved what this department owns/i),
        ).toBeVisible();
      }

      // A person holding ONLY the supply department's lead role.
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
      // The org-wide "Org staff" role elevation grants by default reaches
      // everything, which would make this prove nothing.
      for (const box of await roles.getByRole("checkbox").all()) {
        if (await box.isChecked()) await box.uncheck();
      }
      await roles.getByLabel(new RegExp(`${supply} lead`, "i")).check();
      await roles.getByRole("button", { name: /save roles/i }).click();
      await expect(orgPage.getByText(/roles saved/i)).toBeVisible();

      // A REGISTRATION IN A DECIDABLE STATE, built by this spec. Opening whatever
      // happens to sit at the top of the queue is not good enough: a draft offers
      // no Approve at all (`availableReviewActions`), so the assertion below would
      // pass on an empty panel and prove nothing.
      const campLead = await makeAppPage("web");
      await signUpBurner(campLead, { onboard: true });
      const camp = await createCamp(campLead, {
        description: "Tea and shade.",
      });
      await submitRegistration(campLead, camp.slug);

      // THE PROOF. The queue still OPENS — read is not a page gate, and Ryan asked
      // for transparency with restrictions rather than obfuscation — but the
      // decision is refused, in place, by name.
      const leadOrg = await makeAppPage("org");
      await signInAs(leadOrg, burner, "org");
      await openRegistrationInConsole(leadOrg, camp.name);

      const approve = leadOrg.getByRole("button", {
        name: /approve — not available to you/i,
      });
      await expect(approve).toBeVisible();
      await expect(approve).toBeDisabled();
      // Present and disabled, never hidden — and never live.
      await expect(
        leadOrg.getByRole("button", { name: /^approve$/i }),
      ).toHaveCount(0);

      // …and the reason NAMES THE OWNING DEPARTMENT, which is the whole point of
      // the foreign-domain branch: "your role does not reach here" would leave a
      // supply lead with nobody to hand the registration to.
      await expect(
        leadOrg.getByText(/in your own department only/i),
      ).toBeVisible();
      await expect(leadOrg.getByText(new RegExp(placement, "i"))).toBeVisible();
    } finally {
      await orgPage.goto("/system/roles");
      for (const name of created) {
        const trigger = orgPage.getByRole("button", { name: `Delete ${name}` });
        if ((await trigger.count()) === 0) continue;
        await trigger.click();
        await orgPage
          .getByRole("dialog")
          .getByRole("button", { name: /delete department and its roles/i })
          .click();
        await expect(orgPage.getByText(/department deleted/i)).toBeVisible();
      }
    }
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
    await expect(
      orgPage.getByText(/saved what this department owns/i),
    ).toBeVisible();

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
    await expect(leadOrg.getByPlaceholder(/search by username/i)).toBeVisible();

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
