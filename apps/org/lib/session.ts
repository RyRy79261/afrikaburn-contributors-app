import "server-only";

import { and, eq } from "drizzle-orm";
import { ORG_APP_ROLES } from "@quagga/types";
import type { MembershipRole } from "@quagga/types";

import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getDb, schema } from "@/lib/db";
import { canBootstrapGodEmail } from "@/lib/god";
import { writeAuditEvent } from "@/lib/audit";

/** A staff member who has cleared the gate. */
export interface OrgSession {
  /** Neon Auth user. */
  user: AuthenticatedUser;
  /** Our `users.id` (the join row), used as the audit actor. */
  dbUserId: string;
  /** Org role — only `god` or `org_staff` reach this state. */
  role: Extract<MembershipRole, "god" | "org_staff">;
  /** The seeded org group's id. */
  orgGroupId: string;
}

/** All the ways the gate can resolve. Rendered by the console layout. */
export type OrgSessionState =
  | { kind: "unauthenticated" }
  | { kind: "not_ready"; user: AuthenticatedUser }
  | { kind: "forbidden"; user: AuthenticatedUser }
  | ({ kind: "ok" } & OrgSession);

/**
 * Resolve the current console session:
 *  - not signed in / auth unconfigured  → `unauthenticated`
 *  - signed in but DB or org seed absent → `not_ready`
 *  - signed in, no god/org_staff role    → `forbidden`
 *  - signed in with an org role          → `ok`
 *
 * Side effects (idempotent): ensures a `users` join row exists, and applies the
 * GOD_EMAILS bootstrap (grants `god` on the org group to listed emails). Never
 * throws — every failure degrades to `not_ready` so the console stays bootable.
 */
export async function resolveOrgSession(): Promise<OrgSessionState> {
  const user = await getAuthenticatedUser();
  if (!user) return { kind: "unauthenticated" };
  if (!isDatabaseConfigured()) return { kind: "not_ready", user };

  try {
    const db = getDb();

    // Ensure the users join row (idempotent; email kept in sync).
    await db
      .insert(schema.users)
      .values({ authUserId: user.id, email: user.primaryEmail })
      .onConflictDoUpdate({
        target: schema.users.authUserId,
        set: { email: user.primaryEmail },
      });
    const [dbUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.authUserId, user.id))
      .limit(1);
    if (!dbUser) return { kind: "not_ready", user };

    // The single seeded org group.
    const [orgGroup] = await db
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(eq(schema.groups.kind, "org"))
      .limit(1);
    if (!orgGroup) return { kind: "not_ready", user };

    // GOD_EMAILS bootstrap — grant god on first login, but ONLY when the auth
    // provider has verified the email. A listed-but-unverified address (e.g. an
    // OIDC provider asserting an attacker-controlled `email` claim) must never
    // elevate. Audited when a god membership is actually created or changed.
    if (canBootstrapGodEmail(user.primaryEmail, user.emailVerified)) {
      const [existingGod] = await db
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, dbUser.id),
            eq(schema.memberships.groupId, orgGroup.id),
          ),
        )
        .limit(1);
      if (existingGod?.role !== "god") {
        await db
          .insert(schema.memberships)
          .values({ userId: dbUser.id, groupId: orgGroup.id, role: "god" })
          .onConflictDoUpdate({
            target: [schema.memberships.userId, schema.memberships.groupId],
            set: { role: "god" },
          });
        await writeAuditEvent(db, {
          actorId: dbUser.id,
          action: "account.elevate",
          subject: dbUser.id,
          meta: { email: user.primaryEmail, role: "god", via: "god_emails" },
        });
      }
    }

    const [membership] = await db
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, dbUser.id),
          eq(schema.memberships.groupId, orgGroup.id),
        ),
      )
      .limit(1);

    const role = membership?.role;
    if (role && ORG_APP_ROLES.includes(role)) {
      return {
        kind: "ok",
        user,
        dbUserId: dbUser.id,
        role: role as OrgSession["role"],
        orgGroupId: orgGroup.id,
      };
    }
    return { kind: "forbidden", user };
  } catch {
    return { kind: "not_ready", user };
  }
}

/**
 * For server actions: resolve and require an `ok` session, optionally requiring
 * the `god` role. Throws a caller-safe Error otherwise (actions catch and
 * surface it). Never trust the client — every mutation re-checks here.
 */
export async function requireOrgSession(options?: {
  god?: boolean;
}): Promise<OrgSession> {
  const state = await resolveOrgSession();
  if (state.kind !== "ok") {
    throw new Error("Not authorised for the organiser console.");
  }
  if (options?.god && state.role !== "god") {
    throw new Error("This action is restricted to god administrators.");
  }
  return state;
}

/** Whether a role may elevate/demote org staff (god only). */
export function canManageAccounts(role: MembershipRole): boolean {
  return role === "god";
}
