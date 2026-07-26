import "server-only";

import { cookies } from "next/headers";
import {
  PENDING_INVITE_COOKIE,
  PENDING_INVITE_MAX_AGE_SECONDS,
  isWellFormedInviteToken,
} from "@quagga/core";

// The pending-invite cookie: how an invite survives sign-up / sign-in and the
// Burner-Bio gate without the token ever entering a url. The rationale for a
// cookie over a callbackURL lives on PENDING_INVITE_COOKIE in @quagga/core.
//
// WRITES ARE ACTION-ONLY. `cookies().set()` throws in a Server Component render,
// so `setPendingInvite`/`clearPendingInvite` may only be called from a Server
// Action or a Route Handler; `readPendingInvite` is safe anywhere.

/**
 * Remember the invite a visitor just accepted, for the auth round trip.
 * httpOnly (no script can read it), SameSite=Lax (survives the top-level GET
 * return from Google's OAuth callback or an emailed verification link, which
 * Strict would drop), Secure in production, and short-lived.
 */
export async function setPendingInvite(token: string): Promise<void> {
  if (!isWellFormedInviteToken(token)) return;
  const jar = await cookies();
  jar.set(PENDING_INVITE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PENDING_INVITE_MAX_AGE_SECONDS,
  });
}

/**
 * The pending invite token, or null. Validated against the token grammar, so a
 * hand-crafted cookie can never smuggle a path, query or scheme into the flow.
 */
export async function readPendingInvite(): Promise<string | null> {
  const value = (await cookies()).get(PENDING_INVITE_COOKIE)?.value;
  return isWellFormedInviteToken(value) ? value : null;
}

/**
 * Drop the pending invite (consumed, or abandoned). Action/handler only.
 *
 * Pass `token` to make it CONDITIONAL: only a cookie holding that exact token is
 * dropped. Someone can have invite A mid-round-trip and then open a dead link B;
 * clearing unconditionally there would throw away the invite they are actually
 * in the middle of accepting.
 */
export async function clearPendingInvite(token?: string): Promise<void> {
  if (token !== undefined && (await readPendingInvite()) !== token) return;
  (await cookies()).delete(PENDING_INVITE_COOKIE);
}
