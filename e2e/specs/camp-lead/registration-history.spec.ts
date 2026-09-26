// specs/camp-lead/registration-history.spec.ts
//
// Persona: CAMP LEAD — the registration's read-only companions (epic #50):
//   /camps/[slug]/registration/history          "Past registrations"
//   /camps/[slug]/registration/history/[year]   one past registration
//   /camps/[slug]/registration/changes          "What changed since last year"
//
// WHAT THIS CAN AND CANNOT COVER. Every camp in this suite is created live in
// the one seeded edition (AfrikaBurn 2027) — seeds hold no burner data and there
// is no earlier edition to have registered in. So the POSITIVE path (a 2026
// registration listed, opened, diffed and carried forward from) is not reachable
// end to end here; it is pinned by the unit suites instead
// (apps/web/lib/__tests__/registration-store.test.ts, apps/org/lib/__tests__/
// registration-placement.test.ts, @quagga/core registration-carry-forward).
//
// What IS reachable, and is what this spec pins against the real server:
//   · a first-time camp's lead gets honest empty states, not an error;
//   · THIS edition's registration is never presented as a "past" one, even once
//     submitted (the strictly-earlier rule, enforced server-side);
//   · a malformed year is a 404, not a crash;
//   · a lead of ANOTHER camp is refused (the member refusals live in
//     camp-member-forbidden.spec.ts).

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  submitRegistration,
} from "../../personas/factories";

test.describe("camp lead — past registrations and what changed", () => {
  test("a first-time camp sees honest empty states on both pages", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);

    await webPage.goto(`/camps/${camp.slug}/registration/history`);
    // PRESENT first: the page's own heading and its empty state.
    await expect(
      webPage.getByRole("heading", { name: /past registrations/i }),
    ).toBeVisible();
    await expect(
      webPage.getByText(/no earlier registrations yet/i),
    ).toBeVisible();
    await expect(
      webPage.getByRole("list", { name: /past registrations/i }),
    ).toHaveCount(0);

    await webPage.goto(`/camps/${camp.slug}/registration/changes`);
    await expect(
      webPage.getByText(/nothing to compare with yet/i),
    ).toBeVisible();
    await expect(webPage.getByTestId("registration-changes")).toHaveCount(0);
  });

  test("the workspace offers no history links to a camp with no history", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);

    await webPage.goto(`/camps/${camp.slug}/registration`);
    // PRESENT first: the workspace eyebrow only the workspace renders.
    await expect(
      webPage.getByText(/theme camp registration/i).first(),
    ).toBeVisible();
    await expect(
      webPage.getByRole("link", { name: /past registrations/i }),
    ).toHaveCount(0);
    await expect(
      webPage.getByRole("link", { name: /what changed since/i }),
    ).toHaveCount(0);
    // …and no carry-forward offer, because there is nothing to carry.
    await expect(
      webPage.getByRole("button", { name: /answers across/i }),
    ).toHaveCount(0);
  });

  test("this edition's submitted registration is not a past one", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Chai at dawn." });
    await submitRegistration(webPage, camp.slug);

    // Submitted in 2027 — but 2027 is the CURRENT edition, so the history
    // detail refuses it (getPastRegistration → strictly earlier editions only).
    await webPage.goto(`/camps/${camp.slug}/registration/history/2027`);
    await expect(webPage.getByText(/we couldn['’]t find/i)).toBeVisible();

    // And the list still has nothing in it.
    await webPage.goto(`/camps/${camp.slug}/registration/history`);
    await expect(
      webPage.getByText(/no earlier registrations yet/i),
    ).toBeVisible();
  });

  test("a malformed or empty year is a 404, not a crash", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);

    for (const year of ["not-a-year", "2019"]) {
      await webPage.goto(`/camps/${camp.slug}/registration/history/${year}`);
      await expect(webPage.getByText(/we couldn['’]t find/i)).toBeVisible();
    }
  });

  test("a lead of ANOTHER camp is refused both pages [canViewCampRegistration]", async ({
    makeAppPage,
  }) => {
    const ownerPage = await makeAppPage("web");
    await signUpBurner(ownerPage, { onboard: true });
    const theirCamp = await createCamp(ownerPage);

    const outsiderPage = await makeAppPage("web");
    await signUpBurner(outsiderPage, { onboard: true });
    await createCamp(outsiderPage);

    for (const path of ["registration/history", "registration/changes"]) {
      await outsiderPage.goto(`/camps/${theirCamp.slug}/${path}`);
      // Guard: requireRegistrationViewer → canViewCampRegistration(null) →
      // redirect to the camp dashboard, which itself 404s a stranger to a free
      // camp. PRESENT first: the 404's own copy.
      await expect(
        outsiderPage.getByText(/we couldn['’]t find/i),
      ).toBeVisible();
      await expect(
        outsiderPage.getByText(/no earlier registrations yet/i),
      ).toHaveCount(0);
      await expect(
        outsiderPage.getByText(/nothing to compare with yet/i),
      ).toHaveCount(0);
    }
  });
});
