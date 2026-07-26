// Invite LANDING-PAGE state resolution (design frames qhcHh + MttcT; the
// companion of ./invite, which owns redemption itself).
//
// The load-bearing product fact: an invite link is sent to someone who DOES NOT
// HAVE AN ACCOUNT YET — that is the entire point of an invite. So `/join/[token]`
// is a signed-out-FIRST surface. The unguessable token is the authorisation to
// see WHICH camp is inviting you (name, blurb, inviter, registered badge,
// expiry) and nothing more: no roster, no member list, no private field, and
// nothing at all once the link is spent.
//
// This module is the pure decision layer shared by three call sites — the page,
// its accept action, and the post-authentication resume endpoint — so they can
// never disagree about what a given invite row means:
//
//   1. `resolveInviteView` — which of the four drawn states renders (valid,
//      already-used, expired, not-found), whether the camp may be named in that
//      state, and what the primary call-to-action is allowed to DO.
//   2. The shape of the auth round trip — the pending-invite cookie's name and
//      TTL, the resume path, the opaque marker put on the auth URL, and the
//      token grammar that guards both the URL segment and the cookie value.
//
// It performs no I/O and knows nothing about cookies, requests or the DB;
// apps/web binds it to those. Keeping the round-trip constants HERE is what
// stops the page, the action and the resume route drifting apart.

import type { InviteKind } from "@quagga/types";
import { canRedeemInvite, canRedeemInviteAs, type InviteLike } from "./invite";

/** The four states `/join/[token]` draws, for every viewer. */
export type InviteViewStatus =
  | "valid"
  | "already_used"
  | "expired"
  | "not_found";

/**
 * What the primary call-to-action must do next.
 *
 *  - `authenticate` — signed-out viewer: carry the invite through sign-up /
 *    sign-in and complete the join on the far side.
 *  - `redeem` — signed-in non-member: claim the invite now.
 *  - `open_camp` — signed-in viewer who is already a member of this camp and is
 *    holding a plain `member` link: nothing to claim, just take them in.
 *  - `none` — spent, expired or unknown link: no action is offered at all.
 */
export type InviteCta = "authenticate" | "redeem" | "open_camp" | "none";

/** Who is looking. `isMember` is meaningless (and ignored) when signed out. */
export interface InviteViewer {
  signedIn: boolean;
  isMember?: boolean;
}

export interface InviteView {
  status: InviteViewStatus;
  cta: InviteCta;
  /**
   * Whether this state may name the camp. TRUE only for a live invite — a spent,
   * expired or unknown token buys a stranger no information about which camp it
   * pointed at, which also keeps a free camp undiscoverable through a dead link.
   */
  showCamp: boolean;
  /** The invite's kind, when there is an invite at all. */
  kind: InviteKind | null;
}

const NOT_FOUND: InviteView = {
  status: "not_found",
  cta: "none",
  showCamp: false,
  kind: null,
};

/**
 * Resolve what `/join/[token]` renders, for BOTH signed-out and signed-in
 * viewers. The spent/expired decision is deliberately viewer-INDEPENDENT: a dead
 * link looks the same to everyone, so nothing about the redemption state can be
 * probed by signing in or out. Only a LIVE invite branches on the viewer, and
 * only to choose which action is offered.
 */
export function resolveInviteView(
  invite: InviteLike | null,
  viewer: InviteViewer,
  now: Date = new Date(),
): InviteView {
  if (!invite) return NOT_FOUND;

  // Viewer-independent first: single-use beats expiry (./invite's rule).
  const live = canRedeemInvite(invite, now);
  if (!live.ok) {
    return {
      status: live.reason === "expired" ? "expired" : "already_used",
      cta: "none",
      showCamp: false,
      kind: invite.kind,
    };
  }

  if (!viewer.signedIn) {
    return {
      status: "valid",
      cta: "authenticate",
      showCamp: true,
      kind: invite.kind,
    };
  }

  const asViewer = canRedeemInviteAs(
    invite,
    { isMember: viewer.isMember === true },
    now,
  );
  return {
    status: "valid",
    // `self_member` is the only rejection left once the invite is known live:
    // they are already in, so the action is "open the camp", never a second join.
    cta: asViewer.reason === "self_member" ? "open_camp" : "redeem",
    showCamp: true,
    kind: invite.kind,
  };
}

// --- The authentication round trip ----------------------------------------

/**
 * Cookie that carries a pending invite across sign-up / sign-in.
 *
 * WHY A COOKIE AND NOT A `?token=` / callbackURL: the token is a bearer
 * credential — whoever holds it joins the camp. Kept in an httpOnly, SameSite=Lax,
 * short-lived cookie it appears in NO url, so it cannot leak through a `Referer`
 * header to a third party, an address bar over someone's shoulder, browser
 * history, a copied "share this page" link, or an access/analytics log — and
 * httpOnly puts it out of reach of any injected script. SameSite=Lax is the
 * deliberate choice over Strict: the return leg is a top-level GET navigation
 * from Google's OAuth callback or an emailed verification link, which Strict
 * would drop. If the cookie is ever missing (a different browser finished the
 * verification), the failure is graceful, never a dead end: the person is signed
 * in and re-opening the SAME invite link from their email now works.
 */
export const PENDING_INVITE_COOKIE = "quagga.pending_invite";

/** How long a pending invite survives the round trip (sign-up + Burner Bio). */
export const PENDING_INVITE_MAX_AGE_SECONDS = 60 * 60;

/** Where authentication (and any blocking gate) resumes the join. */
export const INVITE_RESUME_PATH = "/join/continue";

/** Query key + value put on the auth url. An OPAQUE marker — never the token. */
export const INVITE_AUTH_PARAM = "next";
export const INVITE_AUTH_MARKER = "invite";

// `randomBytes(18).toString("base64url")` — 24 base64url chars. The bounds are
// generous so a future token length change does not silently reject live links.
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Whether a value is a syntactically plausible invite token. Guards BOTH the url
 * segment and the cookie value before either reaches a query, so a hostile
 * cookie can never smuggle anything but token-shaped text into the flow.
 */
export function isWellFormedInviteToken(value: unknown): value is string {
  return typeof value === "string" && INVITE_TOKEN_PATTERN.test(value);
}

/** The canonical landing url for an invite. */
export function invitePath(token: string): string {
  return `/join/${encodeURIComponent(token)}`;
}

/**
 * The auth url to send an invited stranger to. Carries only the opaque marker,
 * so the auth screens know to resume the invite afterwards without the token
 * ever entering a url.
 */
export function authPathForInvite(mode: "sign-in" | "sign-up"): string {
  return `/auth/${mode}?${INVITE_AUTH_PARAM}=${INVITE_AUTH_MARKER}`;
}

/** True when an auth screen's query says "finish an invite after this". */
export function wantsInviteResume(value: unknown): boolean {
  return value === INVITE_AUTH_MARKER;
}

/** "expires today" / "expires in 1 day" / "expires in 6 days" (frame copy). */
export function inviteExpiryLabel(expiresAt: Date, now: Date = new Date()): string {
  const days = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
  if (days <= 0) return "expires today";
  if (days === 1) return "expires in 1 day";
  return `expires in ${days} days`;
}
