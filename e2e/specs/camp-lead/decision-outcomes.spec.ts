// specs/camp-lead/decision-outcomes.spec.ts
//
// Persona: CAMP LEAD — the two decision outcomes nothing walked end to end.
//
// The review loop (review-loop.spec.ts) covers request_changes → edit →
// resubmit, and the org side of approve/reject is covered from the console
// (org-staff/registration-review.spec.ts). What neither walks is what the CAMP
// ends up looking at:
//
//   1. REJECTED, AND WHY. A rejection REQUIRES a reason ("A rejection needs a
//      reason for the camp." — applyReviewDecision), and until migration 0025
//      that reason was written to `audit_events.meta` and the decision
//      notification only. The camp's own registration page said "Not approved —
//      see the reviewer's notes below" and pointed at the per-section feedback
//      thread, which a reviewer who simply rejected never wrote to. Every org-
//      side spec passed; the camp's screen carried no explanation. That is the
//      shape of bug an org-only spec cannot see, so this one reads the camp's
//      page and demands the reviewer's sentence, verbatim.
//
//   2. WITHDRAWN AFTER APPROVAL, AND BACK. `approved → withdrawn → draft` are
//      all legal transitions and both controls exist (WithdrawRegistrationButton
//      survives into the locked view; ReopenRegistrationButton is the way back),
//      and `withdrawn` had ZERO e2e coverage — the one status a camp can reach
//      by itself, from the state the whole product exists to grant.
//
// Both need a real org session, so both skip cleanly without E2E_GOD_EMAIL.

import { test, expect, skipUnlessGod } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  submitRegistration,
  elevateToGod,
} from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import { decide, openRegistrationInConsole } from "./support";

test.describe("camp lead — what a decision leaves the camp looking at", () => {
  test("a rejection reaches the camp WITH the reviewer's reason", async ({
    webPage,
    orgPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(180_000);

    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Chai at dawn." });
    await submitRegistration(webPage, camp.slug);

    // A sentence unique to this worker, so finding it on the camp's page cannot
    // be a coincidence or another spec's leftovers.
    const reason = uniqueName(
      "Your fire plan names no extinguisher count (reject-reason-probe)",
    );

    await elevateToGod(orgPage);
    await openRegistrationInConsole(orgPage, camp.name);
    // NO section comment first — deliberately. The whole defect was that the
    // reason lived nowhere the camp could read WHEN the reviewer left the
    // per-section thread empty, which is the common case for a rejection.
    await decide(orgPage, "Reject", reason);
    await expect(orgPage.getByText(/reject applied/i)).toBeVisible();

    // The camp opens its own registration.
    await webPage.goto(`/camps/${camp.slug}/registration`);
    await expect(webPage.getByText(/not approved/i).first()).toBeVisible();
    // …and the reviewer's words are ON THE PAGE, not only in an audit row.
    await expect(webPage.getByText(reason)).toBeVisible();

    // Rejected is AfrikaBurn's decision and stays terminal: no reopen, and no
    // route back into the editable wizard.
    await expect(
      webPage.getByRole("button", { name: /reopen registration/i }),
    ).toHaveCount(0);
    await expect(
      webPage.getByRole("button", { name: /^submit registration$/i }),
    ).toHaveCount(0);
  });

  test("an approved camp withdraws, and reopening returns a draft — not the approval", async ({
    webPage,
    orgPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(180_000);

    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Shade and water." });
    await submitRegistration(webPage, camp.slug);

    await elevateToGod(orgPage);
    await openRegistrationInConsole(orgPage, camp.name);
    // KEEP THE URL. The withdrawal below has to be checked from the console
    // again, and walking the queue a second time adds nothing this test is
    // about while adding a hop that can land on the wrong row.
    const detailUrl = orgPage.url();
    await decide(orgPage, "Approve");
    await expect(orgPage.getByText(/approve applied/i)).toBeVisible();

    await webPage.goto(`/camps/${camp.slug}/registration`);
    await expect(
      webPage.getByText(/approved — you['’]re registered/i),
    ).toBeVisible();

    // WITHDRAW FROM APPROVED. This control only exists on the locked view — the
    // wizard an approved camp never sees — so nothing but a spec on this exact
    // state can prove it is reachable.
    //
    // The confirm is a NATIVE `window.confirm`, not a Radix dialog, so it is
    // handled by a page-level listener rather than a locator. Playwright
    // auto-DISMISSES native dialogs when nothing is listening, which would have
    // made this test pass by never withdrawing anything — so the handler also
    // captures the message and it is asserted below.
    let confirmText = "";
    webPage.once("dialog", async (d) => {
      confirmText = d.message();
      await d.accept();
    });
    await webPage
      .getByRole("button", { name: /withdraw registration/i })
      .click();
    await expect(webPage.getByText(/registration withdrawn/i)).toBeVisible();
    // The confirm named what was being given up, in the words the component
    // composes for THIS status (`withdrawConsequence("approved", …)`) — an
    // approved camp must not get the generic warning.
    expect(confirmText).toContain("confirmed place");
    expect(confirmText).toContain("Reopening does not");

    await expect(webPage.getByText(/^withdrawn$/i).first()).toBeVisible();
    await expect(
      webPage.getByText(/you withdrew this registration/i),
    ).toBeVisible();

    // The org sees it too — a withdrawal the console does not know about would
    // leave a reviewer working a registration the camp has abandoned.
    await orgPage.goto(detailUrl);
    await expect(
      orgPage.getByText(/no reviewer actions are available/i),
    ).toBeVisible();

    // REOPENING returns a DRAFT, not the approval. This is the claim the
    // withdraw dialog makes ("Reopening does not give the approval back"), and
    // a reopen that silently restored `approved` would hand back a placement
    // nobody re-reviewed.
    await webPage.goto(`/camps/${camp.slug}/registration`);
    await webPage.getByRole("button", { name: /reopen registration/i }).click();
    // Back in the editable wizard, with the answers intact and a submit to do.
    await expect(
      webPage.getByRole("button", { name: /^submit registration$/i }),
    ).toBeVisible();
    await expect(
      webPage.getByText(/approved — you['’]re registered/i),
    ).toHaveCount(0);
  });
});
