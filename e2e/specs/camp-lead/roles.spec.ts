// specs/camp-lead/roles.spec.ts
//
// Persona: CAMP LEAD — running the crew's roles. Three things, each with teeth:
//   1. Create a custom role (colour + emoji + privileges) and see it persist.
//   2. Prove a granted privilege actually UNLOCKS the corresponding action and
//      revoking it RE-LOCKS — asserted against the server-guarded roles surface
//      reached by DIRECT URL (not a hidden link): before the grant the server
//      refuses to render it, after the grant it renders, after the revoke it
//      refuses again.
//   3. The structural backstop: a lead cannot strand their own camp by editing
//      roles — Captain privileges are locked ON, deleting every custom role
//      leaves the lead's management authority intact (it's structural, not a
//      grant), and a lead with members cannot abandon the camp without
//      transferring the lead role (server refusal).

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import {
  assignRoleToMember,
  createCustomRole,
  gotoRolesSettings,
  revokeRoleFromMember,
} from "./support";

test.describe("camp lead — custom roles", () => {
  test("a custom role is created with its colour, emoji and privileges, and persists", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);

    const roleName = uniqueName("Bar Lead");
    await createCustomRole(webPage, camp.slug, {
      name: roleName,
      emoji: "🍳",
      colorLabel: "Rust",
      privileges: ["Can see private member info"],
    });

    // Reload from the server: the role survives as a real Custom-roles row with
    // its emoji + name, and its collapsed summary reflects the granted privilege.
    await gotoRolesSettings(webPage, camp.slug);
    await expect(webPage.getByText(roleName).first()).toBeVisible();
    await expect(
      webPage.getByText(/sees member details/i).first(),
    ).toBeVisible();
  });
});

test.describe("camp lead — a granted privilege unlocks, a revoked one re-locks", () => {
  test("assign_roles unlocks the roles surface for a member; revoking it locks it again", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const memberName = uniqueUsername("member_ren");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true, username: memberName });
    await joinByInvite(memberPage, invite.url);

    const roleName = uniqueName("Crew Boss");
    await createCustomRole(leadPage, camp.slug, {
      name: roleName,
      emoji: "🛠️",
      colorLabel: "Teal",
      privileges: ["Can assign roles to members"],
    });

    const rolesUrl = `/camps/${camp.slug}/settings/roles`;
    const rolesHeading = memberPage.getByRole("heading", {
      name: /roles & officers/i,
    });

    // LOCKED (default-deny): the member navigates STRAIGHT to the protected URL
    // and the server refuses to render it (notFound → the heading is absent).
    // This is the guard refusing, not a hidden nav item.
    await memberPage.goto(rolesUrl);
    await expect(rolesHeading).toHaveCount(0);
    // And the camp dashboard offers them no role affordances.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(
      memberPage.getByRole("link", { name: /manage roles/i }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: /^assign$/i }),
    ).toHaveCount(0);

    // GRANT the role.
    await assignRoleToMember(leadPage, camp.slug, memberName, roleName);

    // UNLOCKED: the exact same URL now renders for the member — the privilege
    // genuinely unlocked the server-side surface.
    await memberPage.goto(rolesUrl);
    await expect(rolesHeading).toBeVisible();
    // The dashboard now offers the assign affordance too.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(
      memberPage.getByRole("link", { name: /manage roles/i }),
    ).toBeVisible();

    // REVOKE the role.
    await revokeRoleFromMember(leadPage, camp.slug, memberName, roleName);

    // RE-LOCKED: the server refuses the surface again — proving the unlock was
    // the grant, and that removing it is honoured server-side.
    await memberPage.goto(rolesUrl);
    await expect(rolesHeading).toHaveCount(0);
  });
});

test.describe("camp lead — structural backstop (no self-lockout)", () => {
  test("Captain privileges are locked on and cannot be reduced", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);
    await gotoRolesSettings(webPage, camp.slug);

    // Expand the seeded Captain row.
    await webPage
      .getByRole("button", { name: /captain/i })
      .filter({ visible: true })
      .first()
      .click();

    // The lock is enforced in the editor: the privilege switches are disabled,
    // so no one can drift a captain below full rights (server also coerces via
    // enforceKindPermissions — the UI here is the visible half of that guard).
    await expect(
      webPage.getByText(/captains can do everything/i),
    ).toBeVisible();
    await expect(
      webPage.getByRole("switch", { name: /can manage role definitions/i }),
    ).toBeDisabled();
  });

  test("deleting every custom role leaves the lead's management authority intact", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);

    const roleName = uniqueName("Disposable Role");
    await createCustomRole(webPage, camp.slug, {
      name: roleName,
      emoji: "⚡",
      colorLabel: "Olive",
    });

    // Delete it through the row's confirm → destructive button.
    await gotoRolesSettings(webPage, camp.slug);
    await webPage
      .getByRole("button", { name: new RegExp(roleName, "i") })
      .filter({ visible: true })
      .first()
      .click();
    await webPage.getByRole("button", { name: /^delete role$/i }).click();
    await webPage
      .getByRole("button", { name: new RegExp(`delete ${roleName}`, "i") })
      .click();

    // The lead STILL manages roles after tearing everything down: the page is
    // reachable and the "New role" affordance (manage_roles-gated) is present.
    // Their authority is the structural lead backstop, not a revocable grant.
    await gotoRolesSettings(webPage, camp.slug);
    await expect(
      webPage.getByRole("button", { name: /^new role$/i }),
    ).toBeVisible();
    // And on the dashboard they are still the Lead.
    await webPage.goto(`/camps/${camp.slug}`);
    await expect(webPage.getByText("Lead", { exact: true })).toBeVisible();
    await expect(webPage.getByText("(you)")).toBeVisible();
  });

  test("a lead with members cannot abandon the camp without transferring lead", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");
    await signUpBurner(memberPage, { onboard: true });
    await joinByInvite(memberPage, invite.url);

    // The lead tries to leave while the camp still has other members.
    await leadPage.goto(`/camps/${camp.slug}`);
    await leadPage.getByRole("button", { name: /^leave camp$/i }).click();
    await leadPage.getByRole("button", { name: /^leave$/i }).click();

    // Server refusal (leaveCamp guard): the lead is told to transfer first, and
    // they are STILL the lead — a camp always needs a lead.
    await expect(
      leadPage.getByText(/transfer the lead role before leaving/i),
    ).toBeVisible();
    await leadPage.goto(`/camps/${camp.slug}`);
    await expect(leadPage.getByText("Lead", { exact: true })).toBeVisible();
    await expect(leadPage.getByText("(you)")).toBeVisible();
  });
});
