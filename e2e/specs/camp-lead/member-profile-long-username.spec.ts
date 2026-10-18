// specs/camp-lead/member-profile-long-username.spec.ts
//
// Persona: CAMP LEAD — a member's profile at 360 with the WIDEST username the
// product allows (20 characters, no spaces: @quagga/core USERNAME_MAX_LENGTH).
//
// Seen in PR #111's mobile-360 runs: the name ran out of the profile card. The
// heading never wrapped, and "Block {name}" was a nowrap button. Either one
// makes a mobile browser zoom the whole page out to fit (measured: a 617 px
// layout viewport on a 360 device), so everything else on the page is then
// drawn — and measured, and clicked — at the wrong size: the notes form's
// "Add note" click timed out behind other elements.
//
// The fix is CSS, so only a browser can prove it. Each card is checked on its
// own (no descendant ends right of the card's edge) as well as the page as a
// whole, so a failure names the card that overflowed.
//
// Selector provenance (verified against source on 2026-10-18):
//   hero ............. apps/web/components/profile-public/profile-hero.tsx (<header>)
//   block button ..... apps/web/components/messages/profile-message-actions.tsx
//   participation .... apps/web/components/stats/participation-summary.tsx
//                      (data-testid member-participation)
//   notes card ....... apps/web/components/member-records/private-notes-card.tsx
//                      (data-testid private-notes / private-note)

import { randomBytes } from "node:crypto";
import type { Locator } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";

/**
 * A 20-character username made of WIDE letters, unique per call. `w` and `m`
 * are the widest glyphs in the font, so this is the worst case a real handle
 * can reach; the random tail maps hex onto letters (a username must be
 * [a-z0-9_] and start with a letter) without falling back to narrow digits.
 */
function widestUsername(): string {
  const tail = randomBytes(5)
    .toString("hex")
    .replace(/[0-9a-f]/g, (c) => "mwqdbpghnkuaeoxz"[parseInt(c, 16)] ?? "w");
  return `${"w".repeat(10)}${tail}`;
}

/** How far (px) anything inside `card` reaches past the card's right edge,
 * and how far the card reaches past the viewport. */
async function overflowOf(
  card: Locator,
): Promise<{ inside: number; viewport: number }> {
  // Typed structurally: the e2e package compiles without the DOM lib.
  interface Box {
    getBoundingClientRect(): { right: number; width: number };
  }
  return card.evaluate(
    (
      el: Box & {
        querySelectorAll(selector: string): ArrayLike<Box>;
        ownerDocument: { documentElement: { clientWidth: number } };
      },
    ) => {
      const edge = el.getBoundingClientRect().right;
      let furthest = edge;
      for (const child of Array.from(el.querySelectorAll("*"))) {
        const r = child.getBoundingClientRect();
        if (r.width > 0) furthest = Math.max(furthest, r.right);
      }
      return {
        inside: Math.round(furthest - edge),
        viewport: Math.round(
          edge - el.ownerDocument.documentElement.clientWidth,
        ),
      };
    },
  );
}

test.describe("camp lead — a member's profile at 360", () => {
  test.beforeEach(() => {
    test.skip(
      test.info().project.name !== "mobile-360",
      "the overflow only exists at the 360 baseline; desktop has room",
    );
  });

  test("the widest username stays inside every card", async ({
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const leadName = widestUsername();
    const memberName = widestUsername();

    await signUpBurner(leadPage, { onboard: true, username: leadName });
    const camp = await createCamp(leadPage);
    await signUpBurner(memberPage, { onboard: true, username: memberName });
    const invite = await inviteToCamp(leadPage, camp.slug, "member");
    await joinByInvite(memberPage, invite.url);

    // The member's profile, reached from the roster like a lead would.
    await leadPage.goto(`/camps/${camp.slug}/roster`);
    await expect(
      leadPage.getByRole("heading", { name: "Roster" }),
    ).toBeVisible();
    const link = leadPage
      .getByRole("link", { name: memberName })
      .filter({ visible: true })
      .first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href, "no profile link on the roster").toMatch(/\/burners\//);
    await leadPage.goto(href ?? "");

    // Something PRESENT first: the heading, the Block action and the notes card.
    const heading = leadPage.getByRole("heading", {
      name: memberName,
      exact: true,
    });
    await expect(heading).toBeVisible();
    await expect(
      leadPage.getByRole("button", { name: `Block ${memberName}` }),
    ).toBeVisible();
    const notes = leadPage.getByTestId("private-notes");
    await expect(notes).toBeVisible();
    await expect(
      notes.getByRole("button", { name: "Export notes about this member" }),
    ).toBeVisible();

    const cards: Array<[string, Locator]> = [
      ["profile header", leadPage.locator("header").filter({ has: heading })],
      ["participation", leadPage.getByTestId("member-participation")],
      ["private notes", notes],
    ];
    const expectEverythingInside = async (): Promise<void> => {
      for (const [name, card] of cards) {
        await expect(card).toBeVisible();
        const { inside, viewport } = await overflowOf(card);
        expect(
          inside,
          `${name}: content runs past the card`,
        ).toBeLessThanOrEqual(1);
        expect(
          viewport,
          `${name}: card runs past the screen`,
        ).toBeLessThanOrEqual(1);
      }
      // …and the page as a whole: any horizontal overflow makes the browser
      // zoom out, which is the symptom a person actually sees.
      const pageOverflow = await leadPage
        .locator("html")
        .evaluate((html: { scrollWidth: number; clientWidth: number }) =>
          Math.round(html.scrollWidth - html.clientWidth),
        );
      expect(
        pageOverflow,
        "the page is horizontally scrollable",
      ).toBeLessThanOrEqual(1);
    };

    // Measured BEFORE anything is clicked: a zoomed-out page also makes the
    // notes form hard to click (the overflow is why, and this says so).
    await expectEverythingInside();

    // A note, so the author line (the lead's own wide name) renders too.
    const field = notes.getByLabel("Add a note");
    const add = notes.getByRole("button", { name: "Add note" });
    await expect(async () => {
      await field.fill("");
      await field.fill("Arrives on the Tuesday of build week");
      await expect(add).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await add.click();
    await expect(notes.getByTestId("private-note")).toContainText(leadName);
    await expectEverythingInside();
  });
});
