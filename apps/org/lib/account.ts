import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
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

import { and, eq, isNull, sql } from "drizzle-orm";

import { getAuthenticatedUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

// The console's account surface (roadmap M4-21) — everything a staff member
// needs to look after their OWN sign-in, as opposed to the console's work.
//
// THE GUARD HERE IS NOT `resolveOrgSession`, AND THAT IS THE POINT.
//
// Every other page in this app goes through the console gate, correctly: they
// show AfrikaBurn's business and only staff may see it. These pages show the
// staff member their own password, their own devices, their own passkeys — and
// gating those on holding a console role would mean an organiser whose role was
// revoked this morning can no longer sign out the laptop they left at the burn.
// The account outlives the role, so the account surface must too.
//
// It is not a hole. `resolveAccountUser` still refuses anyone without a live
// signed-in identity, and everything reachable from here is scoped to that
// identity by Better Auth itself — a session token from another account cannot
// be revoked through this one. What has been dropped is the ORG check, which was
// never what protected any of this.
//
// It is also why these routes sit in their own route group: the `(console)`
// layout turns a pending blocking questionnaire into a hard gate over the whole
// console, and a staff member who cannot get past a questionnaire is exactly
// someone who might need to change their password. That reversal is deliberate.

export type { AccountPasskey, AccountSession, AccountUser, LinkedAccount };

/**
 * The signed-in account behind this request, or null.
 *
 * `cache()`d for the life of ONE request: the account layout resolves it to draw
 * the chrome and each page resolves it again to re-guard before reading, which
 * is correct — UI hiding is never the boundary — and would otherwise be the same
 * upsert and lookup twice per page view.
 */
export const resolveConsoleAccount = cache(
  async function resolveConsoleAccount(): Promise<AccountUser | null> {
    const user = await getAuthenticatedUser();
    if (!user) return null;
    return resolveAccountUser(user.id, user.primaryEmail);
  },
);

/**
 * For server actions: resolve and require the signed-in account. Throws a
 * caller-safe Error otherwise (actions catch it and surface the message).
 * Nothing here trusts a client-supplied id.
 */
export async function requireConsoleAccount(): Promise<AccountUser> {
  const account = await resolveConsoleAccount();
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
 * What deleting this account would cost the ORG — the facts only this app knows,
 * for the Delete tab to state before it hands over to the participant app.
 *
 * Deletion itself is assessed and performed there, against the full picture
 * (camps led, registrations, supplier listings, this). Nothing here is a guard;
 * duplicating one would be duplicating the chance of getting it wrong. It is a
 * disclosure, so that somebody does not walk to another app, confirm a deletion,
 * and only afterwards discover what the console lost.
 */
export interface OrgAccountHoldings {
  /** The membership rank on the org group, or null for none/plain member. */
  rank: string | null;
  /** How many named org roles hang off this membership. */
  roleCount: number;
  /** True when this account is a System manager. */
  isSystemManager: boolean;
  /**
   * How many LIVE System managers the deployment has — tombstones excluded.
   *
   * The exclusion is the whole point and is not defensive coding: a sanitized
   * account keeps its `god` membership row, so counting memberships alone once
   * let the last two System managers delete each other while the count still
   * read two. That strands the deployment with no way back through any screen,
   * because the console deliberately refuses to grant `god`.
   */
  liveSystemManagers: number;
}

export async function getOrgAccountHoldings(
  userId: string,
): Promise<OrgAccountHoldings> {
  const empty: OrgAccountHoldings = {
    rank: null,
    roleCount: 0,
    isSystemManager: false,
    liveSystemManagers: 0,
  };
  try {
    const db = getDb();
    const [orgGroup] = await db
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(eq(schema.groups.kind, "org"))
      .limit(1);
    if (!orgGroup) return empty;

    const [membership] = await db
      .select({ id: schema.memberships.id, role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, userId),
          eq(schema.memberships.groupId, orgGroup.id),
        ),
      )
      .limit(1);

    const [{ count: gods } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(
        and(
          eq(schema.memberships.groupId, orgGroup.id),
          eq(schema.memberships.role, "god"),
          isNull(schema.users.sanitizedAt),
        ),
      );

    let roleCount = 0;
    if (membership) {
      const [{ count } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.orgRoleAssignments)
        .where(eq(schema.orgRoleAssignments.membershipId, membership.id));
      roleCount = Number(count);
    }

    const rank =
      membership && membership.role !== "member" ? membership.role : null;
    return {
      rank,
      roleCount,
      isSystemManager: membership?.role === "god",
      liveSystemManagers: Number(gods),
    };
  } catch {
    // A failed read must degrade the disclosure, never break the page — and
    // `empty` understates rather than overstates, so nothing is claimed that
    // was not read.
    return empty;
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
export async function applyAuthCookies(responseHeaders: Headers): Promise<void> {
  try {
    const store = await cookies();
    for (const c of parseSetCookies(responseHeaders)) {
      store.set(c.name, c.value, c.options);
    }
  } catch {
    // Cookies are read-only in some server contexts; never fail the action.
  }
}
