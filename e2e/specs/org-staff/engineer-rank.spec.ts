// Persona: ENGINEER — the org console's IT rank.
//
// Ryan's brief (27 Jul 2026): "IT can have two ranks, engineer, and system
// manager. Engineer cant see personal information, and cant delete things, but
// has access everywhere."
//
// So there are three things to prove, and this spec proves them in that order:
//   1. ACCESS EVERYWHERE — the engineer reaches the same console pages org staff
//      do. A rank that got a cut-down console would not be the rank Ryan asked
//      for, and a "cannot" suite that never checks the "can" half is how a
//      permission quietly becomes a lockout.
//   2. NO PERSONAL INFORMATION — the accounts list carries no email addresses,
//      and the search box does not even offer to match on one (a search that
//      matched would be a "does this address have an account?" oracle for
//      exactly the data the rank may not hold).
//   3. NOTHING DESTRUCTIVE, AND NO CATEGORY CRUD — the controls are gone.
//
// HONEST SCOPE NOTE (registry §"TWO TIERS OF PROOF"). What is asserted here is
// the observable contract: which surfaces render, and what is absent from them.
// The server-side refusals — `requireOrgSession({ capability: "delete" })`,
// `{ capability: "manage_camp_categories" }`, and the queries that never SELECT
// a personal column — have no client entry point for an engineer, so their
// guard-deletion proof lives in the unit gate:
//   · packages/core/src/__tests__/org-permissions.test.ts   (the matrix itself)
//   · apps/org/lib/__tests__/org-rank-enforcement.test.ts   (the console obeys it)
// Delete a capability check or move a column out of its conditional and THOSE go
// red immediately.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { provisionEngineer, desktopOnly } from "./_helpers";

test.describe("engineer · reads everywhere, sees nobody, deletes nothing", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("reaches the console's pages like any other rank", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const engineer = await provisionEngineer(makeAppPage);

    // The rank is named honestly in the chrome (and `god` renders as "System
    // manager" for the same reason — one label map, one source of truth).
    await engineer.org.goto("/");
    await expect(engineer.org.getByText("Engineer").first()).toBeVisible();

    for (const [path, heading] of [
      ["/registrations", /registration pipeline/i],
      ["/suppliers", /supplier repository/i],
      ["/categories", /camp categories/i],
      ["/accounts", /accounts/i],
      ["/audit", /audit log/i],
    ] as const) {
      await engineer.org.goto(path);
      await expect(
        engineer.org.getByRole("heading", { name: heading }),
      ).toBeVisible();
    }
  });

  test("gets no email addresses on the accounts list, and no email search", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const engineer = await provisionEngineer(makeAppPage);

    await engineer.org.goto("/accounts?q=");
    // The rank is told plainly why the column is missing.
    await expect(
      engineer.org.getByText(/don't see email addresses/i),
    ).toBeVisible();
    // The search field itself narrows to the username.
    await expect(
      engineer.org.getByLabel(/search accounts by username/i),
    ).toBeVisible();
    // Their OWN row certainly exists in that table, so if any address were being
    // shipped this is where it would show. Scoped to the visible layout: the
    // ResponsiveDataTable renders BOTH the desktop table and the mobile cards
    // into the DOM at once (see specs/god/support.ts). Not scoped to the whole
    // page, because the header legitimately shows the SIGNED-IN user their own
    // address — that is self-access, not a rank leak.
    const list = engineer.org
      .getByRole("table", { name: /accounts/i })
      .filter({ visible: true })
      .first();
    await expect(list).not.toContainText(engineer.account.email);
  });

  test("is offered no destructive controls and no category CRUD", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const engineer = await provisionEngineer(makeAppPage);

    // Categories: readable, with the reason stated, and no way to change them.
    await engineer.org.goto("/categories");
    await expect(
      engineer.org.getByText(/managed by a system manager/i),
    ).toBeVisible();
    await expect(
      engineer.org.getByRole("button", { name: /^add category$/i }),
    ).toHaveCount(0);
    await expect(
      engineer.org.getByRole("button", { name: /^delete / }),
    ).toHaveCount(0);

    // Accounts: no access management at all (that is `manage_accounts`).
    await engineer.org.goto("/accounts?q=");
    await expect(
      engineer.org.getByRole("button", { name: /elevate to org staff/i }),
    ).toHaveCount(0);
    await expect(
      engineer.org.getByRole("button", { name: /remove staff access/i }),
    ).toHaveCount(0);
  });

  test("cannot read the medical-notes access log, and is told why", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const engineer = await provisionEngineer(makeAppPage);

    // A `bio.medical.view` row only exists when its subject HAS notes, so the
    // panel is a list of who has disclosed a health condition. Withheld whole —
    // there is no redaction of it that is not still that list.
    await engineer.org.goto("/audit");
    await expect(
      engineer.org.getByRole("heading", { name: /audit log/i }),
    ).toBeVisible();
    await expect(
      engineer.org.getByText(/don't see personal information/i),
    ).toBeVisible();
  });
});
