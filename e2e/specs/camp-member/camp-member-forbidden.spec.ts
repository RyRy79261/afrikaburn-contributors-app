// specs/camp-member/camp-member-forbidden.spec.ts
//
// Persona: CAMP MEMBER — the NEGATIVE space. For each thing a member CANNOT do,
// the assertion is that the SERVER refuses (a redirect away from the workspace,
// an HTTP 404, or the org staff wall), never merely that a button is hidden
// (AGENTS.md rule 7; roadmap M3-30). Each test names the server guard it pins, so
// the adversarial pass can delete that guard and watch exactly this test go red.
//
// Scope here is the member's OWN camp (intra-camp default-deny). Cross-camp /
// free-camp isolation lives in camp-member-cross-camp-isolation.spec.ts.

import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
  signInAs,
} from "../../personas/factories";
import type { AppName } from "../../lib/env";
import { expectServerNotFound } from "./support";

/**
 * Build a camp with a lead and a joined member. Returns the member's page + the
 * member's account (so a spec can sign the same identity into another app) and
 * the camp slug.
 */
async function memberOfFreshCamp(makeAppPage: (app: AppName) => Promise<Page>) {
  const leadPage = await makeAppPage("web");
  const memberPage = await makeAppPage("web");
  await signUpBurner(leadPage, { onboard: true });
  const camp = await createCamp(leadPage);
  const invite = await inviteToCamp(leadPage, camp.slug, "member");
  const member = await signUpBurner(memberPage, { onboard: true });
  await joinByInvite(memberPage, invite.url);
  return { memberPage, member, slug: camp.slug };
}

test.describe("camp member — server-side refusals (own camp)", () => {
  test("cannot open the registration workspace — the server redirects a member to the dashboard [PROJECT_ADMIN_ROLES gate in registration/page.tsx]", async ({
    makeAppPage,
  }) => {
    const { memberPage, slug } = await memberOfFreshCamp(makeAppPage);

    await memberPage.goto(`/camps/${slug}/registration`);

    // Guard: registration/page.tsx `if (!context.role || !PROJECT_ADMIN_ROLES
    // .includes(context.role)) redirect('/camps/[slug]')`. The member lands back
    // on the dashboard (200), and the wizard is never served.
    await expect(memberPage).toHaveURL(new RegExp(`/camps/${slug}$`));
    await expect(
      memberPage.getByRole("heading", { name: /registration/i }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByText(/theme camp registration/i),
    ).toHaveCount(0);
    // ...and therefore the submit/resubmit control is unreachable.
    await expect(
      memberPage.getByRole("button", { name: /submit registration/i }),
    ).toHaveCount(0);
  });

  test("cannot reach the Roles & Officers settings — 404 [manage_roles/assign_roles gate in settings/roles/page.tsx]", async ({
    makeAppPage,
  }) => {
    const { memberPage, slug } = await memberOfFreshCamp(makeAppPage);
    // Guard: `if (!canManageRoles && !canAssignRoles) notFound()`. A plain member
    // holds only baseline permissions, so this is a hard 404 — settings are not
    // rendered and the role-mutation actions are never reachable through the UI.
    await expectServerNotFound(memberPage, `/camps/${slug}/settings/roles`);
  });

  test("cannot manage camp questionnaires — 404 on the list and the builder [manage_questionnaires / PROJECT_ADMIN gate]", async ({
    makeAppPage,
  }) => {
    const { memberPage, slug } = await memberOfFreshCamp(makeAppPage);
    // Guard (list): questionnaires/page.tsx `if (!canManage) notFound()`.
    await expectServerNotFound(memberPage, `/camps/${slug}/questionnaires`);
    // Guard (builder): questionnaires/new/page.tsx `if (!isAdmin) notFound()`.
    await expectServerNotFound(memberPage, `/camps/${slug}/questionnaires/new`);
  });

  test("cannot obtain an invite — the RSC withholds invite tokens from a member [isAdmin gate in camps/[slug]/page.tsx]", async ({
    makeAppPage,
  }) => {
    const { memberPage, slug } = await memberOfFreshCamp(makeAppPage);
    await memberPage.goto(`/camps/${slug}`);
    await expect(
      memberPage.getByRole("heading", { name: /members/i }),
    ).toBeVisible();

    // There is no member-facing invite route; the ONLY invite surface is the
    // dashboard's admin-gated Invite-links card, and `invites = isAdmin ? … : []`
    // means the member's server-rendered payload contains no `/join/` token at
    // all. Asserting the token's ABSENCE from the delivered HTML is a server-side
    // check (the data was never sent), not a hidden-button check.
    await expect(
      memberPage.locator("code", { hasText: "/join/" }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: /new member invite/i }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: /lead-transfer/i }),
    ).toHaveCount(0);
    // NOTE (honest limitation): the createInviteAction server guard
    // (`role in PROJECT_ADMIN_ROLES`) cannot be POSTed directly in a
    // build-stable way from Playwright (Next hashes server-action ids), so the
    // pure action-level rejection is not exercised here; it is covered by the
    // core/unit authz tests. This spec proves the member can reach no UI path
    // that would let them mint one.
  });

  test("cannot reach the organiser console — the staff wall replaces it [org gate: resolveOrgSession]", async ({
    makeAppPage,
  }) => {
    const { member } = await memberOfFreshCamp(makeAppPage);
    const orgPage = await makeAppPage("org");
    // Same identity, org app (no cross-host SSO on a preview, so sign in here).
    await signInAs(orgPage, member, "org");

    await orgPage.goto("/registrations");
    // Guard: the org console layout gates a non-org principal. The wall IS the
    // refusal; the queue heading is absent (not merely hidden behind a link).
    await expect(
      orgPage.getByText(/this side is for afrikaburn staff/i),
    ).toBeVisible();
    await expect(
      orgPage.getByRole("heading", { name: /registration queue/i }),
    ).toHaveCount(0);

    // The god-only accounts surface is likewise walled off (a camp member holds
    // no org role at all, so god-only surfaces are doubly out of reach).
    await orgPage.goto("/accounts");
    await expect(
      orgPage.getByText(/this side is for afrikaburn staff/i),
    ).toBeVisible();
  });
});
