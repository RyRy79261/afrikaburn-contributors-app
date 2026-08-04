// specs/anon/signed-out-invite-acceptance.spec.ts — the flow an invite link
// exists for.
//
// An invite is sent to someone who DOES NOT HAVE AN ACCOUNT YET. So
// `/join/[token]` is a signed-out-first surface (design frames qhcHh + MttcT):
// a stranger holding the link sees which camp is inviting them, who invited
// them, whether that camp is registered and when the link dies — and the Join
// call-to-action carries them through account creation and completes the join
// on the far side.
//
// (This file replaces the old `invite-link-gating.spec.ts`, which asserted the
// DEFECT: the route used to redirect an anon to sign-in before previewing the
// invite, so the person the link was minted for could never see or accept it.)
//
// The two halves of the law this suite pins:
//   1. A LIVE token buys exactly one thing — that camp's public identity —
//      and then works: sign up, clear the Burner Bio gate, land on the camp.
//   2. A DEAD token (used, expired, revoked) or a bogus one buys NOTHING: no
//      camp name, no inviter, no action. That is what keeps a free camp
//      undiscoverable through a spent link.

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  acceptInviteAsNewBurner,
} from "../../personas/factories";
import { uniqueUsername } from "../../lib/identity";

test.describe("anonymous visitor — signed-out invite acceptance", () => {
  test("a signed-out invitee sees the invite, signs up, and lands on the camp as a member", async ({
    webPage, // the lead
    makeAppPage,
  }) => {
    const leadName = uniqueUsername("lead_alice");
    await signUpBurner(webPage, { onboard: true, username: leadName });
    const camp = await createCamp(webPage, {
      description: "A tea-fuelled village of makers on the Binnekring edge.",
      // Invite-only (free) — the invite is the ONLY way in, and the only thing
      // that may reveal this camp to a stranger.
      joinability: "invite_only",
    });
    const invite = await inviteToCamp(webPage, camp.slug, "member");

    // A stranger with NO session opens the link.
    const invitee = await makeAppPage("web");
    await invitee.goto(`/join/${invite.token}`);

    // Not bounced to the auth wall — the invite renders, as the frame draws it.
    await expect(invitee).not.toHaveURL(/\/auth\/sign-in/);
    await expect(
      invitee.getByRole("heading", { name: camp.name }),
    ).toBeVisible();
    await expect(
      invitee.getByText(/you['’]ve been invited to join/i),
    ).toBeVisible();
    // The inviter IS named, because the card shows their USERNAME — a public
    // handle by construction (unique, no privacy toggle: @quagga/core
    // `username.ts`). There is no flag to consult any more; what the card must
    // never carry is a legal name or an email, and a lead with no username at
    // all simply gets no name line. Default
    // public, opt-out honoured.
    await expect(
      invitee.getByText(`${leadName} invited you to join.`),
    ).toBeVisible();
    await expect(invitee.getByText(/one-time invite/i)).toBeVisible();
    await expect(
      invitee.getByRole("button", {
        name: new RegExp(`join ${camp.name}`, "i"),
      }),
    ).toBeVisible();

    // Minimal signed-out chrome: "Sign in" is offered, the rest of the app's nav
    // is not (frame qhcHh's nav bar is brand + Sign in only).
    await expect(
      invitee.getByRole("link", { name: /^sign in$/i }),
    ).toBeVisible();
    await expect(
      invitee.getByRole("link", { name: /^create camp$/i }),
    ).toHaveCount(0);

    // The invite token is the authorisation to see the camp's IDENTITY — never
    // its people. The lead's name appears only as the inviter line above; the
    // roster ("Members (n)", the camp dashboard's own heading) never renders to
    // a stranger holding a link.
    await expect(invitee.getByText(/^members \(/i)).toHaveCount(0);

    // Accept → sign-up → Burner Bio gate → the camp, join completed for them.
    const inviteeName = uniqueUsername("invitee_ren");
    const { slug } = await acceptInviteAsNewBurner(invitee, invite.token, {
      username: inviteeName,
    });
    expect(slug).toBe(camp.slug);
    await expect(
      invitee.getByRole("heading", { name: camp.name }),
    ).toBeVisible();

    // The membership really wrote: the lead's roster now lists the new burner.
    await webPage.goto(`/camps/${camp.slug}`);
    await expect(webPage.getByText(inviteeName).first()).toBeVisible();
  });

  test("the token never appears in a url after the invite page — it rides an httpOnly cookie", async ({
    webPage,
    makeAppPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);
    const invite = await inviteToCamp(webPage, camp.slug, "member");

    const invitee = await makeAppPage("web");
    const urls: string[] = [];
    invitee.on("framenavigated", (frame) => {
      if (frame === invitee.mainFrame()) urls.push(frame.url());
    });

    await invitee.goto(`/join/${invite.token}`);
    await invitee
      .getByRole("button", { name: /^join /i })
      .first()
      .click();
    await invitee.waitForURL(/\/auth\/sign-up/);

    // Everything AFTER the invite landing page is token-free: no `?token=`, no
    // callbackURL carrying it, nothing to leak via Referer, history or logs.
    const afterLanding = urls.filter(
      (u) => !u.includes(`/join/${invite.token}`),
    );
    for (const url of afterLanding) {
      expect(url, `${url} must not carry the invite token`).not.toContain(
        invite.token,
      );
    }
    // ...and the marker that IS carried is opaque.
    await expect(invitee).toHaveURL(/\/auth\/sign-up\?next=invite/);

    // What carries the token instead: an httpOnly, SameSite=Lax cookie. Lax (not
    // Strict) is required so the token survives the top-level GET return from
    // Google's OAuth callback or an emailed verification link.
    const jar = await invitee.context().cookies();
    const pending = jar.find((c) => c.name === "quagga.pending_invite");
    expect(pending?.value).toBe(invite.token);
    expect(pending?.httpOnly).toBe(true);
    expect(pending?.sameSite).toBe("Lax");
  });

  test("a SPENT link shows the used/expired card to a signed-out visitor and names no camp", async ({
    webPage,
    makeAppPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { joinability: "invite_only" });
    const invite = await inviteToCamp(webPage, camp.slug, "member");

    // Revoke it through the real UI — a revoked link is a spent link.
    await webPage.goto(`/camps/${camp.slug}`);
    await webPage
      .getByRole("button", { name: /revoke invite/i })
      .first()
      .click();
    await expect(
      webPage.locator("code", { hasText: invite.token }),
    ).toHaveCount(0);

    const anon = await makeAppPage("web");
    await anon.goto(`/join/${invite.token}`);
    await expect(
      anon.getByRole("heading", { name: /used or expired/i }),
    ).toBeVisible();
    // No action, and — the undiscoverability law — no camp identity at all.
    await expect(
      anon.getByRole("button", { name: /join|accept|redeem/i }),
    ).toHaveCount(0);
    await expect(anon.getByText(camp.name)).toHaveCount(0);
    await expect(anon.getByText(/invited you to join/i)).toHaveCount(0);
  });

  test("a bogus token shows 'invite not found' to a signed-out visitor", async ({
    makeAppPage,
  }) => {
    const anon = await makeAppPage("web");
    await anon.goto(`/join/not-a-real-token-${Date.now().toString(36)}`);
    await expect(
      anon.getByRole("heading", { name: /invite not found/i }),
    ).toBeVisible();
    await expect(
      anon.getByRole("button", { name: /join|accept|redeem/i }),
    ).toHaveCount(0);
  });

  test("a signed-out visitor can still reach sign-in from the invite page", async ({
    webPage,
    makeAppPage,
  }) => {
    // Someone who already HAS an account uses the nav rather than the CTA; the
    // invite is still waiting for them at the same link afterwards.
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);
    const invite = await inviteToCamp(webPage, camp.slug, "member");

    const anon = await makeAppPage("web");
    await anon.goto(`/join/${invite.token}`);
    await anon.getByRole("link", { name: /^sign in$/i }).click();
    await expect(anon).toHaveURL(/\/auth\/sign-in/);
    await expect(anon.getByLabel("Email", { exact: true })).toBeVisible();
  });
});
