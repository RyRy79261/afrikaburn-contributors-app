// specs/org-staff/form-2.spec.ts
//
// FORM 2 END TO END (roadmap M4-20).
//
// AfrikaBurn runs two registration forms months apart. Form 1 opens in September
// and asks intent; Form 2 opens in January and asks the things nobody knows in
// September — size, placement, sound, and the mandatory layout diagram.
//
// This walks the whole chain, because every link in it is invisible to the unit
// tests:
//
//   1. a camp submits Form 1 WITHOUT the Form-2 sections and is accepted —
//      the submit-gate change, and the reason for the whole feature
//   2. the org approves it, then sends Form 2
//   3. the camp's lead is asked, and answers
//   4. the answers land on the REGISTRATION ROW, not just in a response blob
//
// Step 4 is the one that matters most and the one a passing questionnaire test
// would not notice. `getOfficerStatus` derives a camp's required officers from
// the sound answer; if the mirror breaks, a camp with a full rig owes no sound
// officer and nothing on any screen says why.
//
// Needs a real org session, so it skips cleanly without E2E_GOD_EMAIL.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { signUpBurner, createCamp, submitRegistration } from "../../personas/factories";
import { decide, openRegistrationInConsole } from "../camp-lead/support";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

test.describe("org staff · Form 2", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("a camp registers without the January answers, then gives them on Form 2", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(300_000);

    // --- FORM 1: submitted WITHOUT size or sound -------------------------
    //
    // `submitRegistration` fills what Form 1 asks. Before M4-20 the gate wanted
    // all six sections and this submit would have been refused — which is the
    // defect the split fixed: a September applicant cannot answer January's
    // questions, so the gate would have held the whole season at "4 of 6".
    const campLead = await makeAppPage("web");
    await signUpBurner(campLead, { onboard: true });
    const camp = await createCamp(campLead, { description: "Chai at dawn." });
    await submitRegistration(campLead, camp.slug);

    const staff = await provisionOrgStaff(makeAppPage);
    await openRegistrationInConsole(staff.org, camp.name);
    await decide(staff.org, "Approve");
    await expect(staff.org.getByText(/approve applied/i)).toBeVisible();

    // --- SEND FORM 2 ------------------------------------------------------
    await staff.org.goto("/questionnaires");
    const panel = staff.org.getByRole("heading", { name: /^form 2/i });
    await expect(panel).toBeVisible();

    // Before sending, the camp is listed and explicitly NOT sent — an approved
    // camp that has not been asked must never read as "waiting on them".
    const row = staff.org.locator("li").filter({ hasText: camp.name }).first();
    await expect(row.getByText(/not sent/i)).toBeVisible();

    await staff.org.getByRole("button", { name: /send to \d+ camp/i }).click();
    await expect(staff.org.getByText(/form 2 sent/i)).toBeVisible();

    // …and now it is waiting on the camp rather than on the org.
    await expect(
      staff.org.locator("li").filter({ hasText: camp.name }).first().getByText(/waiting/i),
    ).toBeVisible();

    // IDEMPOTENT. Sending again must not double-ask; the control says so
    // rather than silently doing nothing.
    await expect(
      staff.org.getByRole("button", { name: /all camps have it/i }),
    ).toBeDisabled();

    // --- THE CAMP ANSWERS -------------------------------------------------
    // On the camp's own dashboard, where a lead would look for it. Form 2 is
    // NOT blocking, so it offers "Answer" rather than taking the app over —
    // it opens in January and is due much later.
    await campLead.goto(`/camps/${camp.slug}`);
    const item = campLead
      .locator("li")
      .filter({ hasText: /theme camp form 2/i })
      .first();
    await expect(item).toBeVisible();
    await item.getByRole("link", { name: /^answer$/i }).click();

    await campLead.getByLabel(/how many people/i).fill("45");
    await campLead.getByLabel(/first person arrive/i).fill("2027-04-22");
    await campLead.getByLabel(/how much space/i).fill("20m x 15m");
    // The layout diagram is a file question, which renders the shared FileUpload
    // — a group, not an input. Locally there is no Blob token, so it offers the
    // URL-paste fallback, which is the path a deployment without storage uses
    // too. Paste, then Add: the value is not committed until Add is pressed.
    const layout = campLead.getByRole("group", { name: /layout diagram/i });
    await layout.getByLabel(/paste a url/i).fill("https://blob.example/layout.png");
    await layout.getByRole("button", { name: /^add$/i }).click();
    // Sound and placement are page TWO — Form 2 is authored as two pages, which
    // is also how a camp experiences it: size first, then the noise conversation.
    await campLead.getByRole("button", { name: /^next$/i }).click();
    await expect(
      campLead.getByRole("heading", { name: /sound & placement/i }),
    ).toBeVisible();

    // A single-select renders as a real radiogroup, and the option labels come
    // straight from @quagga/core's SOUND_SCALE — the same scale
    // `soundLevelFromValue` matches against to decide whether this camp owes a
    // sound officer. That is the link the mirror exists to preserve.
    await campLead
      .getByRole("radiogroup", { name: /what sound will you be running/i })
      .getByRole("radio", { name: /level 1/i })
      .check();
    await campLead
      .getByRole("button", { name: /^(submit|send|finish|done)/i })
      .first()
      .click();

    // --- THE ANSWERS REACH THE REGISTRATION ROW ---------------------------
    //
    // Read back through the ORG's registration detail, which renders the typed
    // columns — not through the questionnaire results, which would only prove
    // the response was stored. This is the assertion the mirror exists for.
    await openRegistrationInConsole(staff.org, camp.name);
    // "45 campers" rather than a bare "45" — the number alone appears elsewhere
    // on a console page and strict mode rightly refuses an ambiguous match.
    await expect(staff.org.getByText(/45 campers/i)).toBeVisible();
    await expect(staff.org.getByText(/20m x 15m/i)).toBeVisible();
    // The sound answer, which is the one the officer requirements derive from.
    await expect(staff.org.getByText(/level 1 — car stereo/i).first()).toBeVisible();

    // …and the chase list now says answered, with nothing unfilled — an
    // "unfilled" badge here would mean the questionnaire and the mirror have
    // drifted apart.
    await staff.org.goto("/questionnaires");
    const answered = staff.org.locator("li").filter({ hasText: camp.name }).first();
    await expect(answered.getByText(/answered/i)).toBeVisible();
    await expect(answered.getByText(/unfilled/i)).toHaveCount(0);
  });
});
