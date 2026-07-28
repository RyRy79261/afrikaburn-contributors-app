// e2e/specs/supplier/support.ts — SUPPLIER-persona counterpart helpers.
//
// The shared persona factories (personas/factories.ts) own everything a supplier
// does to ITSELF (registerSupplier, signInAs, signOut) and the god bootstrap
// (elevateToGod). This module adds the small set of ORG-side actions a supplier
// journey needs a counterpart for — a supplier's standing is org-set, notes are
// org-authored, documents are org-published, and the claim-by-email row must be
// created accountless by the org before a supplier can claim it. These are NOT a
// re-implementation of the factories; they are the "the org does X to this
// supplier" moves the isolation/standing/document specs depend on.
//
// Every function drives the REAL org console UI (no DB back doors) and assumes
// `orgPage` already holds a god session (call `elevateToGod(orgPage)` first).
// They are gated behind `skipUnlessGod()` at the spec level, so on a deployment
// without god credentials the whole file is simply never exercised.
//
// Selector provenance (verified against source on 2026-07-26):
//   /suppliers table ..... apps/org/components/suppliers-table.tsx
//                          + @quagga/ui responsive-data-table.tsx (tr @ md+, li below)
//   Add supplier ......... apps/org/components/add-supplier-form.tsx
//   Standing select ...... apps/org/components/supplier-standing-select.tsx
//   Notes drawer ......... apps/org/components/supplier-notes-drawer.tsx
//   Documents form ....... apps/org/app/(console)/suppliers/signup-management/page.tsx
//                          + apps/org/components/supplier-documents/document-form.tsx

import { expect, type Page } from "@playwright/test";

/**
 * The one VISIBLE row/card for a supplier, by its (unique-per-worker) business
 * name. The responsive table keeps the desktop `<tr>` in the DOM even at 360px
 * (it is `display:none`, not removed) while ALSO rendering the mobile `<li>`, so
 * an un-scoped match would be strict-mode-ambiguous on the mobile project. The
 * `visible: true` filter collapses it to the layout actually on screen, so the
 * same helper works on both Playwright projects.
 */
export function orgSupplierRow(orgPage: Page, name: string) {
  return orgPage
    .locator("tr, li")
    .filter({ hasText: name })
    .filter({ visible: true })
    .first();
}

/**
 * Hand-add an ACCOUNTLESS supplier row (userId null) through the org console's
 * "Add supplier" dialog. Used to seed the claim-by-email target: a row whose
 * free-text `contact` carries an address a real supplier can later verify and
 * claim. Standing defaults to `good` (set it separately to prove attach-not-
 * duplicate). Asserts the row lands in the repository table.
 */
export async function orgAddSupplier(
  orgPage: Page,
  opts: { name: string; contact?: string; services?: string },
): Promise<void> {
  await orgPage.goto("/suppliers");
  await orgPage.getByRole("button", { name: /add supplier/i }).first().click();
  const dialog = orgPage.getByRole("dialog");
  await dialog.getByLabel(/^name/i).fill(opts.name);
  if (opts.services) await dialog.getByLabel(/^services/i).fill(opts.services);
  if (opts.contact) await dialog.getByLabel(/^contact/i).fill(opts.contact);
  // The footer button shares its label with the trigger; scope to the dialog.
  await dialog.getByRole("button", { name: /^add supplier$/i }).click();
  await expect(orgPage.getByText(/supplier added/i)).toBeVisible();
  await expect(orgPage.getByText(opts.name).first()).toBeVisible();
}

/**
 * Set a supplier's standing from the repository table's inline select. `label`
 * is the human standing label exactly as the org renders it (@quagga/core
 * `standingLabel`): "Good standing" | "Watch" | "Suspended" | "Diligent First
 * Timer" | "Able & Willing To Adapt" | "Absolute Beginners". Waits for the
 * server round-trip's success toast so a caller can safely reload the portal.
 */
export async function orgSetStanding(
  orgPage: Page,
  supplierName: string,
  label: string,
): Promise<void> {
  await orgPage.goto("/suppliers");
  const row = orgSupplierRow(orgPage, supplierName);
  await row.getByRole("combobox").first().click();
  await orgPage.getByRole("option", { name: label, exact: true }).click();
  await expect(orgPage.getByText(/standing set to/i)).toBeVisible();
}

/**
 * Record an org-internal note against a supplier (default kind "note"). The kind
 * is immaterial to the isolation law under test — what matters is the BODY must
 * never reach the supplier. Returns the body so the spec can assert its absence
 * across every portal surface.
 */
export async function orgAddNote(
  orgPage: Page,
  supplierName: string,
  body: string,
): Promise<string> {
  await orgPage.goto("/suppliers");
  const row = orgSupplierRow(orgPage, supplierName);
  await row.getByRole("button", { name: /notes/i }).click();
  const dialog = orgPage.getByRole("dialog");
  await dialog.getByRole("textbox").fill(body);
  await dialog.getByRole("button", { name: /^add note$/i }).click();
  await expect(orgPage.getByText(/recorded/i)).toBeVisible();
  return body;
}

/**
 * Publish a per-edition supplier document, optionally BOUND to a self-service
 * onboarding step (its acknowledgement then completes that step). Binding to a
 * step auto-forces requiredAck on, mirroring the form's own rule. Returns the
 * title so the portal spec can find the "I've read <title>" acknowledgement.
 *
 * NOTE: documents are edition-global (shared by every supplier of the edition),
 * not per-supplier — see the spec header for why that is acceptable on the
 * throwaway E2E branch.
 */
export async function orgCreateDocument(
  orgPage: Page,
  opts: { title: string; url: string; bindStepLabel?: string },
): Promise<string> {
  await orgPage.goto("/suppliers/signup-management");
  await orgPage.locator("#doc-title").fill(opts.title);
  // THE FORM DEFAULTS TO "Hosted file" (document-form.tsx: sourceType "file"),
  // and `#doc-url` only exists in the "External link" branch — so filling it
  // without switching first waits 20s for an input that is not on the page and
  // fails every supplier spec at the first shared helper. Radix ToggleGroup
  // with type="single" renders its items as role="radio", not button.
  await orgPage.getByRole("radio", { name: /external link/i }).click();
  await orgPage.locator("#doc-url").fill(opts.url);
  if (opts.bindStepLabel) {
    await orgPage
      .getByRole("combobox", { name: /bind to onboarding step/i })
      .click();
    await orgPage
      .getByRole("option", { name: opts.bindStepLabel, exact: true })
      .click();
  }
  await orgPage.getByRole("button", { name: /^add document$/i }).click();
  await expect(orgPage.getByText(/document published/i)).toBeVisible();
  return opts.title;
}
