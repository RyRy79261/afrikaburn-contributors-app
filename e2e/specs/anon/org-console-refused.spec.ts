// specs/anon/org-console-refused.spec.ts — the organiser console refuses an
// anonymous visitor at the SERVER (registry: reach-org-console + review-
// registration). resolveOrgSession returns a non-"ok" state for an
// unauthenticated request, so the console layout renders the full-screen
// GateScreen INSTEAD of the console — the queue, the registration detail, and
// their approve / request-changes controls are never emitted. This is the
// refusal a hidden-nav approach would miss: the data-bearing chrome is absent,
// not merely unlinked.
//
// Guards verified in source (2026-07-26): apps/org/app/(console)/layout.tsx +
// lib/gate.tsx (guardConsole) + components/gate-screen.tsx.

import { test, expect } from "../../fixtures";

test.describe("anonymous visitor — organiser console refuses", () => {
  test("the registration queue is replaced by the staff gate [reach-org-console]", async ({
    orgPage,
  }) => {
    await orgPage.goto("/registrations");

    // The gate copy + a Sign-in CTA IS the refusal.
    await expect(
      orgPage.getByText(/restricted to afrikaburn staff/i),
    ).toBeVisible();
    await expect(
      orgPage.getByRole("link", { name: /^sign in$/i }),
    ).toBeVisible();

    // The console's own chrome/data never rendered.
    await expect(
      orgPage.getByRole("heading", { name: /registration queue/i }),
    ).toHaveCount(0);
  });

  test("a registration detail (review surface) is refused, with no decision controls [review-registration]", async ({
    orgPage,
  }) => {
    // A syntactically plausible id; the gate fires BEFORE any lookup, so the id
    // existing or not is irrelevant — an anon never reaches the query.
    const someId = "00000000-0000-4000-8000-000000000000";
    await orgPage.goto(`/registrations/${someId}`);

    await expect(
      orgPage.getByText(/restricted to afrikaburn staff/i),
    ).toBeVisible();

    // The decision rail (the actual review powers) is absent — the anon cannot
    // approve or request changes, and the controls are not merely disabled.
    await expect(
      orgPage.getByRole("button", { name: /^approve$/i }),
    ).toHaveCount(0);
    await expect(
      orgPage.getByRole("button", { name: /request changes/i }),
    ).toHaveCount(0);
  });
});
