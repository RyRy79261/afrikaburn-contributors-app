import "server-only";

import { cookies, headers } from "next/headers";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  AUTH_CAPABILITIES,
  assessDeletionEligibility,
  deletionDaysRemaining,
  deletionPhase,
  deriveOnboardingProgress,
  emailChangePhase,
  type AuthCapability,
  type DeletionEligibility,
  type DeletionGuardContext,
  type DeletionPhase,
  type DeletionRequestState,
  type EmailChangePhase,
  type EmailChangeState,
  type LedProject,
} from "@quagga/core";

import {
  listAccountPasskeys as sharedListAccountPasskeys,
  listAccountSessions as sharedListAccountSessions,
  listLinkedAccounts as sharedListLinkedAccounts,
  parseSetCookies,
  type AccountPasskey as SharedAccountPasskey,
  type AccountSession as SharedAccountSession,
  type LinkedAccount as SharedLinkedAccount,
} from "@quagga/auth/account";
import { db, schema } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/config";

// Read side of the account surfaces (/account, /account/security,
// /account/delete) — docs/accounts-security-spec.md.
//
// PROVIDER REALITY (self-hosted Better Auth via @quagga/auth): we now run our
// OWN Better Auth in-process, so the server API `auth.api.*` exposes the full
// surface — session listing/revocation, password change/reset, email
// verification, linked-account listing, change-email, unlink and delete-user are
// all real server calls. 2FA/TOTP, backup codes and passkeys remain unavailable
// only because their PLUGINS are not yet installed (a scheduled task), not
// because a provider forbids them. `AUTH_CAPABILITIES` in @quagga/core is the
// authority; the /account/security surface reads it and renders an honest
// unavailable state rather than a control that does nothing.
//
// The self-hosted server API takes `{ headers }` and RETURNS data directly
// (throwing on failure), unlike the old client-shaped `{ data, error }`. Every
// read here degrades gracefully: env-less or an error returns an empty/unknown
// state, never a throw, so the account pages still render.

// --- Capabilities ---------------------------------------------------------

/** The capability matrix, for the surfaces to render honestly. */
export function accountCapabilities(): AuthCapability[] {
  return Object.values(AUTH_CAPABILITIES);
}

// --- Sessions, passkeys, sign-in methods ----------------------------------
//
// EXTRACTED to @quagga/auth/account (roadmap M4-21) now that the org console and
// the supplier portal mount the same suite. These are questions about one Better
// Auth identity and nothing about a burner, so three copies would have been
// three chances for one app's security page to drift into telling a different
// story about the same account.
//
// Re-exported under their original names, and wrapped where the shared version
// takes the request `headers` explicitly (@quagga/auth deliberately does not
// import `next/headers` — it is called from scripts that have no request).

export {
  deviceLabel,
  describeSignInMethods,
  getTwoFactorEnabled,
  type AccountSession,
  type AccountPasskey,
  type LinkedAccount,
} from "@quagga/auth/account";

/** This request's active sessions, newest first, with this device flagged. */
export async function listAccountSessions(): Promise<SharedAccountSession[]> {
  return sharedListAccountSessions(await headers());
}

/** This request's registered passkeys. */
export async function listAccountPasskeys(): Promise<SharedAccountPasskey[]> {
  return sharedListAccountPasskeys(await headers());
}

/**
 * This request's linked sign-in methods (a password counts as the `credential`
 * provider). Powers both the /account list and the last-method guard.
 */
export async function listLinkedAccounts(): Promise<SharedLinkedAccount[]> {
  return sharedListLinkedAccounts(await headers());
}

// --- Deletion state -------------------------------------------------------

/** The live deletion request for a user, or null. */
export async function getDeletionRequest(
  userId: string,
): Promise<(DeletionRequestState & { id: string }) | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const [row] = await db()
      .select({
        id: schema.accountDeletionRequests.id,
        status: schema.accountDeletionRequests.status,
        requestedAt: schema.accountDeletionRequests.requestedAt,
        graceEndsAt: schema.accountDeletionRequests.graceEndsAt,
        cancelledAt: schema.accountDeletionRequests.cancelledAt,
        completedAt: schema.accountDeletionRequests.completedAt,
      })
      .from(schema.accountDeletionRequests)
      .where(
        and(
          eq(schema.accountDeletionRequests.userId, userId),
          eq(schema.accountDeletionRequests.status, "pending"),
        ),
      )
      .orderBy(desc(schema.accountDeletionRequests.requestedAt))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

export interface DeletionView {
  phase: DeletionPhase;
  daysRemaining: number;
  eligibility: DeletionEligibility;
}

/**
 * Assemble the deletion guard context from the database, then evaluate it in
 * core. The three guards (sole camp lead, sole org god, last sign-in method) are
 * decided by @quagga/core `assessDeletionEligibility` — this function's only job
 * is to count things accurately.
 */
export async function buildDeletionGuardContext(
  userId: string,
): Promise<DeletionGuardContext> {
  const empty: DeletionGuardContext = {
    ledProjects: [],
    isOrgGod: false,
    orgGodCount: 0,
    signInMethodCount: 0,
  };
  if (!isDatabaseConfigured()) return empty;

  const handle = db();

  // Projects where this user holds the structural `lead` role, with the total
  // number of LIVE leads on each — a leadCount of 1 means they are the only one.
  //
  // THE JOIN TO `users` AND THE `sanitized_at` FILTER ARE THE GUARD.
  // Sanitization deliberately PRESERVES memberships (account-sanitization.ts:
  // "no delete of memberships") so the camp's history stays intact — which means
  // a departed lead's row is still `role = 'lead'` and still counted. Without
  // this filter a camp whose only other lead is a tombstone reported
  // `leadCount = 2`, the sole-lead block never fired, and the last LIVE lead
  // walked out of a camp that then had nobody who could administer it.
  const leadRows = await handle
    .select({
      groupId: schema.groups.id,
      name: schema.groups.name,
      leadCount: sql<number>`(
        select count(*)::int from ${schema.memberships} m2
        join ${schema.users} u2 on u2.id = m2.user_id
        where m2.group_id = ${schema.groups.id}
          and m2.role = 'lead'
          and u2.sanitized_at is null
      )`,
    })
    .from(schema.memberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.role, "lead"),
      ),
    );

  const ledProjects: LedProject[] = leadRows.map((r) => ({
    groupId: r.groupId,
    name: r.name,
    leadCount: Number(r.leadCount),
  }));

  // God is only meaningful on the seeded org group.
  const [orgGroup] = await handle
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.kind, "org"))
    .limit(1);

  let isOrgGod = false;
  let orgGodCount = 0;
  let mineRole: string | null = null;
  if (orgGroup) {
    const [mine] = await handle
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, userId),
          eq(schema.memberships.groupId, orgGroup.id),
        ),
      )
      .limit(1);
    isOrgGod = mine?.role === "god";
    mineRole = mine?.role ?? null;

    // LIVE System managers only, for the same reason as the lead count above —
    // and this one strands the whole deployment rather than one camp.
    //
    // Measured on the real query: gods A and B, A deletes (count 2, allowed),
    // A is sanitized but A's `god` membership row survives, so the count is
    // STILL 2 and B is allowed too. Zero live System managers, guard reporting
    // two, and no screen can recover it — apps/org/lib/actions/accounts.ts
    // deliberately forbids the console from ever granting `god`, so the way back
    // is an env change to GOD_EMAILS plus a fresh sign-up.
    //
    // `bootstrapGod` makes it worse over time: a deleted god still listed in
    // GOD_EMAILS gets a NEW users row and a NEW god membership on their next
    // sign-in while the tombstone's membership stays, so every cycle inflated
    // the count by one and made the guard progressively more permissive.
    const [{ count } = { count: 0 }] = await handle
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
    orgGodCount = Number(count);
  }

  // ORG ACCESS THIS ACCOUNT HOLDS. `org_staff` and `engineer` had no guard and
  // no warning at all: the rank was invisible to `assessDeletionEligibility`,
  // which only ever knew about `god`. So a staffer could self-delete through the
  // participant app, their org membership and every `org_role_assignments` row
  // survived on the tombstone, and the console kept a live access grant pointing
  // at a dead account. Not a block — nobody is stranded by it — but they are
  // told, and sanitization now revokes it (account-sanitize.ts).
  const orgRole =
    orgGroup && mineRole && mineRole !== "member" ? mineRole : null;

  // SUPPLIER ONBOARDING, at last. `hasInFlightSupplierOnboarding` has been
  // declared in @quagga/core and checked by `assessDeletionEligibility` since
  // the field was written, and NOTHING has ever set it — so the "Worth knowing"
  // card never rendered and a supplier mid-onboarding was told nothing. The
  // warning text was already written; only the value was missing.
  let hasInFlightSupplierOnboarding = false;
  let claimedSupplierName: string | null = null;
  const [supplier] = await handle
    .select({ id: schema.suppliers.id, name: schema.suppliers.name })
    .from(schema.suppliers)
    .where(eq(schema.suppliers.userId, userId))
    .limit(1);
  if (supplier) {
    claimedSupplierName = supplier.name;
    // Onboarding is PER EDITION, so "in flight" means the ACTIVE edition's
    // checklist is started-but-not-finished. A supplier with no row for this
    // edition has not begun, which is not something to warn about mid-deletion.
    const [onboarding] = await handle
      .select({ steps: schema.supplierOnboarding.steps })
      .from(schema.supplierOnboarding)
      .innerJoin(
        schema.editions,
        eq(schema.editions.id, schema.supplierOnboarding.editionId),
      )
      .where(
        and(
          eq(schema.supplierOnboarding.supplierId, supplier.id),
          eq(schema.editions.isActive, true),
        ),
      )
      .limit(1);
    if (onboarding) {
      const progress = deriveOnboardingProgress(onboarding.steps);
      // STARTED but not finished. A supplier who has touched nothing is not
      // "in flight" — warning them mid-deletion about a checklist they never
      // began is noise, and this warning has to mean something to survive.
      hasInFlightSupplierOnboarding =
        !progress.isOnboarded && progress.completed + progress.awaiting > 0;
    }
  }

  const signInMethodCount = (await listLinkedAccounts()).length;

  return {
    ledProjects,
    isOrgGod,
    orgGodCount,
    signInMethodCount,
    hasInFlightSupplierOnboarding,
    orgRole,
    claimedSupplierName,
  };
}

/** The full /account/delete view model. */
export async function buildDeletionView(
  userId: string,
  now: Date = new Date(),
): Promise<DeletionView> {
  const request = await getDeletionRequest(userId);
  const ctx = await buildDeletionGuardContext(userId);
  return {
    phase: deletionPhase(request, now),
    daysRemaining: deletionDaysRemaining(request, now),
    eligibility: assessDeletionEligibility(ctx),
  };
}

// --- Email change state ---------------------------------------------------

export interface EmailChangeView {
  phase: EmailChangePhase;
  newEmail: string | null;
  /** Whether the provider actually applied the change (see core `isEmailChangeEffective`). */
  providerApplied: boolean;
}

/** The live email-change request for a user, or null. */
export async function getEmailChangeRequest(
  userId: string,
): Promise<(EmailChangeState & { id: string; newEmail: string }) | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const [row] = await db()
      .select({
        id: schema.emailChangeRequests.id,
        newEmail: schema.emailChangeRequests.newEmail,
        status: schema.emailChangeRequests.status,
        expiresAt: schema.emailChangeRequests.expiresAt,
        confirmedAt: schema.emailChangeRequests.confirmedAt,
        revocableUntil: schema.emailChangeRequests.revocableUntil,
        revokedAt: schema.emailChangeRequests.revokedAt,
        providerCommittedAt: schema.emailChangeRequests.providerCommittedAt,
      })
      .from(schema.emailChangeRequests)
      .where(eq(schema.emailChangeRequests.userId, userId))
      .orderBy(desc(schema.emailChangeRequests.createdAt))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

/** The /account email-change view model. */
export async function buildEmailChangeView(
  userId: string,
  now: Date = new Date(),
): Promise<EmailChangeView> {
  const request = await getEmailChangeRequest(userId);
  return {
    phase: emailChangePhase(request, now),
    newEmail: request?.newEmail ?? null,
    providerApplied: request?.providerCommittedAt != null,
  };
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
