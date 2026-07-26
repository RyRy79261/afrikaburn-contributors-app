import type { Locator, Page } from "@playwright/test";

/**
 * Real, app-rendered alerts — excluding Next.js's route announcer.
 *
 * Next injects `<div role="alert" aria-live="assertive"
 * id="__next-route-announcer__">` into every page for screen-reader route
 * changes. It is empty and invisible, but `getByRole("alert")` matches it, so a
 * bare alert query can NEVER resolve to a single element and
 * `toHaveCount(0)` can NEVER pass — in any Next app. Nine assertions across the
 * suite were written against that impossible contract.
 *
 * Use this anywhere a spec means "the error the app showed me".
 */
export function appAlerts(scope: Page | Locator): Locator {
  return scope.locator('[role="alert"]:not(#__next-route-announcer__)');
}
