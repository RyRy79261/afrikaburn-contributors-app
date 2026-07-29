// specs/camp-member/leaving-a-camp.spec.ts
//
// Persona: CAMP MEMBER (and the lead they leave behind) — the exit.
//
// `leaveCamp` (apps/web/lib/groups-store.ts) is a real, reachable, destructive
// action with one guard on it: a LEAD may not leave while anyone else is still
// in the camp, because "a camp always needs a lead". Nothing tested any of it —
// not the ordinary member leaving, not the guard, not the sole lead who IS
// allowed to leave because there is nobody left to strand.
//
// The guard is the interesting half. Get it wrong in the permissive direction
// and a camp is left with members, a registration, invites and no one who can
// administer any of it — an unrecoverable state, because every remedy
// (transferring lead, inviting, editing the registration) needs the lead the
// camp no longer has.
//
// Three cases, in the order they matter:
//   1. A member leaves. Membership gone, roster shrinks, the camp's own pages
//      are refused to them afterwards.
//   2. The lead tries to leave with a member still there — REFUSED, and told to
//      transfer first rather than merely being blocked.
//   3. The lead leaves once alone — allowed.

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { expectServerNotFound } from "./support";

test.describe("camp member — leaving a camp", () => {
  test("a member leaves; the lead cannot until they are the last one there", async ({
    makeAppPage,
  }) => {
    test.setTimeout(180_000);

    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage, { description: "Coffee at dawn." });
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true });
    await joinByInvite(memberPage, invite.url);

    // Two people on the roster, from the lead's side. The count is what the
    // guard below reads, so proving it first makes the refusal non-vacuous.
    await leadPage.goto(`/camps/${camp.slug}`);
    await expect(
      leadPage.getByRole("heading", { name: /members \(2\)/i }),
    ).toBeVisible();

    // CASE 2, FIRST — while the member is still here. Confirm-in-place, then
    // the refusal, which must NAME the remedy.
    await leadPage.getByRole("button", { name: /leave camp/i }).click();
    await leadPage.getByRole("button", { name: /^leave$/i }).click();
    await expect(
      leadPage.getByText(/transfer the lead role before leaving/i),
    ).toBeVisible();
    // Still in the camp — the refusal was real, not just a message.
    await leadPage.goto(`/camps/${camp.slug}`);
    await expect(
      leadPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();

    // CASE 1 — the member leaves.
    await memberPage.goto(`/camps/${camp.slug}`);
    await memberPage.getByRole("button", { name: /leave camp/i }).click();
    await memberPage.getByRole("button", { name: /^leave$/i }).click();
    await memberPage.waitForURL(/\/directory\/?$/);
    await expect(
      memberPage.getByText(/you['’]ve left the camp/i),
    ).toBeVisible();

    // …and the camp is no longer theirs to open. A free camp is undiscoverable
    // to non-members, so the server refuses rather than rendering a stranger's
    // view of it.
    await expectServerNotFound(memberPage, `/camps/${camp.slug}`, [camp.name]);

    // The roster shrank on the lead's side — the membership really went.
    await leadPage.goto(`/camps/${camp.slug}`);
    await expect(
      leadPage.getByRole("heading", { name: /members \(1\)/i }),
    ).toBeVisible();

    // CASE 3 — the lead is alone now, so leaving is allowed. Nobody is
    // stranded, which is the only thing the guard was protecting.
    await leadPage.getByRole("button", { name: /leave camp/i }).click();
    await leadPage.getByRole("button", { name: /^leave$/i }).click();
    await leadPage.waitForURL(/\/directory\/?$/);
    await expect(leadPage.getByText(/you['’]ve left the camp/i)).toBeVisible();
  });
});
