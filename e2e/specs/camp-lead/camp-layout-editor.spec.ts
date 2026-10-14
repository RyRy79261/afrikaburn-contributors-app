// specs/camp-lead/camp-layout-editor.spec.ts
//
// Persona: CAMP LEAD (+ a member, + a stranger) — the camp layout editor
// (docs/camp-layout-spec.md; frames L1 f3jmCq, L2 LcZsE).
//
// Desktop, one journey, because each step means something only against the
// state the one before left:
//
//   1. With a registration and no layout, the lead gets "No layout for … yet"
//      and creates a 40 m × 30 m plot. The editor opens on it.
//   2. A Kitchen added from the palette (a click — the keyboard path) lands
//      selected in the inspector. Typing Centre X = 1 puts 2 m of it off the
//      plot, and the warnings panel says so in metres; picking the warning
//      selects the object. The save chip settles on "Saved".
//   3. The edit survived the server: a reload shows Centre X 1.0.
//   4. Keyboard on the plan: → moves it 0.5 m, Ctrl+Z puts it back, Delete
//      removes it.
//   5. A Bedouin opens as its own covered area: the breadcrumb, the "Inside a
//      Bedouin" palette, the covered size, a tent added inside. Back to the
//      whole camp.
//   6. Two tabs: the second saves first, so the first's next save is REFUSED
//      with "This layout changed since you opened it" and a Reload.
//   7. A plain member gets the read-only view — no palette, no warnings.
//   8. A stranger gets the camp's not-found.
//
// At 360 the same lead can neither start nor edit a plan, and gets NO canvas
// (decision 13). The view-only plan is camp-layout-view.spec.ts.
//
// HONEST SCOPE NOTE. Pointer dragging, resizing and rotating on the canvas
// are Konva's and are not driven here: the inspector inputs are the
// accessible path to every one of those edits and are what this asserts. The
// metre maths behind both (snapping, clamping, covered areas) is unit-tested
// in apps/web/lib/__tests__/layout-editor-model.test.ts.
//
// Selector provenance (verified against source on 2026-10-14):
//   page ............ apps/web/app/(app)/camps/[slug]/layout/page.tsx
//   start card ...... apps/web/components/layout-editor/layout-start-card.tsx
//   editor .......... apps/web/components/layout-editor/camp-layout-editor.tsx
//   panels .......... apps/web/components/layout-editor/editor-panels.tsx
//   read-only ....... apps/web/components/layout-view/layout-read-only.tsx

import { test, expect } from "../../fixtures";
import type { Page } from "@playwright/test";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
  submitRegistration,
} from "../../personas/factories";
import { expectServerNotFound } from "../camp-member/support";

async function gotoLayout(page: Page, slug: string) {
  await page.goto(`/camps/${slug}/layout`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Camp layout" }).first(),
  ).toBeVisible();
}

async function expectSaved(page: Page) {
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/** Type into an inspector field and commit with Enter. */
async function setField(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Enter");
}

test.describe("camp lead — the layout editor", () => {
  test("creates a plot, edits by input and keyboard, nests a Bedouin, refuses a stale save", async ({
    webPage,
    makeAppPage,
  }) => {
    test.skip(
      test.info().project.name === "mobile-360",
      "The editor needs 768 px; the 360 test below covers the phone.",
    );
    test.setTimeout(300_000);

    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Shade and chai." });
    await submitRegistration(webPage, camp.slug);

    // 1. Empty state → a plot.
    await gotoLayout(webPage, camp.slug);
    // The phone's start card is in the page too, hidden at this width.
    await expect(
      webPage.getByText(/no layout for .* yet/i).filter({ visible: true }),
    ).toBeVisible();
    await webPage.getByLabel("Width", { exact: true }).fill("40");
    await webPage.getByLabel("Depth", { exact: true }).fill("30");
    await webPage.getByRole("button", { name: "Create the plot" }).click();
    await expect(webPage.getByText("Plot 40.0 m × 30.0 m · 1,200 m²")).toBeVisible();
    await expect(webPage.getByRole("heading", { name: "Add to the plan" })).toBeVisible();
    await expect(webPage.locator("canvas").first()).toBeVisible();

    // 2. Add a Kitchen with a click; push it off the plot by typing.
    await webPage.getByRole("button", { name: /^Add Kitchen,/ }).click();
    await expect(webPage.getByRole("heading", { level: 2, name: "Kitchen 1" })).toBeVisible();
    await setField(webPage, "Centre X", "1");
    const warnings = webPage.getByRole("region", { name: /warnings/i });
    const offPlot = warnings.getByRole("button", {
      name: /Kitchen 1 is 2\.0 m outside the plot/,
    });
    await expect(offPlot).toBeVisible();
    await webPage.keyboard.press("Escape");
    await expect(webPage.getByRole("heading", { name: "Nothing selected" })).toBeVisible();
    await offPlot.click();
    await expect(webPage.getByRole("heading", { level: 2, name: "Kitchen 1" })).toBeVisible();
    await expectSaved(webPage);

    // 3. It reached the server.
    await webPage.reload();
    await webPage.getByRole("button", { name: /Kitchen 1 is 2\.0 m outside the plot/ }).click();
    await expect(webPage.getByLabel("Centre X", { exact: true })).toHaveValue("1.0");

    // 4. Keyboard on the plan.
    await webPage.getByRole("application").focus();
    await webPage.keyboard.press("ArrowRight");
    await expect(webPage.getByLabel("Centre X", { exact: true })).toHaveValue("1.5");
    await webPage.keyboard.press("Control+z");
    await expect(webPage.getByLabel("Centre X", { exact: true })).toHaveValue("1.0");
    await webPage.getByRole("application").focus();
    await webPage.keyboard.press("Delete");
    await expect(webPage.getByRole("heading", { name: "Nothing selected" })).toBeVisible();
    await expect(warnings.getByText(/Kitchen 1/)).toHaveCount(0);
    await expectSaved(webPage);

    // 5. A Bedouin, opened.
    await webPage.getByRole("button", { name: /^Add Bedouin,/ }).click();
    await webPage.getByRole("button", { name: "Open inside" }).click();
    const crumbs = webPage.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs).toContainText("Whole camp");
    await expect(crumbs).toContainText("Bedouin 1");
    await expect(webPage.getByText(/^Covered area 12\.0 m × 8\.0 m/)).toBeVisible();
    await expect(webPage.getByRole("heading", { name: "Inside a Bedouin" })).toBeVisible();
    await expect(webPage.getByLabel("Covered width", { exact: true })).toHaveValue("12.0");
    await webPage.getByRole("button", { name: /^Add Tent · 2 person,/ }).click();
    await expect(webPage.getByText("inside Bedouin 1", { exact: false }).first()).toBeVisible();
    await expect(webPage.getByText(/^1 tent · /)).toBeVisible();
    await webPage.getByRole("button", { name: "Back to whole camp" }).click();
    await expect(crumbs).toHaveCount(0);
    await expectSaved(webPage);

    // 6. A second tab saves first; this tab's next save is refused.
    const other = await webPage.context().newPage();
    await gotoLayout(other, camp.slug);
    await other.getByRole("button", { name: /^Add Stage,/ }).click();
    await expectSaved(other);
    await webPage.getByRole("button", { name: /^Add Container,/ }).click();
    await expect(
      webPage.getByText("This layout changed since you opened it"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(webPage.getByRole("button", { name: "Reload the layout" })).toBeVisible();
    await expect(webPage.getByText("Not saved", { exact: true })).toBeVisible();
    await webPage.getByRole("button", { name: "Reload the layout" }).click();
    await expectSaved(webPage);
    await other.close();

    // 7. A plain member: read-only, no warnings.
    const invite = await inviteToCamp(webPage, camp.slug);
    const memberPage = await makeAppPage("web");
    await signUpBurner(memberPage, { onboard: true });
    await joinByInvite(memberPage, invite.url);
    await gotoLayout(memberPage, camp.slug);
    await expect(memberPage.getByText(/read-only/i).first()).toBeVisible();
    await expect(memberPage.getByText(/^Plot 40 m × 30 m/)).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "Add to the plan" })).toHaveCount(0);
    await expect(memberPage.getByRole("heading", { name: /warnings/i })).toHaveCount(0);
    await expect(memberPage.locator("canvas")).toHaveCount(0);

    // 8. A stranger.
    const strangerPage = await makeAppPage("web");
    await signUpBurner(strangerPage, { onboard: true });
    await expectServerNotFound(strangerPage, `/camps/${camp.slug}/layout`, [
      camp.name,
    ]);
  });

  test("at 360 the lead can neither start nor edit a plan", async ({
    webPage,
  }) => {
    test.skip(
      test.info().project.name !== "mobile-360",
      "Phone layout only.",
    );
    test.setTimeout(240_000);

    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Shade and chai." });
    await submitRegistration(webPage, camp.slug);
    await gotoLayout(webPage, camp.slug);
    // A phone neither starts nor edits a plan (decision 13; frame t7aOZ3
    // state 4). The view-only plan itself is covered in
    // camp-layout-view.spec.ts.
    await expect(
      webPage.getByText(/no layout for .* yet/i).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      webPage.getByText(/on a tablet or computer/i).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      webPage.getByRole("button", { name: "Create the plot" }),
    ).toBeHidden();
    await expect(webPage.getByRole("heading", { name: "Add to the plan" })).toBeHidden();
    await expect(webPage.locator("canvas")).toHaveCount(0);
  });
});
