// specs/camp-lead/review-loop.spec.ts
//
// Persona: CAMP LEAD — the changes-requested loop, end to end across two apps.
// Org requests changes with per-section feedback → the lead SEES that feedback
// on the flagged section → edits it → resubmits → the org sees it back in the
// queue as submitted. The org counterpart is a real god session (elevateToGod),
// never mocked; the whole spec skips cleanly without E2E_GOD_EMAIL.
//
// KNOWN GAP (honest): the camp-side "reply on the thread" affordance is NOT yet
// built. The write path exists server-side (replyToSectionReviewAction in
// apps/web/.../registration/actions.ts, gated by @quagga/core
// canReplyToSectionReview) but its own source comment says "The reply UI itself
// is built by a later agent" — the wizard and summary render org feedback
// READ-ONLY. So the lead-reply step is a `test.fixme` below, not a silently
// dropped assertion; it will light up unchanged once the reply UI ships.

import type { Page } from "@playwright/test";
import { test, expect, skipUnlessGod } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  submitRegistration,
  elevateToGod,
} from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import {
  addSectionComment,
  decide,
  openRegistrationInConsole,
} from "./support";

/** Go to a wizard section by its label (rail + strip; see wizard.tsx). */
async function goToSection(page: Page, label: RegExp) {
  await page.getByRole("button", { name: label }).first().click();
}

test.describe("camp lead — org review loop", () => {
  test("org requests changes on a section; the lead sees it, edits, and resubmits", async ({
    webPage,
    orgPage,
  }) => {
    skipUnlessGod();

    // A camp with a submitted registration.
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Chai at dawn." });
    await submitRegistration(webPage, camp.slug);

    // Org opens it and requests changes with a section-specific comment on LNT.
    const feedback = uniqueName(
      "Please add your grey-water evaporation plan (review-loop-probe)",
    );
    await elevateToGod(orgPage);
    await openRegistrationInConsole(orgPage, camp.name);
    await addSectionComment(orgPage, "lnt", feedback);
    await decide(
      orgPage,
      "Request changes",
      "The Leave No Trace section needs more detail before this can be approved.",
    );
    // Org side reflects the new state.
    await expect(
      orgPage.getByText(/changes requested/i).first(),
    ).toBeVisible();

    // Lead side: the registration reopens as an editable wizard, banners the
    // request, and shows the org's feedback on the flagged section.
    await webPage.goto(`/camps/${camp.slug}/registration`);
    await expect(
      webPage.getByText(/afrikaburn asked for changes/i),
    ).toBeVisible();
    await goToSection(webPage, /leave no trace/i);
    await expect(webPage.getByText(/org feedback/i)).toBeVisible();
    await expect(webPage.getByText(feedback)).toBeVisible();

    // The lead edits the flagged section and resubmits.
    await webPage
      .getByLabel(/leave no trace plan/i)
      .fill(
        "MOOP sweeps twice daily; grey water evaporated in lined trays off-playa; " +
          "all waste packed out. (updated after AB feedback)",
      );
    await webPage
      .getByRole("button", { name: /resubmit registration/i })
      .click();

    // Resubmitting moves the state back to submitted → the locked summary shows.
    await expect(
      webPage.getByText(/submitted — awaiting review|under review/i),
    ).toBeVisible();

    // Org sees it back in the pipeline as submitted (no longer changes-requested).
    await orgPage.reload();
    await expect(orgPage.getByText(/changes requested/i)).toHaveCount(0);
    await expect(orgPage.getByText(/^submitted$/i).first()).toBeVisible();
  });

  // The camp-side reply UI is not yet built (see file header). This is the
  // assertion it exists to hold, parked as fixme rather than dropped: once a
  // "Reply" affordance renders on the wizard's Org-feedback panel, remove
  // `.fixme` and drive it — the server action (replyToSectionReviewAction) and
  // its authz predicate (canReplyToSectionReview) are already in place.
  test.fixme(
    "the lead can reply on a section review thread (UI pending)",
    async ({ webPage, orgPage }) => {
      skipUnlessGod();
      await signUpBurner(webPage, { onboard: true });
      const camp = await createCamp(webPage, { description: "Chai at dawn." });
      await submitRegistration(webPage, camp.slug);

      await elevateToGod(orgPage);
      await openRegistrationInConsole(orgPage, camp.name);
      await addSectionComment(orgPage, "lnt", "Tell us more about grey water.");
      await decide(orgPage, "Request changes", "Needs LNT detail.");

      // TODO(reply-ui): once the wizard renders a reply box under Org feedback,
      // the lead posts a reply and it appears in the thread. No such control
      // exists today — the wizard shows org feedback read-only.
      await webPage.goto(`/camps/${camp.slug}/registration`);
      await goToSection(webPage, /leave no trace/i);
      const reply = webPage.getByRole("textbox", { name: /reply/i });
      await reply.fill("Added — grey water is evaporated in lined trays.");
      await webPage.getByRole("button", { name: /post reply|reply/i }).click();
      await expect(
        webPage.getByText(/grey water is evaporated in lined trays/i),
      ).toBeVisible();
    },
  );
});
