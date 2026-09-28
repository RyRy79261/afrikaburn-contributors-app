// specs/camp-lead/former-members.spec.ts
//
// Persona: CAMP LEAD — archiving a former member (App Spec CDB-036, epic #55).
//
// Archiving REVOKES camp access and keeps history; a restore brings the person
// back as a PLAIN member, without the custom roles they held. One journey,
// because each half only means something against the state the other left:
//
//   1. The member joins and is given a custom role whose privilege unlocks a
//      server-guarded surface (Roles & Officers). Both the role badge on the
//      roster and the member reaching that surface are asserted PRESENT first,
//      so every later absence is a change, not a default.
//   2. The lead archives them. The member's next visit to the camp is the
//      server's not-found (a free camp is undiscoverable to non-members), the
//      lead's current roster no longer lists them, and they are listed under
//      "Former members" with a Restore action.
//   3. The lead restores them. The member opens the camp again — but the
//      custom role is gone: no badge on the roster row, and the surface it
//      unlocked is refused again.
//
// If archive did nothing, step 2's not-found never renders and the Former list
// stays on its "No former members" empty state. If restore handed the roles
// back, step 3's badge is still there and the roles page still renders.
//
// Selector provenance (verified against source on 2026-09-28):
//   row action ....... apps/web/components/roster/member-archive-button.tsx
//                      ("Archive <name>" / "Restore <name>", then an inline
//                      confirm whose button is plain "Archive" / "Restore")
//   toggle ........... apps/web/components/roster/roster-filters.tsx
//   roster page ...... apps/web/app/(app)/camps/[slug]/roster/page.tsx
//   roles page ....... apps/web/app/(app)/camps/[slug]/settings/roles/page.tsx
//                      (notFound() without manage_roles / assign_roles)

import { test, expect } from "../../fixtures";
import type { Locator, Page } from "@playwright/test";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { assignRoleToMember, createCustomRole } from "./support";
import { expectServerNotFound } from "../camp-member/support";

/** A member's visible roster row — the <tr> on desktop, the card on mobile. */
function rosterRow(page: Page, name: string): Locator {
  return page
    .locator("tr, li")
    .filter({ hasText: name })
    .filter({ visible: true });
}

async function gotoRoster(page: Page, slug: string, query = ""): Promise<void> {
  await page.goto(`/camps/${slug}/roster${query}`);
  await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
}

/**
 * Run a row's archive/restore action through its inline confirm. Opened until
 * the confirm shows: a click that lands before hydration does nothing.
 */
async function confirmRowAction(
  page: Page,
  name: string,
  mode: "Archive" | "Restore",
): Promise<void> {
  const row = rosterRow(page, name);
  const prompt =
    mode === "Archive"
      ? /they lose access to the camp\. sure\?/i
      : /they come back as a member, without their old roles\. sure\?/i;
  await expect(async () => {
    await row.getByRole("button", { name: `${mode} ${name}` }).click();
    await expect(row.getByText(prompt)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await row.getByRole("button", { name: mode, exact: true }).click();
  await expect(
    page.getByText(
      mode === "Archive"
        ? `${name} is now a former member`
        : `${name} is back in the camp`,
    ),
  ).toBeVisible();
}

test.describe("camp lead — former members", () => {
  test("archiving removes camp access; restoring returns a plain member without their custom role", async ({
    makeAppPage,
  }) => {
    test.setTimeout(240_000);

    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const memberName = uniqueUsername("former_ren");
    const roleName = uniqueName("Crew Boss");
    const rolesUrl = (slug: string) => `/camps/${slug}/settings/roles`;

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, invite.url);

    // ── 1. A member with a custom role that unlocks something ──────────────
    await createCustomRole(leadPage, camp.slug, {
      name: roleName,
      emoji: "🛠️",
      colorLabel: "Teal",
      privileges: ["Can assign roles to members"],
    });
    await assignRoleToMember(leadPage, camp.slug, memberName, roleName);

    // The role is on their roster row…
    await gotoRoster(leadPage, camp.slug);
    await expect(rosterRow(leadPage, memberName)).toContainText(roleName);
    // …and it genuinely unlocks the roles surface for them.
    await memberPage.goto(rolesUrl(camp.slug));
    await expect(
      memberPage.getByRole("heading", { name: /roles & officers/i }),
    ).toBeVisible();
    // They are in the camp.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(
      memberPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();

    // Nobody is former yet — the empty state, PRESENT.
    await gotoRoster(leadPage, camp.slug, "?status=former");
    await expect(leadPage.getByText("No former members")).toBeVisible();

    // ── 2. Archive ─────────────────────────────────────────────────────────
    await gotoRoster(leadPage, camp.slug);
    await confirmRowAction(leadPage, memberName, "Archive");

    // The member's next visit: the camp is gone for them (not-found copy
    // PRESENT, then no trace of the camp — nav included).
    await expectServerNotFound(memberPage, `/camps/${camp.slug}`, [camp.name]);
    // The surface their role unlocked is refused too.
    await expectServerNotFound(memberPage, rolesUrl(camp.slug));

    // The lead's current roster no longer lists them (count PRESENT first).
    await gotoRoster(leadPage, camp.slug);
    await expect(leadPage.getByText(/^1 person$/)).toBeVisible();
    await expect(rosterRow(leadPage, memberName)).toHaveCount(0);
    // The camp page's member list shrank with it.
    await leadPage.goto(`/camps/${camp.slug}`);
    await expect(
      leadPage.getByRole("heading", { name: /members \(1\)/i }),
    ).toBeVisible();

    // They are under "Former members", reached through the toggle.
    await gotoRoster(leadPage, camp.slug);
    await leadPage
      .getByRole("radio", { name: "Former members", exact: true })
      .click();
    await expect(leadPage).toHaveURL(/status=former/);
    await expect(
      leadPage.getByText(/1 former member — they no longer have access/i),
    ).toBeVisible();
    await expect(rosterRow(leadPage, memberName)).toBeVisible();
    await expect(
      rosterRow(leadPage, memberName).getByRole("button", {
        name: `Restore ${memberName}`,
      }),
    ).toBeVisible();

    // ── 3. Restore ─────────────────────────────────────────────────────────
    await confirmRowAction(leadPage, memberName, "Restore");

    // Back in the camp.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(
      memberPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();

    // As a PLAIN member: the row is back, labelled Member, without the role.
    await gotoRoster(leadPage, camp.slug);
    await expect(leadPage.getByText(/^2 people$/)).toBeVisible();
    const row = rosterRow(leadPage, memberName);
    await expect(row).toContainText("Member");
    await expect(row).not.toContainText(roleName);
    // The role still exists — it was the ASSIGNMENT that went, not the role.
    await leadPage.goto(rolesUrl(camp.slug));
    await expect(leadPage.getByText(roleName).first()).toBeVisible();
    // And the privilege it carried no longer reaches them.
    await expectServerNotFound(memberPage, rolesUrl(camp.slug));
  });
});
