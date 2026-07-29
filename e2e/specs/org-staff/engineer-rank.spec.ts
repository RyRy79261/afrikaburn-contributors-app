// Persona: ENGINEER — the org console's IT rank.
//
// Ryan's brief (27 Jul 2026): "IT can have two ranks, engineer, and system
// manager. Engineer cant see personal information, and cant delete things, but
// has access everywhere." Refined the same day: "You can consider an engineer as
// part of all staff… they're a step up" — so "access everywhere" became literal
// REACH (an engineer is in every department) while the two carve-outs became a
// ceiling on the RANK rather than a default on the seeded row. Broader in reach,
// deliberately narrower in depth.
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
//   3. NOTHING DESTRUCTIVE, AND NO CATEGORY CRUD — the controls are PRESENT,
//      DISABLED, and each says why. Ryan, 28 Jul 2026: "I'd rather things be
//      transparent with restrictions than completely obfuscated, except for
//      private personal information." A control that vanishes teaches nobody
//      they were restricted; it teaches them the console lacks the feature.
//
// HONEST SCOPE NOTE (registry §"TWO TIERS OF PROOF"). What is asserted here is
// the observable contract: which surfaces render, and which controls on them are
// offered versus refused.
// The server-side refusals — `requireOrgSession({ capability: "delete" })`,
// `requireSystemManager("change the camp categories")`, and the queries that never SELECT
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
    // The rank is told plainly why the column is missing — and the copy is the
    // ONE refusal from @quagga/core rather than a sentence this page wrote, so
    // an engineer and a department lead each get the reason that is true of
    // them instead of both being told they are engineers.
    await expect(
      engineer.org.getByText(
        /engineer accounts reach every department, and deliberately never see personal information/i,
      ),
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

    // Categories: readable, with the reason stated, and every control present
    // but refused. DISABLED, not absent — Ryan, 28 Jul 2026: "I'd rather things
    // be transparent with restrictions than completely obfuscated, except for
    // private personal information."
    //
    // The `/^delete /` locator that used to stand here could never match: the
    // real control is named `Delete Fire Art`, and Playwright's accessible-name
    // match is case-sensitive. It passed on every rank, System manager included.
    await engineer.org.goto("/categories");
    await expect(
      engineer.org.getByText(
        /only a system manager can change the camp categories/i,
      ),
    ).toBeVisible();
    const addCategory = engineer.org.getByRole("button", {
      name: /^add category — not available to you$/i,
    });
    await expect(addCategory).toBeVisible();
    await expect(addCategory).toBeDisabled();
    const deleteCategory = engineer.org
      .getByRole("button", { name: /^delete .+ — not available to you$/i })
      .first();
    await expect(deleteCategory).toBeVisible();
    await expect(deleteCategory).toBeDisabled();
    // …and no control carries the unrestricted name, on any row.
    await expect(
      engineer.org.getByRole("button", { name: /^delete [^—]+$/i }),
    ).toHaveCount(0);

    // Suppliers: the one genuinely DESTRUCTIVE control this rank can reach —
    // and until 28 Jul 2026 nothing tested it, so "deletes nothing" was a spec
    // title rather than a claim. The page never passed `deleteRefusal`, which
    // `suppliers-table.tsx` reads as "not asked", so every rank got a live bin
    // icon whose only feedback was a toast after pressing it.
    await engineer.org.goto("/suppliers");
    const remove = engineer.org
      .getByRole("button", { name: /^remove .+ — not available to you$/i })
      .first();
    await expect(remove).toBeVisible();
    await expect(remove).toBeDisabled();
    // No row offers the unrestricted control.
    await expect(
      engineer.org.getByRole("button", { name: /^remove [^—]+$/i }),
    ).toHaveCount(0);
    // …and the reason under the table is the RANK's, not a missing role — the
    // same sentence @quagga/core would refuse the server call with.
    await expect(
      engineer.org.getByText(
        /deliberately cannot delete anything in any of them/i,
      ),
    ).toBeVisible();

    // Accounts: no access management at all (that is the System manager rank).
    await engineer.org.goto("/accounts?q=");
    await expect(
      engineer.org.getByRole("button", { name: /give org staff access/i }),
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
    // …and the refusal names the REAL reason: it is the rank, not a missing
    // role. Sending an engineer off to ask for a role edit that cannot work
    // would waste two people's afternoon.
    await expect(
      engineer.org.getByText(
        /engineer accounts reach every department, and deliberately never see personal information/i,
      ),
    ).toBeVisible();
    await expect(
      engineer.org.getByText(/no role edit changes that/i),
    ).toBeVisible();
  });
});
