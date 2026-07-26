// Officer roles are NOT aliasable (M3-26; questionnaire-spec §"Officers cannot be
// aliased"; auth-platform-spec §9.2 invariant 8). Org-facing officer vocabulary
// stays uniform across every camp, so a camp cannot rename, recolour, or delete
// an officer role — unlike its own custom roles.
//
// HONEST SCOPE NOTE: the SERVER guards (renameRole / setRoleAppearance /
// removeRole rejecting kind==='officer', via canRenameRoleKind /
// canDeleteRoleKind) are proven by @quagga/core + roles-store unit tests. They
// are deliberately UNREACHABLE from the UI — the officer row exposes NO rename,
// recolour, or delete control to POST — so there is no client path for an E2E to
// invoke and be refused. What an E2E CAN prove, and does here, is that the camp
// is given no aliasing affordance for officers while it IS given one for custom
// roles (so the absence is by design, not a missing feature), and that officer
// rows render the FIXED catalog names. The pure server-refusal lives in the unit
// suite by construction; this spec guards the surface that would expose it.

import { test, expect } from "../../fixtures";
import { signUpBurner, createCamp } from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import { OFFICER_NAMES, expandRow } from "./support";

test.describe("officer roles cannot be aliased by the camp", () => {
  test("officer rows are fixed & control-less, while custom roles rename/delete", async ({
    webPage,
  }) => {
    test.slow();

    await signUpBurner(webPage, { onboard: true });
    const { slug } = await createCamp(webPage);
    await webPage.goto(`/camps/${slug}/settings/roles`);
    await expect(webPage).not.toHaveURL(/\/auth\/sign-in|\/onboarding/);

    // Officer rows render the FIXED org catalog names (not a camp alias). The
    // badge text is "<emoji><name>", so we match the name as a substring.
    await expect(
      webPage.getByText(OFFICER_NAMES.lnt).first(),
    ).toBeVisible();
    await expect(
      webPage.getByText(OFFICER_NAMES.fireBaron).first(),
    ).toBeVisible();
    // Each officer row carries the "set by AfrikaBurn — can't be renamed" lock.
    await expect(
      webPage.getByLabel(/officers can['’]t be renamed/i).first(),
    ).toBeVisible();

    // Expand an officer row: it offers NO rename field and NO delete control.
    // (Radix unmounts closed panels, so with only this row open these are the
    // only role editors in the DOM — a count of zero is a real absence.)
    await expandRow(webPage, new RegExp(OFFICER_NAMES.lnt));
    await expect(
      webPage.getByRole("textbox", { name: "Name" }),
    ).toHaveCount(0);
    await expect(
      webPage.getByRole("button", { name: /delete role/i }),
    ).toHaveCount(0);

    // Contrast: a CUSTOM role the camp creates DOES expose rename + delete — so
    // the absence above is deliberate officer immutability, not a global lack.
    const customName = uniqueName("Bar crew");
    await webPage.getByRole("button", { name: /^new role$/i }).click();
    await webPage.getByLabel("Name").fill(customName);
    await webPage.getByRole("button", { name: /^create role$/i }).click();

    await expandRow(webPage, new RegExp(escapeRe(customName)));
    await expect(
      webPage.getByRole("textbox", { name: "Name" }).first(),
    ).toBeVisible();
    await expect(
      webPage.getByRole("button", { name: /delete role/i }).first(),
    ).toBeVisible();
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
