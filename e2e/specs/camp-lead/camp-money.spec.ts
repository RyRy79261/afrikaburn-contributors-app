// specs/camp-lead/camp-money.spec.ts
//
// Persona: CAMP LEAD (+ members, + a stranger) — camp budget, dues and claims
// (docs/camp-budget-spec.md). RECORDS ONLY: nothing on these pages moves
// money, and this spec checks no "pay" control exists on either view.
//
// Test 1 is one journey, because each step only means something against the
// state the one before it left:
//
//   1. The camp page's Money tile is the way in. The lead's budget opens as a
//      draft with the starter categories written ONCE (a second open writes
//      nothing more); they plan R 8 000,00 for Kitchen & food, add a R 640,00
//      expense, and approve the plan.
//   2. The member's view (M4) before any money comes in: the totals the lead
//      planned and spent, R 0,00 received, and no pay control.
//   3. Dues: the lead sets the camp fee and writes how to pay the camp. The
//      member's row reads Awaiting; the lead records R 1 000,00 that arrived
//      and the row reads Part paid.
//   4. The member's view again: THEIR dues (part paid, R 1 500,00
//      outstanding), the instructions, their ref code, and the books moved
//      (R 1 000,00 received). No tabs and no members list, whichever ?tab=
//      they ask for.
//   5. The member claims R 385,00 back. On this stack there is no blob token,
//      so the receipt box says uploads aren't set up (and nothing breaks).
//   6. The lead sees it waiting (the tab badge), approves it — spent moves to
//      R 1 025,00 and R 385,00 is owed — then marks it repaid. Their OWN
//      claim, filed next, cannot be approved by them.
//   7. The member sees the claim repaid, the books moved, and the notices.
//   8. A stranger gets the camp's not-found for the money page.
//
// Test 2: `manage_money` is a grantable privilege, not a lead-only one. A
// member holding a custom role with "Can manage money" gets the three tabs;
// before the grant the same person got the members' view (so the assertion
// moves with the privilege). Their own claim is still not theirs to approve,
// and a plain member sees none of it.
//
// Selector provenance (verified against source on 2026-10-14):
//   tile ............ apps/web/components/money/money-tile.tsx
//   tabs ............ apps/web/components/money/money-nav.tsx
//   budget .......... apps/web/components/money/{budget-tab,budget-forms}.tsx
//   dues ............ apps/web/components/money/{dues-tab,dues-forms}.tsx
//                     (desktop rows data-testid="dues-row", 360 "dues-card")
//   claims .......... apps/web/components/money/{claims-tab,claim-forms}.tsx
//                     (data-testid="claim-card")
//   member view ..... apps/web/components/money/member-view.tsx
//   figures ......... apps/web/components/money/money-ui.tsx (Figure: a <p>
//                     label then a <p> value inside one box)
//   privilege ....... apps/web/components/roles/privileges.tsx
//                     ("Can manage money" switch)

import { test, expect } from "../../fixtures";
import type { Locator, Page } from "@playwright/test";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueUsername } from "../../lib/identity";
import { expectServerNotFound } from "../camp-member/support";
import { assignRoleToMember, createCustomRole } from "./support";

/**
 * `MONEY_STARTER_CATEGORIES.length` in @quagga/core (11 spending + 6 income).
 * Named here so a change to the starter list fails loudly rather than letting
 * a doubled list (34) pass.
 */
const STARTER_CATEGORY_COUNT = 17;

/** The money tabs (money-nav.tsx TABS) — the money-person-only surfaces. */
const MONEY_TABS = ["budget", "dues", "claims"] as const;

async function gotoMoney(page: Page, slug: string, tab?: string) {
  await page.goto(`/camps/${slug}/money${tab ? `?tab=${tab}` : ""}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Money", exact: true }),
  ).toBeVisible();
}

/** The member's dues row, whichever layout (table ≥ md, cards below) shows. */
function duesRow(page: Page, name: string) {
  return page
    .locator(
      '[data-testid="dues-row"]:visible, [data-testid="dues-card"]:visible',
    )
    .filter({ hasText: name });
}

/** One figure box (label + value) inside a totals section. */
function figure(section: Locator, label: string): Locator {
  return section.getByText(label, { exact: true }).locator("xpath=..");
}

async function expectNoPayControl(page: Page) {
  await expect(
    page.getByRole("button", { name: /^pay\b|pay now|checkout/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /^pay\b|pay now|checkout/i }),
  ).toHaveCount(0);
}

/**
 * The members' view, asserted PRESENT before anything is asserted absent: the
 * caller's own dues card renders, and there is no tab bar and no members list.
 */
async function expectMembersView(page: Page) {
  await expect(page.getByTestId("money-your-dues")).toBeVisible();
  await expect(page.getByTestId("money-books")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Money" })).toHaveCount(0);
  await expect(page.getByTestId("money-dues-members")).toHaveCount(0);
  await expect(page.getByTestId("money-plan-vs-actual")).toHaveCount(0);
  await expect(page.getByTestId("claim-card")).toHaveCount(0);
}

async function submitClaim(
  page: Page,
  claim: { amount: string; description: string; category?: string },
) {
  await page.getByRole("button", { name: "New claim" }).click();
  const dialog = page.getByRole("dialog", { name: "Claim money back" });
  await expect(dialog).toContainText(
    "Receipt uploads aren't set up on this deployment yet.",
  );
  if (claim.category) {
    await dialog.getByRole("combobox", { name: "Category" }).click();
    await page.getByRole("option", { name: claim.category }).click();
  }
  await dialog.getByLabel("Amount").fill(claim.amount);
  await dialog.getByLabel("What was it for?").fill(claim.description);
  await dialog.getByRole("button", { name: "Submit claim" }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe("camp lead — money", () => {
  test("budget, dues and a claim, recorded and never paid through the app", async ({
    makeAppPage,
  }) => {
    test.setTimeout(360_000);

    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const strangerPage = await makeAppPage("web");
    const memberName = uniqueUsername("money_jabu");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, invite.url);

    // ── 1. The way in, and the budget ────────────────────────────────────
    await leadPage.goto(`/camps/${camp.slug}`);
    const tile = leadPage.getByTestId("money-tile");
    await expect(tile).toContainText("You owe nothing yet.");
    await expect(tile).not.toContainText("waived");
    await tile.getByRole("link", { name: /open money/i }).click();
    await expect(
      leadPage.getByRole("heading", { level: 1, name: "Money", exact: true }),
    ).toBeVisible();
    const status = leadPage.getByTestId("money-budget-status");
    await expect(status).toContainText("Draft");
    // The starter list was written for this camp (nothing planned yet).
    await expect(leadPage.getByTestId("money-plan-vs-actual")).toContainText(
      "Kitchen & food",
    );

    // Open it a second time: the starter list is written ONCE, so the plan
    // editor lists each starter category exactly once.
    await gotoMoney(leadPage, camp.slug);
    await leadPage.getByRole("button", { name: "Edit the plan" }).click();
    const plan = leadPage.getByRole("dialog", { name: "Edit the plan" });
    await expect(
      plan.getByRole("textbox", { name: "Name of Kitchen & food" }),
    ).toHaveCount(1);
    await expect(plan.getByRole("textbox", { name: /^Name of / })).toHaveCount(
      STARTER_CATEGORY_COUNT,
    );
    await plan
      .getByRole("textbox", { name: "Planned for Kitchen & food" })
      .fill("8000");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(plan).toHaveCount(0);
    const totals = leadPage.getByTestId("money-totals");
    await expect(figure(totals, "Projected spend")).toContainText("R 8 000,00");

    // An expense entry moves actual spend.
    await expect(figure(totals, "Actual spend")).toContainText("R 0,00");
    await leadPage.getByRole("button", { name: "Add entry" }).click();
    const entry = leadPage.getByRole("dialog", { name: "Add an entry" });
    await entry.getByRole("combobox", { name: "Category" }).click();
    await leadPage.getByRole("option", { name: "Kitchen & food" }).click();
    await entry.getByLabel("Amount").fill("640");
    await entry.getByLabel("Description").fill("Ice and fresh veg, Ceres");
    await entry.getByRole("button", { name: "Save entry" }).click();
    await expect(entry).toHaveCount(0);
    await expect(leadPage.getByTestId("money-entries")).toContainText(
      "Ice and fresh veg, Ceres",
    );
    await expect(figure(totals, "Actual spend")).toContainText("R 640,00");

    await leadPage.getByRole("button", { name: "Approve budget" }).click();
    await expect(status).toContainText("Approved");
    await expectNoPayControl(leadPage);

    // ── 2. The member's view before any money comes in ───────────────────
    await gotoMoney(memberPage, camp.slug);
    const books = memberPage.getByTestId("money-books");
    await expect(figure(books, "Planned spend")).toContainText("R 8 000,00");
    await expect(figure(books, "Spent so far")).toContainText("R 640,00");
    await expect(figure(books, "Income received")).toContainText("R 0,00");
    // The lead's entry description is theirs: only totals reach a member.
    await expect(memberPage.getByText("Ice and fresh veg")).toHaveCount(0);

    // ── 3. Dues ───────────────────────────────────────────────────────────
    await gotoMoney(leadPage, camp.slug);
    await leadPage.getByRole("link", { name: "Dues" }).click();
    await expect(leadPage.getByTestId("money-camp-fee")).toBeVisible();
    // Regression: before a fee is set nobody reads "Waived" — they have no
    // fee yet.
    const row = duesRow(leadPage, memberName);
    await expect(row).toContainText("No fee set");
    await leadPage.getByRole("button", { name: "Change the camp fee" }).click();
    const feeDialog = leadPage.getByRole("dialog", {
      name: "Change the camp fee",
    });
    await feeDialog.getByLabel("Camp fee per member").fill("2500");
    await feeDialog.getByRole("button", { name: "Save the fee" }).click();
    await expect(feeDialog).toHaveCount(0);
    await expect(leadPage.getByTestId("money-camp-fee")).toContainText(
      "R 2 500,00",
    );

    await leadPage.getByRole("button", { name: "Write instructions" }).click();
    const howTo = leadPage.getByRole("dialog", { name: "How to pay the camp" });
    await howTo
      .getByLabel("Instructions")
      .fill("EFT to the camp account 1234 567 890, branch 250655");
    await howTo.getByRole("button", { name: "Save instructions" }).click();
    await expect(howTo).toHaveCount(0);

    await expect(row).toContainText("Awaiting");
    await row
      .getByRole("button", { name: `Record money in from ${memberName}` })
      .click();
    const recordDialog = leadPage.getByRole("dialog", {
      name: `Record money in from ${memberName}`,
    });
    await expect(recordDialog).toContainText(
      "Nothing is collected or moved here.",
    );
    await recordDialog.getByLabel("Amount").fill("1000");
    await recordDialog.getByRole("button", { name: "Record it" }).click();
    await expect(recordDialog).toHaveCount(0);
    await expect(row).toContainText("Part paid");
    await expect(row).toContainText("R 1 500,00");
    await expectNoPayControl(leadPage);

    // ── 4. The member's view ──────────────────────────────────────────────
    await gotoMoney(memberPage, camp.slug, "dues");
    const yourDues = memberPage.getByTestId("money-your-dues");
    await expect(yourDues).toContainText("Part paid");
    await expect(memberPage.getByTestId("money-own-outstanding")).toContainText(
      "R 1 500,00",
    );
    await expect(
      memberPage.getByTestId("money-instructions-text"),
    ).toContainText("1234 567 890");
    await expect(memberPage.getByTestId("money-ref-code")).toBeVisible();
    // The totals moved with the money the lead recorded.
    await expect(figure(books, "Income received")).toContainText("R 1 000,00");
    // Whatever tab they ask for, a plain member gets the members' view.
    for (const tab of MONEY_TABS) {
      await gotoMoney(memberPage, camp.slug, tab);
      await expectMembersView(memberPage);
    }
    await expectNoPayControl(memberPage);

    // ── 5. The member claims money back ──────────────────────────────────
    await submitClaim(memberPage, {
      category: "Kitchen & food",
      amount: "385",
      description: "Ice for the cooler boxes",
    });
    const ownClaim = memberPage
      .getByTestId("own-claim")
      .filter({ hasText: "Ice for the cooler boxes" });
    await expect(ownClaim).toContainText("Submitted");

    // ── 6. The lead decides it ───────────────────────────────────────────
    await gotoMoney(leadPage, camp.slug, "claims");
    await expect(
      leadPage.getByRole("navigation", { name: "Money" }),
    ).toContainText("Claims1");
    const card = leadPage
      .getByTestId("claim-card")
      .filter({ hasText: "Ice for the cooler boxes" });
    await expect(card).toContainText(memberName);
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(card).toContainText("Approved");

    // An approved claim counts as spent, and as owed until it is repaid.
    await gotoMoney(leadPage, camp.slug, "budget");
    await expect(figure(totals, "Actual spend")).toContainText("R 1 025,00");
    await expect(figure(totals, "Claims owed")).toContainText("R 385,00");

    await gotoMoney(leadPage, camp.slug, "claims");
    await card.getByRole("button", { name: "Mark repaid" }).click();
    const repaid = leadPage.getByRole("dialog", { name: /claim repaid$/ });
    await expect(repaid).toContainText("nothing is sent from here");
    await repaid.getByRole("button", { name: "Mark repaid" }).click();
    await expect(repaid).toHaveCount(0);
    await expect(card).toContainText("Repaid");

    // The lead's own claim: they cannot approve it themselves.
    await submitClaim(leadPage, {
      amount: "120",
      description: "Fairy lights",
    });
    const mine = leadPage
      .getByTestId("claim-card")
      .filter({ hasText: "Fairy lights" });
    await expect(mine).toContainText("(you)");
    await expect(mine).toContainText("You can't approve your own claim.");
    await expect(
      mine.getByRole("button", { name: "Approve", exact: true }),
    ).toBeDisabled();

    await gotoMoney(leadPage, camp.slug, "budget");
    await expect(figure(totals, "Claims owed")).toContainText("R 0,00");

    // ── 7. The member sees it repaid, the books, and the notices ────────
    await gotoMoney(memberPage, camp.slug);
    await expect(ownClaim).toContainText("Repaid");
    await expect(figure(books, "Spent so far")).toContainText("R 1 025,00");
    // The lead's claim is not the member's business.
    await expect(memberPage.getByText("Fairy lights")).toHaveCount(0);
    await memberPage.goto("/notifications");
    await expect(
      memberPage.getByRole("heading", { name: /^notifications$/i }),
    ).toBeVisible();
    await expect(
      memberPage.getByText("The camp recorded R 1 000,00 received from you", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      memberPage.getByText("Your claim for R 385,00 was marked repaid", {
        exact: false,
      }),
    ).toBeVisible();

    // The camp page tile now says what the member owes.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(memberPage.getByTestId("money-tile-own")).toContainText(
      "You owe R 1 500,00",
    );

    // ── 8. A stranger gets the camp's not-found ─────────────────────────
    await signUpBurner(strangerPage, { onboard: true });
    await expectServerNotFound(strangerPage, `/camps/${camp.slug}/money`, [
      "Ice for the cooler boxes",
    ]);
    await expectServerNotFound(
      strangerPage,
      `/camps/${camp.slug}/money?tab=dues`,
      [memberName],
    );
  });

  test("a custom role with manage money opens the money tabs", async ({
    makeAppPage,
  }) => {
    test.setTimeout(300_000);

    const leadPage = await makeAppPage("web");
    const keeperPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const keeperName = uniqueUsername("money_ren");
    const memberName = uniqueUsername("money_alice");
    const roleName = `Bookkeeper ${Date.now().toString(36)}`;

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const keeperInvite = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(keeperPage, { onboard: true, username: keeperName });
    await joinByInvite(keeperPage, keeperInvite.url);
    const memberInvite = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, memberInvite.url);

    // Before the grant: the would-be bookkeeper is a plain member.
    await gotoMoney(keeperPage, camp.slug, "dues");
    await expectMembersView(keeperPage);

    await createCustomRole(leadPage, camp.slug, {
      name: roleName,
      emoji: "🧮",
      colorLabel: "Teal",
      privileges: ["Can manage money"],
    });
    await assignRoleToMember(leadPage, camp.slug, keeperName, roleName);

    // After it: the three tabs, and every member's dues row.
    await gotoMoney(keeperPage, camp.slug, "dues");
    const nav = keeperPage.getByRole("navigation", { name: "Money" });
    for (const label of ["Budget", "Dues", "Claims"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(duesRow(keeperPage, memberName)).toBeVisible();
    await expectNoPayControl(keeperPage);

    // ...but not their OWN dues: a custom-role money person can neither set
    // nor record them (a lead does). Assert the member's action first, so
    // the absence below is checked against a rendered table.
    await expect(
      duesRow(keeperPage, memberName).getByRole("button", {
        name: `Record money in from ${memberName}`,
      }),
    ).toBeVisible();
    const ownRow = duesRow(keeperPage, keeperName);
    await expect(ownRow).toContainText("A lead records your own dues.");
    await expect(
      ownRow.getByRole("button", {
        name: `Record money in from ${keeperName}`,
      }),
    ).toHaveCount(0);

    // A money person's own claim is still not theirs to approve.
    await gotoMoney(keeperPage, camp.slug, "claims");
    await submitClaim(keeperPage, {
      category: "Transport",
      amount: "450",
      description: "Diesel for the bakkie",
    });
    const keeperClaim = keeperPage
      .getByTestId("claim-card")
      .filter({ hasText: "Diesel for the bakkie" });
    await expect(keeperClaim).toContainText("(you)");
    await expect(
      keeperClaim.getByRole("button", { name: "Approve", exact: true }),
    ).toBeDisabled();

    // The lead may decide it: the Approve there is live.
    await gotoMoney(leadPage, camp.slug, "claims");
    const leadView = leadPage
      .getByTestId("claim-card")
      .filter({ hasText: "Diesel for the bakkie" });
    await expect(leadView).toContainText(keeperName);
    await expect(
      leadView.getByRole("button", { name: "Approve", exact: true }),
    ).toBeEnabled();

    // A plain member sees none of it, whichever tab they ask for.
    for (const tab of MONEY_TABS) {
      await gotoMoney(memberPage, camp.slug, tab);
      await expectMembersView(memberPage);
      await expect(memberPage.getByText("Diesel for the bakkie")).toHaveCount(
        0,
      );
      await expect(memberPage.getByText(keeperName)).toHaveCount(0);
    }
  });
});
