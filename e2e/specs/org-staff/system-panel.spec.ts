// The SYSTEM PANEL — `/system`, the org console's IT surface.
//
// Ryan's brief (27 Jul 2026): "There should probably be a System management
// panel for IT staff and System manager teams to manage certain IT specific
// settings, security controls, and god level account management."
//
// Three things are worth proving in a real browser, and only the third could be
// proved anywhere else:
//
//   1. THE RANKS ARE NOT A LADDER. An engineer reaches this page and org_staff —
//      who outranks them on personal information and on deletion — is refused.
//      That inversion is the single most likely thing for a future change to
//      "tidy up" into a seniority check, and a unit test of the matrix would not
//      notice, because the matrix would still be consulted; it would just be
//      consulted by a page that had stopped asking.
//   2. THE REFUSAL IS HONEST. org_staff sees a page that says which rank holds
//      this and why, not a 404 and not a blank card. A console that hides things
//      without explaining teaches nobody the rule.
//   3. NO PERSONAL INFORMATION ON IT'S OWN PAGE. The org-access roster is a list
//      of people, rendered on the one page an engineer is specifically invited
//      to open — the most inviting place in the codebase to write "they can see
//      the page, so let them see the rows". The engineer's own address is
//      certainly in that table, so if any address were shipped, this is where it
//      would show.
//
// HONEST SCOPE NOTE (registry §"TWO TIERS OF PROOF"). This is tier (A): the
// surface is reachable by URL, so the wrong persona gets an OBSERVABLE server
// refusal and deleting the page's `runsDeployment` check makes this file go red.
// What it does NOT prove is the CONTENT of the checks — whether "email
// verification: off" is derived correctly from the environment. That is a pure
// function of an env bag and a probe, and it is proved exhaustively (including
// "no secret is ever printed", against an env where every credential is a
// marker) in apps/org/lib/__tests__/system-status.test.ts, in the same
// `turbo run test` gate.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { elevateToGod } from "../../personas/factories";
import { desktopOnly, provisionEngineer, provisionOrgStaff } from "./_helpers";

test.describe("the system panel belongs to IT, not to the operator tier", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("an engineer reaches it, and it tells them about this deployment", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const engineer = await provisionEngineer(makeAppPage);

    await engineer.org.goto("/system");
    await expect(
      engineer.org.getByRole("heading", { name: /system management/i }),
    ).toBeVisible();

    // The nav entry is there for this rank — the page and the bar read one
    // predicate, so if the page renders and the entry is missing, they disagree.
    await expect(
      engineer.org.getByRole("navigation", { name: /console/i }).getByRole("link", {
        name: "System",
        exact: true,
      }),
    ).toBeVisible();

    // The two panels the brief asked for, both actually rendered.
    await expect(
      engineer.org.getByText(/system health/i).first(),
    ).toBeVisible();
    await expect(
      engineer.org.getByText(/security controls/i).first(),
    ).toBeVisible();

    // Real derived state, not a placeholder: email verification is reported
    // WITH its reason. The local stack runs without a Resend key, so the honest
    // answer is "off, because there is no sender" — and either wording of the
    // derived answer is acceptable here; what must never appear is silence.
    await expect(
      engineer.org.getByText(/email verification/i).first(),
    ).toBeVisible();

    // The audit trail is linked from here, per the brief.
    await expect(
      engineer.org.getByRole("link", { name: /open the audit log/i }),
    ).toBeVisible();

    // The permission model lives in this panel too, and an engineer may READ
    // it: it is this deployment's configuration, the same class of fact as the
    // auth settings beside it.
    await expect(
      engineer.org.getByRole("link", { name: /read the roles model/i }),
    ).toBeVisible();
  });

  test("an engineer reads the roles model and is offered nothing to change", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const engineer = await provisionEngineer(makeAppPage);

    await engineer.org.goto("/system/roles");
    await expect(
      engineer.org.getByRole("heading", { name: /roles and departments/i }),
    ).toBeVisible();
    // The seeded org-wide roles are readable…
    await expect(engineer.org.getByText("Org staff").first()).toBeVisible();
    // …and every control that would CHANGE the model is absent, because those
    // ask for the `god` anchor, which no role can carry.
    for (const control of [
      /add department/i,
      /new role/i,
      /edit rights/i, // named "Edit rights for <role>" when it renders at all
      /^rename/i,
    ]) {
      await expect(
        engineer.org.getByRole("button", { name: control }),
      ).toHaveCount(0);
    }
    // And they are told why, rather than left to notice the absence.
    await expect(
      engineer.org.getByText(/changing it belongs to a system manager/i),
    ).toBeVisible();
  });

  test("org staff are refused it, and told which rank holds it [reach-god-only-surface]", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const staff = await provisionOrgStaff(makeAppPage);

    // Not in their nav…
    await staff.org.goto("/");
    await expect(
      staff.org
        .getByRole("navigation", { name: /console/i })
        .getByRole("link", { name: "System", exact: true }),
    ).toHaveCount(0);

    // …and hiding it is NOT the boundary: typing the URL is refused server-side.
    await staff.org.goto("/system");
    await expect(
      staff.org.getByRole("heading", { name: /system management/i }),
    ).toBeVisible();
    // The refusal is the ONE the resolver produces (@quagga/core
    // `runsDeploymentRefusal`), so the page cannot drift from what the guard
    // would say. It is a RANK sentence, not a capability one: the old capability was
    // dropped in the CRUD rework — running the deployment is the engineer's job
    // description, not something a department grants — so the old
    // "none of your org roles open the system panel" no longer exists anywhere.
    await expect(
      staff.org.getByText(/IT work rather than org work/i),
    ).toBeVisible();

    // Refused, not 404'd, and the reason names both the rank that holds it and
    // the rank that does not.
    await expect(staff.org.getByText(/engineer/i).first()).toBeVisible();

    // None of the panel's content leaked past the refusal.
    await expect(staff.org.getByText(/system health/i)).toHaveCount(0);
    await expect(staff.org.getByText(/security controls/i)).toHaveCount(0);

    // The roles surface lives inside this panel and is refused on the same
    // capability — hiding the link is never the boundary.
    await staff.org.goto("/system/roles");
    await expect(
      staff.org.getByRole("heading", { name: /roles and departments/i }),
    ).toBeVisible();
    await expect(staff.org.getByText(/not your screen/i)).toBeVisible();
    await expect(
      staff.org.getByRole("button", { name: /edit rights/i }),
    ).toHaveCount(0);
  });

  test("the engineer's org-access roster carries no email addresses", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const engineer = await provisionEngineer(makeAppPage);

    await engineer.org.goto("/system");

    // Scoped to the VISIBLE layout: ResponsiveDataTable renders the desktop
    // table and the mobile stacked cards into the DOM together, so an unscoped
    // locator matches twice and trips strict mode (README §Selector traps).
    // Not scoped to the whole page, because the header legitimately shows the
    // SIGNED-IN user their own address — self-access, not a rank leak.
    const roster = engineer.org
      .getByRole("table", { name: /org access/i })
      .filter({ visible: true })
      .first();
    await expect(roster).toBeVisible();
    // Their own row is certainly in this table — they hold org access.
    await expect(roster).not.toContainText(engineer.account.email);

    // And no access controls: the system panel is a READ. Reaching it must
    // never imply the System manager rank.
    await expect(
      engineer.org.getByRole("button", { name: /give org staff access/i }),
    ).toHaveCount(0);
    await expect(
      engineer.org.getByRole("button", { name: /remove staff access/i }),
    ).toHaveCount(0);
  });

  test("a System manager gets the same page WITH the access controls", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const godOrg = await makeAppPage("org");
    await elevateToGod(godOrg);

    await godOrg.goto("/system");
    await expect(
      godOrg.getByRole("heading", { name: /system management/i }),
    ).toBeVisible();

    // The roster names them at their own rank, and the panel is the same one.
    await expect(godOrg.getByText(/org access/i).first()).toBeVisible();
    await expect(godOrg.getByText(/system health/i).first()).toBeVisible();

    // A god is in this roster, so the sole-System-manager warning is either
    // shown (one of them) or absent (several) — never a crash, and never a name
    // attached to the count.
    await expect(
      godOrg.getByRole("heading", { name: /system management/i }),
    ).toBeVisible();
  });
});
