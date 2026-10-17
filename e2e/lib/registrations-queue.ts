import { expect, type Page } from "@playwright/test";

/**
 * Open one page of the org registrations queue and WAIT FOR IT TO RENDER.
 *
 * `page.goto` resolving is not the queue being on screen. `/registrations` has a
 * `loading.tsx`, and under load the browser reaches `load` while the body is
 * still that skeleton ("Loading…", no rows). Measured 16 Oct 2026: page 1's
 * body read "… Audit Safety Loading…" at the moment the walk counted the
 * camp's link, the count was 0, and the same link was in the DOM a few
 * milliseconds later. The walk then moved to page 2 — and because the page
 * clamps `?page=` to the last page, pages 2…25 all showed the OLDER rows, so a
 * camp sitting on page 1 could never be found again. That is the
 * "never appeared in the registrations queue within 25 pages" flake: one
 * early count, not ordering, pagination depth or a missing row.
 *
 * So this waits for something the RENDERED page always shows and the skeleton
 * never does — the pagination summary, an empty state, or one of the screens
 * the console puts in place of the queue — before the caller looks for a row.
 */
export async function gotoRegistrationsQueuePage(
  page: Page,
  n: number,
): Promise<void> {
  await page.goto(`/registrations?page=${n}`);
  const rendered = page
    .getByText(/^Showing \d+–\d+ of \d+$/)
    .or(page.getByText(/no registrations|no active edition is seeded/i))
    // The screens that replace the queue, so the caller can name them.
    .or(page.getByText(/restricted to afrikaburn staff/i))
    .or(page.getByText(/this side is for afrikaburn staff/i))
    .or(page.getByText(/you have console access/i))
    .or(page.getByText(/this page didn.t load/i));
  await expect(
    rendered.first(),
    `the registrations queue (page ${n}) never finished rendering`,
  ).toBeVisible();
}
