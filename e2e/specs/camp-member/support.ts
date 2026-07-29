// specs/camp-member/support.ts — camp-member-specific flows that the shared
// persona factories (e2e/personas/factories.ts) don't cover. These DRIVE THE
// REAL UI exactly like the factories do; they are not DB back doors. Kept local
// to this persona's suite so they can't collide with another owner's edits to
// the shared factory file, and because they encode camp-questionnaire choreography
// that only these specs need (a camp lead authoring a send + a member filling it).
//
// Selector provenance (verified against source on 2026-07-26):
//   builder ........ apps/web/components/questionnaire/builder.tsx
//                    apps/web/app/camps/[slug]/questionnaires/new/page.tsx
//   fill/runner .... apps/web/components/questionnaire/{fill,runner,field}.tsx
//                    apps/web/app/questionnaires/[activationId]/page.tsx
//   bio editor ..... apps/web/components/onboarding/bio-flow.tsx (mode="edit")
//                    apps/web/app/profile/page.tsx

import { expect, type Page } from "@playwright/test";

/** Pull the activation uuid out of any `/questionnaires/<uuid>` style URL/href. */
function activationIdFrom(value: string | null): string | null {
  return value?.match(/questionnaires\/([0-9a-f-]{36})/i)?.[1] ?? null;
}

/** `EDIT_STEPS` in apps/web/components/onboarding/bio-flow.tsx: details, burns,
 *  privacy. Named here so a step added there fails this loop loudly rather than
 *  silently skipping the privacy page. */
const EDIT_STEP_COUNT = 3;

export interface AuthorQuestionnaireOptions {
  title: string;
  /** The single required short-text question's prompt (used later as its label). */
  prompt: string;
  /** true → the app-blocking hard gate; false → an optional pending questionnaire. */
  blocking?: boolean;
}

/**
 * As a camp lead/admin, build + send a one-question project questionnaire to
 * EVERYONE in the camp (the default audience, which includes every member).
 * Returns the created activation's id.
 *
 * For an "everyone" send the LEAD is also in the audience, so a BLOCKING send
 * gates the lead too — after "Create & send" the lead lands on their own gate at
 * `/questionnaires/<id>`, which is where we read the id from. A non-blocking send
 * leaves the lead on the questionnaires list, where the "View responses" link
 * carries the id.
 */
export async function authorCampQuestionnaire(
  leadPage: Page,
  slug: string,
  opts: AuthorQuestionnaireOptions,
): Promise<{ activationId: string }> {
  await leadPage.goto(`/camps/${slug}/questionnaires/new`);
  // The builder only renders for a lead/admin; a member is 404'd before here.
  await expect(
    leadPage.getByRole("heading", { name: /new questionnaire/i }),
  ).toBeVisible();

  await leadPage.getByLabel("Title", { exact: true }).fill(opts.title);
  // Question 1 defaults to a required short-text question; only its prompt is
  // needed for completeness (builder.tsx `validate`).
  await leadPage.getByPlaceholder("Question prompt").first().fill(opts.prompt);

  if (opts.blocking) {
    await leadPage
      .getByRole("button", { name: /required \(blocks the app\)/i })
      .click();
  }
  // Audience stays on the default "Everyone in this camp".

  await leadPage.getByRole("button", { name: /create & send/i }).click();

  if (opts.blocking) {
    // The lead is in the "everyone" audience too, so a blocking send gates the
    // lead: router.push('/camps/[slug]/questionnaires') → that page's
    // enforceGate redirects to the lead's own fill page at
    // `/questionnaires/<uuid>`. Wait for THAT (not merely "left /new", which can
    // capture the intermediate list URL before the redirect resolves).
    await leadPage.waitForURL(/\/questionnaires\/[0-9a-f-]{36}$/i);
    const id = activationIdFrom(leadPage.url());
    if (!id) {
      throw new Error(
        `[camp-member] Could not read the blocking activation id from ${leadPage.url()}`,
      );
    }
    return { activationId: id };
  }

  // A non-blocking send does not gate the lead: router.push lands on the list.
  await leadPage.waitForURL(new RegExp(`/camps/${slug}/questionnaires$`));
  const viewLink = leadPage
    .getByRole("link", { name: /view responses/i })
    .first();
  await expect(viewLink).toBeVisible();
  const id = activationIdFrom(await viewLink.getAttribute("href"));
  if (!id) {
    throw new Error(
      "[camp-member] Could not read the activation id from the View-responses link.",
    );
  }
  return { activationId: id };
}

/**
 * Answer the single required short-text question on a fill page and submit. The
 * question's prompt is its accessible label (field.tsx). `submitLabel` is
 * "Submit" for the non-blocking page and "Submit answers" for the blocking gate.
 */
export async function answerRequiredQuestion(
  page: Page,
  opts: { prompt: string; answer: string; submitLabel?: string },
): Promise<void> {
  await page.getByLabel(opts.prompt).fill(opts.answer);
  await page
    .getByRole("button", { name: opts.submitLabel ?? "Submit", exact: true })
    .click();
}

/**
 * Put real HARD-LOCKED private data on the current user's bio via the profile
 * editor (BioFlow mode="edit": details → burns → privacy). Returns the sentinels
 * written, so a viewer test can assert their ABSENCE from every public surface.
 * We set only the plainly-fillable locked fields (emergency-contact name +
 * medical notes) — enough to prove the projection strips locked fields; the phone
 * field is a composite input we deliberately don't depend on here.
 */
export async function setHardLockedBioData(
  page: Page,
  sentinels: { onsiteContactName: string; medicalNotes: string },
): Promise<{ onsiteContactName: string; medicalNotes: string }> {
  await page.goto("/profile?edit=1");
  await expect(
    page.getByRole("heading", { name: /edit your bio/i }),
  ).toBeVisible();

  // BY ROLE, not by label. Every hard-locked field ships a privacy Switch beside
  // it whose accessible name STARTS WITH the field's own — "Medical notes —
  // always private" — so `getByLabel("Medical notes")` matches the switch and
  // the textarea both, and strict mode refuses. Naming the role picks the input.
  await page
    .getByRole("textbox", { name: "On-site contact name" })
    .fill(sentinels.onsiteContactName);
  await page
    .getByRole("textbox", { name: "Medical notes" })
    .fill(sentinels.medicalNotes);

  // details → burns → privacy, then the final save.
  //
  // WAIT FOR THE STEP TO CHANGE between clicks. Firing the same
  // "Save & continue" locator twice in a row raced the persist: the button
  // disables while the server action is in flight, so Playwright's second click
  // waited for it to re-enable and could land on the SAME step again — after
  // which "Save changes" never appears, because the flow is one step short of
  // the privacy page. `bio-flow.tsx` renders "Step N of 3", so the step counter
  // is the honest signal that the click actually advanced.
  const total = EDIT_STEP_COUNT;
  for (let step = 1; step < total; step += 1) {
    await expect(page.getByText(`Step ${step} of ${total}`)).toBeVisible();
    await page.getByRole("button", { name: "Save & continue" }).click();
    await expect(page.getByText(`Step ${step + 1} of ${total}`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Save changes" }).click();

  await page.waitForURL(/\/profile(\?.*)?$/);
  return sentinels;
}

/**
 * Navigate to `url` and assert the server REFUSED it: the not-found view is what
 * renders, and none of the camp's own content is on the page.
 *
 * ## Why this no longer asserts HTTP 404, and what was measured
 *
 * It used to, on the reasoning quoted here until 28 Jul: "a full document
 * navigation to a page that calls `notFound()` returns a genuine 404 in Next's
 * App Router... verified 2026-07-26". That is not what this app does. Measured
 * against a production build of apps/web on Next 16.2.11:
 *
 *     GET /zzz-nope                          -> 404   (no such route)
 *     GET /camps/<no-such-camp>              -> 200   (page called notFound())
 *     GET /camps/<other-camp>/settings/roles -> 200   (permission gate)
 *
 * The body in every 200 case is the not-found view — literally "404 / WE
 * COULDN'T FIND THAT CAMP" — and no camp data appears. So the refusal is real;
 * only the status line disagrees with it.
 *
 * THREE FIXES WERE TRIED AND MEASURED. None moved the status:
 *   1. Removing every `loading.tsx` in the app — root, the `(app)` group, and
 *      all three camp segments. No change.
 *   2. Removing the segment's own `not-found.tsx`. No change.
 *   3. Hoisting the existence check into a `camps/[slug]/layout.tsx`, so it
 *      resolves before the page. No change: still 200.
 *
 * The cause is above all three. `(app)/layout.tsx` declares
 * `dynamic = "force-dynamic"` for the whole group, so the response is committed
 * before any descendant — layout or page — decides anything, while an unmatched
 * route is answered before there is a response at all. The two remaining routes
 * are dropping `force-dynamic` (which that layout's comment explains would let a
 * signed-out shell be prerendered and then served to everyone — a real bug, in
 * exchange for a status line) or DB-aware middleware on every camp URL. Both
 * cost more than they buy.
 *
 * So this asserts the property that actually protects a member of another camp:
 * the refusal renders, and forbidden content does not. If the status ever
 * matters enough to pay for, the note above is what has already been ruled out.
 *
 * Pass `absent` (the camp name, a member's name, anything the viewer must not
 * see) and it is asserted missing from the page.
 *
 * Returns the final URL so callers can additionally assert where it landed.
 */
export async function expectServerNotFound(
  page: Page,
  url: string,
  absent: string[] = [],
): Promise<{ finalUrl: string }> {
  await page.goto(url);
  await expect(page.getByText(/we couldn['’]t find/i)).toBeVisible();
  for (const secret of absent) {
    await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
  }
  return { finalUrl: page.url() };
}
