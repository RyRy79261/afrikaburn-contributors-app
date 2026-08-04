// specs/anon/free-camp-undiscoverable.spec.ts — the undiscoverability law, the
// central negative of the anonymous persona (registry: discover-free-camp +
// open-free-camp-page; AGENTS.md Product laws; roadmap M3-30).
//
// A "free" camp is any camp not yet approved-registered for the edition. The law:
// a stranger can find it NOWHERE — not by name in the directory, and not by
// guessing its slug. We prove the refusal is SERVER-SIDE two ways, and — crucially
// — we prove the directory FILTER discriminates rather than the search being
// merely broken/empty: the very same camp, searched by the very same name, IS
// found by a member (its lead) and is NOT found by an anonymous stranger. If the
// server-side filter (apps/web/lib/groups-store.ts listDirectory:
// `if (!registered && !viewerRole) continue`) were deleted, the stranger
// assertion would go red — the exact regression this spec guards.

import { test, expect } from "../../fixtures";
import { signUpBurner, createCamp } from "../../personas/factories";

test.describe("anonymous visitor — free camps are undiscoverable", () => {
  test("a free camp is visible to its member but invisible to a stranger by name", async ({
    webPage,
    makeAppPage,
  }) => {
    // Lead creates a free (unregistered) camp with a unique name.
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, {
      description: "A quiet free camp, members only.",
    });

    // The MEMBER (lead) DOES find it by name — proves the camp exists and is
    // name-matchable, so the stranger's miss below is the filter, not a typo.
    await webPage.goto(`/directory?q=${encodeURIComponent(camp.name)}`);
    await expect(webPage.getByRole("link", { name: camp.name })).toBeVisible();

    // The STRANGER (fresh context, no session) searching the SAME name finds
    // nothing — the server excludes free camps from non-member results.
    const anon = await makeAppPage("web");
    await anon.goto(`/directory?q=${encodeURIComponent(camp.name)}`);
    await expect(anon).toHaveURL(/\/directory/); // still public, not bounced
    await expect(anon.getByText(camp.name)).toHaveCount(0);
    await expect(
      anon.getByText(/no camps match your filters|no registered camps yet/i),
    ).toBeVisible();
  });

  test("opening a free camp's page by direct slug refuses a stranger server-side", async ({
    webPage,
    makeAppPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);

    // The lead can open their own camp — the slug is real and resolvable.
    await webPage.goto(`/camps/${camp.slug}`);
    await expect(
      webPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();

    // A stranger hitting the exact same slug is redirected to sign-in by the
    // server (camp page: `!camp.registered && !camp.viewerRole` → redirect for an
    // unauthenticated visitor). The camp's name never renders for them.
    const anon = await makeAppPage("web");
    await anon.goto(`/camps/${camp.slug}`);
    await expect(anon).toHaveURL(/\/auth\/sign-in/);
    await expect(anon.getByRole("heading", { name: camp.name })).toHaveCount(0);
  });

  test("a non-existent slug leaks no camp content to a stranger", async ({
    makeAppPage,
  }) => {
    // A slug that resolves to nothing hits notFound() (a 404), NOT the free-camp
    // sign-in redirect — so we assert only the guarantee that matters here: no
    // camp dashboard chrome renders. (The differing response codes for a hidden
    // free camp vs. a missing slug are a mild enumeration oracle, called out in
    // the report — not something this spec can assert away.)
    const anon = await makeAppPage("web");
    await anon.goto(
      `/camps/definitely-not-a-real-camp-${Date.now().toString(36)}`,
    );
    await expect(anon.getByText(/^members \(/i)).toHaveCount(0);
    await expect(anon.getByRole("link", { name: /invite/i })).toHaveCount(0);
  });
});
