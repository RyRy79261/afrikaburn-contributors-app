// tests/negative-paths.spec.ts — adversarial authz, driven by the ONE registry
// (personas/registry.ts). Each assertion proves the server-side guard REFUSES,
// never that a link is hidden (AGENTS.md rule 7). Per the mandatory adversarial
// pass (roadmap M3-30), each of these must be re-proven by DELETING the matching
// server guard and watching the spec go red — a negative-path test that still
// passes with the guard gone is the exact failure it exists to prevent.
//
// The two org-console refusals below are implemented concretely (they need no
// data setup). The data-heavy guards (free-camp discovery, cross-camp read,
// supplier notes, hard-locked PII on public surfaces) are the M3-30 owner's to
// complete; they are declared here as `fixme`, each citing its registry
// capability id + refusalHint so the wiring is unambiguous — honestly marked
// not-yet-implemented rather than silently absent or falsely green.

import { test, expect } from "../fixtures";
import { signUpBurner, signInAs } from "../personas/factories";
import { PERSONAS } from "../personas/registry";

test.describe("authz negative paths", () => {
  test("anonymous is refused the org console [reach-org-console]", async ({
    orgPage,
  }) => {
    // A protected console route, unauthenticated → the full gate replaces the
    // console. "Restricted to AfrikaBurn staff" + a Sign-in CTA IS the refusal.
    await orgPage.goto("/registrations");
    await expect(
      orgPage.getByText(/restricted to afrikaburn staff/i),
    ).toBeVisible();
    await expect(
      orgPage.getByRole("link", { name: /^sign in$/i }),
    ).toBeVisible();
    // And the console chrome/data is absent (not merely hidden behind a link).
    await expect(
      orgPage.getByRole("heading", { name: /registration/i }),
    ).toHaveCount(0);
  });

  test("a non-org burner is refused the org console [reach-org-console]", async ({
    webPage,
    orgPage,
  }) => {
    const account = await signUpBurner(webPage, { onboard: true });
    await signInAs(orgPage, account, "org");
    await orgPage.goto("/registrations");
    // Signed in, but no org role → the polite wall. This proves the guard rejects
    // an AUTHENTICATED principal, the case a hidden-nav approach would miss.
    await expect(
      orgPage.getByText(/this side is for afrikaburn staff/i),
    ).toBeVisible();
    await expect(
      orgPage.getByRole("heading", { name: /registration queue/i }),
    ).toHaveCount(0);
  });

  // --- Data-dependent guards — owned by the M3-30 wide pass -----------------
  // Each references its registry capability so the assertion target is fixed.

  test.fixme("a stranger cannot discover a free camp [discover-free-camp / open-free-camp-page]", async () => {
    // Setup: burner A creates an invite_only (free) camp; burner B (a stranger)
    // must NOT find it in /directory, the type-ahead, or B's profile search, and
    // opening /camps/<slug> directly must notFound()/redirect.
    // Guard: apps/web/lib/groups-store.ts free-camp filter + camp page
    //        `!camp.registered && !camp.viewerRole` branch.
    expect(
      PERSONAS.anonymous.forbidden.some((c) => c.id === "discover-free-camp"),
    ).toBe(true);
  });

  test.fixme("a camp member cannot read another camp's registration [read-other-camp-registration]", async () => {
    // Setup: two camps, two leads; lead B navigates to A's registration route.
    // Guard: getCurrentCampUser/enforceGate scoping in the registration page.
    expect(
      PERSONAS.camp_member.forbidden.some(
        (c) => c.id === "read-other-camp-registration",
      ),
    ).toBe(true);
  });

  test.fixme("a supplier cannot see org-internal notes [see-org-supplier-notes]", async () => {
    // Setup: registerSupplier + walk onboarding; assert no org `notes` string is
    // ever present in any portal response.
    // Guard: supplier session/onboarding query never SELECTs `notes` (M3-07).
    expect(
      PERSONAS.supplier.forbidden.some(
        (c) => c.id === "see-org-supplier-notes",
      ),
    ).toBe(true);
  });

  test.fixme("hard-locked fields never appear on a public surface [see-hard-locked-field-public]", async () => {
    // Setup: complete a bio with phone/emergency/ID filled and every toggle set
    // PUBLIC; assert none of HARD_LOCKED_PRIVATE_FIELDS' values appear on the
    // public profile, directory card, or type-ahead. Guard: bio public projection.
    expect(
      PERSONAS.burner.forbidden.some(
        (c) => c.id === "see-hard-locked-field-public",
      ),
    ).toBe(true);
  });

  test.fixme("org_staff cannot reach god-only surfaces [reach-god-only-surface]", async () => {
    // Setup: an org_staff account (god elevates them via the accounts panel) opens
    // a god-only surface. Guard: requireOrgSession({ god: true }) throws for staff.
    expect(
      PERSONAS.org_staff.forbidden.some(
        (c) => c.id === "reach-god-only-surface",
      ),
    ).toBe(true);
  });
});
