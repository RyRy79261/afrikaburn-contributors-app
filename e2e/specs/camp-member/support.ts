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
  const viewLink = leadPage.getByRole("link", { name: /view responses/i }).first();
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
  await expect(page.getByRole("heading", { name: /edit your bio/i })).toBeVisible();

  await page
    .getByLabel("On-site contact name")
    .fill(sentinels.onsiteContactName);
  await page.getByLabel("Medical notes").fill(sentinels.medicalNotes);

  // details → burns → privacy, then the final save.
  await page.getByRole("button", { name: "Save & continue" }).click();
  await page.getByRole("button", { name: "Save & continue" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await page.waitForURL(/\/profile(\?.*)?$/);
  return sentinels;
}

/**
 * Navigate to `url` and assert the server answered with an HTTP 404 (a real
 * `notFound()`, not a soft in-page message). The HTTP status is the load-bearing
 * server-side proof — a full document navigation to a page that calls
 * `notFound()` returns a genuine 404 in Next's App Router.
 *
 * The copy check is a human-readable backup. It is now SAFE (it was previously
 * flagged as fragile against Next's default 404 copy): every app ships a custom
 * not-found boundary that renders "We couldn't find that" —
 *   apps/web/components/boundary/not-found-view.tsx (web root + camps/[slug]),
 *   apps/org/app/not-found.tsx ("We couldn't find that")
 * — verified 2026-07-26. All the routes this helper is pointed at (settings/roles,
 * questionnaires list + builder) call `notFound()` DIRECTLY (no redirect hop), so
 * the status is a clean 404 on first navigation, not a 200+RSC redirect.
 *
 * Returns the final URL so callers can additionally assert where it landed.
 */
export async function expectServerNotFound(
  page: Page,
  url: string,
): Promise<{ finalUrl: string }> {
  const res = await page.goto(url);
  expect(
    res?.status(),
    `expected 404 from ${url}, got ${res?.status()} at ${page.url()}`,
  ).toBe(404);
  await expect(page.getByText(/we couldn['’]t find/i)).toBeVisible();
  return { finalUrl: page.url() };
}
