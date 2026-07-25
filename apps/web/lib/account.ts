import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import {
  AUTH_CAPABILITIES,
  assessDeletionEligibility,
  deletionDaysRemaining,
  deletionPhase,
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

import { auth } from "@/lib/neon-auth";
import { db, schema } from "@/lib/db";
import { isAuthConfigured, isDatabaseConfigured } from "@/lib/config";

// Read side of the account surfaces (/account, /account/security,
// /account/delete) — docs/accounts-security-spec.md.
//
// PROVIDER REALITY (probed 25 Jul 2026, @neondatabase/auth 0.4.1-beta): we run
// MANAGED Neon Auth, which does not permit Better Auth server plugins. Session
// listing/revocation, password change/reset, email verification, linked-account
// listing and delete-user ARE in the server SDK's endpoint allowlist. 2FA/TOTP,
// backup codes and passkeys are NOT — no plugin, no endpoints, nothing to call.
// `AUTH_CAPABILITIES` in @quagga/core is the authority; the /account/security
// surface reads it and renders an honest unavailable state rather than a control
// that does nothing.
//
// Every read here degrades gracefully: env-less or provider-down returns an
// empty/unknown state, never a throw, so the account pages still render.

// --- Capabilities ---------------------------------------------------------

/** The capability matrix, for the surfaces to render honestly. */
export function accountCapabilities(): AuthCapability[] {
  return Object.values(AUTH_CAPABILITIES);
}

// --- Sessions -------------------------------------------------------------

/** One active session as the security page shows it. */
export interface AccountSession {
  id: string;
  token: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  expiresAt: Date | null;
  /** Raw user-agent from the provider; humanised for display. */
  userAgent: string | null;
  ipAddress: string | null;
  /** True for the session making this request. */
  current: boolean;
}

type ProviderSession = {
  id?: string | null;
  token?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  userAgent?: string | null;
  ipAddress?: string | null;
};

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The account's active sessions, newest first. Backed by the provider's
 * `list-sessions` endpoint (a SUPPORTED capability).
 *
 * Returns [] rather than throwing when auth is unconfigured or the provider call
 * fails — an unreachable provider must degrade the security page, not break it.
 */
export async function listAccountSessions(): Promise<AccountSession[]> {
  if (!isAuthConfigured()) return [];
  try {
    const [{ data: sessions }, { data: current }] = await Promise.all([
      auth.listSessions(),
      auth.getSession(),
    ]);
    const rows = (sessions ?? []) as ProviderSession[];
    const currentToken =
      (current as { session?: { token?: string | null } } | null)?.session
        ?.token ?? null;

    return rows
      .map((s) => ({
        id: s.id ?? s.token ?? "",
        token: s.token ?? "",
        createdAt: toDate(s.createdAt),
        updatedAt: toDate(s.updatedAt),
        expiresAt: toDate(s.expiresAt),
        userAgent: s.userAgent ?? null,
        ipAddress: s.ipAddress ?? null,
        current: Boolean(currentToken) && s.token === currentToken,
      }))
      .filter((s) => s.token !== "")
      .sort(
        (a, b) =>
          (b.updatedAt?.getTime() ?? b.createdAt?.getTime() ?? 0) -
          (a.updatedAt?.getTime() ?? a.createdAt?.getTime() ?? 0),
      );
  } catch {
    return [];
  }
}

/**
 * A short device label from a user-agent string. Deliberately coarse — the point
 * is "is this me?", and a full UA string in a security list is noise a burner
 * cannot act on.
 */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent.toLowerCase();
  const os = ua.includes("android")
    ? "Android"
    : ua.includes("iphone") || ua.includes("ipad")
      ? "iOS"
      : ua.includes("mac os")
        ? "macOS"
        : ua.includes("windows")
          ? "Windows"
          : ua.includes("linux")
            ? "Linux"
            : "Unknown OS";
  // Order matters: Edge and Chrome both claim Safari, Chrome claims Safari.
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("firefox")
      ? "Firefox"
      : ua.includes("chrome")
        ? "Chrome"
        : ua.includes("safari")
          ? "Safari"
          : "browser";
  return `${browser} on ${os}`;
}

// --- Linked sign-in methods ----------------------------------------------

export interface LinkedAccount {
  id: string;
  providerId: string;
  createdAt: Date | null;
}

/**
 * The account's linked sign-in methods (password counts as the `credential`
 * provider). Powers both the /account list and the last-method guard.
 */
export async function listLinkedAccounts(): Promise<LinkedAccount[]> {
  if (!isAuthConfigured()) return [];
  try {
    const { data } = await auth.listAccounts();
    const rows = (data ?? []) as {
      id?: string | null;
      providerId?: string | null;
      provider?: string | null;
      createdAt?: string | Date | null;
    }[];
    return rows
      .map((a) => ({
        id: a.id ?? "",
        providerId: a.providerId ?? a.provider ?? "unknown",
        createdAt: toDate(a.createdAt),
      }))
      .filter((a) => a.id !== "");
  } catch {
    return [];
  }
}

/** Human labels for the provider ids the app can actually issue. */
const SIGN_IN_METHOD_LABELS: Record<string, string> = {
  credential: "Email",
  google: "Google",
};

/**
 * Human-readable sign-in method(s) for a set of linked accounts, in a stable
 * order (Email, then Google, then anything else), de-duplicated. Returns null
 * when nothing determinable is linked so callers can render an honest fallback
 * ("Not available") rather than a wrong literal. Single source of truth for the
 * /profile Account card and any other surface that names the sign-in method.
 */
export function describeSignInMethods(accounts: LinkedAccount[]): string | null {
  const labels: string[] = [];
  for (const a of accounts) {
    const known = SIGN_IN_METHOD_LABELS[a.providerId];
    if (known) {
      labels.push(known);
    } else if (a.providerId && a.providerId !== "unknown") {
      labels.push(a.providerId.charAt(0).toUpperCase() + a.providerId.slice(1));
    }
  }
  const unique = [...new Set(labels)];
  if (unique.length === 0) return null;
  const order = ["Email", "Google"];
  const rank = (label: string) => {
    const i = order.indexOf(label);
    return i === -1 ? order.length : i;
  };
  unique.sort((a, b) => rank(a) - rank(b));
  return unique.join(", ");
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
  // number of leads on each — a leadCount of 1 means they are the only one.
  const leadRows = await handle
    .select({
      groupId: schema.groups.id,
      name: schema.groups.name,
      leadCount: sql<number>`(
        select count(*)::int from ${schema.memberships} m2
        where m2.group_id = ${schema.groups.id} and m2.role = 'lead'
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

    const [{ count } = { count: 0 }] = await handle
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.groupId, orgGroup.id),
          eq(schema.memberships.role, "god"),
        ),
      );
    orgGodCount = Number(count);
  }

  const signInMethodCount = (await listLinkedAccounts()).length;

  return { ledProjects, isOrgGod, orgGodCount, signInMethodCount };
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
