// specs/camp-lead/camp-money.spec.ts
//
// Persona: CAMP LEAD (+ one member, + a stranger) — camp budget, dues and
// claims (docs/camp-budget-spec.md). RECORDS ONLY: nothing on these pages
// moves money, and this spec checks no "pay" control exists on either view.
//
// One journey, because each step only means something against the state the
// one before it left:
//
//   1. The camp page's Money tile is the way in. The lead's budget opens as a
//      draft with the starter categories written once; they approve it.
//   2. Dues: the lead sets the camp fee and writes how to pay the camp. The
//      member's row reads Awaiting; the lead records R 1 000,00 that arrived
//      and the row reads Part paid.
//   3. The member's view (M4): the totals, THEIR dues (part paid, R 1 500,00
//      outstanding), the camp's instructions and their own ref code — and no
//      tabs, no members list, even when they ask for ?tab=dues.
//   4. The member claims R 385,00 back. On this stack there is no blob token,
//      so the receipt box says uploads aren't set up (and nothing breaks).
//   5. The lead sees it waiting (the tab badge), approves it, marks it repaid.
//      Their OWN claim, filed next, cannot be approved by them.
//   6. The member sees the claim repaid, and the money notices.
//   7. A stranger gets the camp's not-found for the money page.
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

import { test, expect } from "../../fixtures";
import type { Page } from "@playwright/test";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueUsername } from "../../lib/identity";
import { expectServerNotFound } from "../camp-member/support";

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

async function expectNoPayControl(page: Page) {
  await expect(
    page.getByRole("button", { name: /^pay\b|pay now|checkout/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /^pay\b|pay now|checkout/i }),
  ).toHaveCount(0);
}

test.describe("camp lead — money", () => {
  test("budget, dues and a claim, recorded and never paid through the app", async ({
    makeAppPage,
  }) => {
    test.setTimeout(300_000);

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
    await leadPage.getByRole("button", { name: "Approve budget" }).click();
    await expect(status).toContainText("Approved");
    await expectNoPayControl(leadPage);

    // ── 2. Dues ───────────────────────────────────────────────────────────
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

    // ── 3. The member's view ──────────────────────────────────────────────
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
    await expect(memberPage.getByTestId("money-books")).toBeVisible();
    // Present first, then absent: the members' view has no tabs and no list.
    await expect(memberPage.getByRole("link", { name: "Dues" })).toHaveCount(0);
    await expect(memberPage.getByTestId("money-dues-members")).toHaveCount(0);
    await expectNoPayControl(memberPage);

    // ── 4. The member claims money back ──────────────────────────────────
    await memberPage.getByRole("button", { name: "New claim" }).click();
    const claimDialog = memberPage.getByRole("dialog", {
      name: "Claim money back",
    });
    await expect(claimDialog).toContainText(
      "Receipt uploads aren't set up on this deployment yet.",
    );
    await claimDialog.getByRole("combobox", { name: "Category" }).click();
    await memberPage.getByRole("option", { name: "Kitchen & food" }).click();
    await claimDialog.getByLabel("Amount").fill("385");
    await claimDialog
      .getByLabel("What was it for?")
      .fill("Ice for the cooler boxes");
    await claimDialog.getByRole("button", { name: "Submit claim" }).click();
    await expect(claimDialog).toHaveCount(0);
    const ownClaim = memberPage
      .getByTestId("own-claim")
      .filter({ hasText: "Ice for the cooler boxes" });
    await expect(ownClaim).toContainText("Submitted");

    // ── 5. The lead decides it ───────────────────────────────────────────
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
    await card.getByRole("button", { name: "Mark repaid" }).click();
    const repaid = leadPage.getByRole("dialog", { name: /claim repaid$/ });
    await expect(repaid).toContainText("nothing is sent from here");
    await repaid.getByRole("button", { name: "Mark repaid" }).click();
    await expect(repaid).toHaveCount(0);
    await expect(card).toContainText("Repaid");

    // The lead's own claim: they cannot approve it themselves.
    await leadPage.getByRole("button", { name: "New claim" }).click();
    const leadClaim = leadPage.getByRole("dialog", {
      name: "Claim money back",
    });
    await leadClaim.getByLabel("Amount").fill("120");
    await leadClaim.getByLabel("What was it for?").fill("Fairy lights");
    await leadClaim.getByRole("button", { name: "Submit claim" }).click();
    await expect(leadClaim).toHaveCount(0);
    const mine = leadPage
      .getByTestId("claim-card")
      .filter({ hasText: "Fairy lights" });
    await expect(mine).toContainText("(you)");
    await expect(mine).toContainText("You can't approve your own claim.");
    await expect(
      mine.getByRole("button", { name: "Approve", exact: true }),
    ).toBeDisabled();

    // ── 6. The member sees it repaid, and the notices ───────────────────
    await gotoMoney(memberPage, camp.slug);
    await expect(ownClaim).toContainText("Repaid");
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

    // ── 7. A stranger gets the camp's not-found ─────────────────────────
    await signUpBurner(strangerPage, { onboard: true });
    await expectServerNotFound(strangerPage, `/camps/${camp.slug}/money`, [
      "Ice for the cooler boxes",
    ]);
  });
});
