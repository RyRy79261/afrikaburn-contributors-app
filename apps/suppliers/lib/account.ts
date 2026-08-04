import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import {
  listAccountPasskeys as sharedListAccountPasskeys,
  listAccountSessions as sharedListAccountSessions,
  listLinkedAccounts as sharedListLinkedAccounts,
  parseSetCookies,
  resolveAccountUser,
  type AccountPasskey,
  type AccountSession,
  type AccountUser,
  type LinkedAccount,
} from "@quagga/auth/account";

import { getAuthenticatedUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

// The portal's account surface (roadmap M4-21) — everything a supplier needs to
// look after their OWN sign-in, as opposed to their business's onboarding.
//
// THE GUARD HERE IS NOT `resolveSupplierSession`, AND THAT IS THE POINT.
//
// The portal gate asks a question about a BUSINESS: has this email claimed a
// supplier listing? It is the right question for onboarding, documents and
// standing — and the wrong one for a password. Somebody who signed up, was never
// matched to a listing, and is sitting on the "register your business" screen
// still has an account, a session and possibly a stolen one. `unlinked` is a
// perfectly ordinary state in this app, and it must not mean "you may not secure
// your account".
//
// So the only requirement is a live signed-in identity. Everything reachable
// from here is scoped to it by Better Auth itself.

export type { AccountPasskey, AccountSession, AccountUser, LinkedAccount };

/**
 * The signed-in account behind this request, or null. `cache()`d for the life of
 * ONE request — the layout resolves it for the chrome and each page resolves it
 * again to re-guard before reading, which is correct and should not be two
 * round trips.
 */
export const resolvePortalAccount = cache(
  async function resolvePortalAccount(): Promise<AccountUser | null> {
    const user = await getAuthenticatedUser();
    if (!user) return null;
    return resolveAccountUser(user.id, user.primaryEmail);
  },
);

/** For server actions: resolve and require the signed-in account. */
export async function requirePortalAccount(): Promise<AccountUser> {
  const account = await resolvePortalAccount();
  if (!account) {
    throw new Error("Sign in to manage your account.");
  }
  return account;
}

/** This request's active sessions, newest first, with this device flagged. */
export async function listAccountSessions(): Promise<AccountSession[]> {
  return sharedListAccountSessions(await headers());
}

/** This request's registered passkeys. */
export async function listAccountPasskeys(): Promise<AccountPasskey[]> {
  return sharedListAccountPasskeys(await headers());
}

/** This request's linked sign-in methods (a password is the `credential` one). */
export async function listLinkedAccounts(): Promise<LinkedAccount[]> {
  return sharedListLinkedAccounts(await headers());
}

/**
 * The supplier listing this account has CLAIMED, if any — for the Delete tab to
 * state what deletion releases before somebody walks to another app to confirm.
 *
 * Deletion nulls `suppliers.user_id`; the business row itself survives, because
 * it is AfrikaBurn's record of a supplier rather than a person's personal data,
 * and deleting it would take the burn's own procurement history with it. The
 * consequence worth stating is therefore not "your business is deleted" — it is
 * that the listing goes back to unclaimed, and the next person whose verified
 * email matches its contact details can claim it.
 */
export async function getClaimedSupplier(
  userId: string,
): Promise<{ id: string; name: string; contact: string | null } | null> {
  try {
    const [row] = await getDb()
      .select({
        id: schema.suppliers.id,
        name: schema.suppliers.name,
        contact: schema.suppliers.contact,
      })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.userId, userId))
      .limit(1);
    return row ?? null;
  } catch {
    // A failed read must degrade the disclosure, never break the page.
    return null;
  }
}

/**
 * Hand Better Auth's response cookies back to the browser.
 *
 * Calling `auth.api.*` from a server action bypasses the `/api/auth/*` route
 * handler, so the headers Better Auth wants to send back are returned to US and
 * then dropped. For a read that is harmless; for `changePassword` — which
 * deletes every session including the caller's and issues a fresh one — it means
 * the browser keeps a cookie naming a row that no longer exists, survives only
 * as long as the 5-minute session cookie cache, and is then signed out with no
 * explanation. See `parseSetCookies` in @quagga/auth/account for the measurement.
 *
 * Best-effort by design: the password HAS already changed by the time this runs,
 * so a failure here must not turn a successful change into a reported failure.
 * The worst case without it is the pre-existing behaviour.
 */
export async function applyAuthCookies(
  responseHeaders: Headers,
): Promise<void> {
  try {
    const store = await cookies();
    for (const c of parseSetCookies(responseHeaders)) {
      store.set(c.name, c.value, c.options);
    }
  } catch {
    // Cookies are read-only in some server contexts; never fail the action.
  }
}
