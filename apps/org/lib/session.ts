import "server-only";

import { cache } from "react";
import { and, eq } from "drizzle-orm";
import {
  isSanitized,
  orgCan,
  orgCapabilityRefusal,
  orgRankFromRole,
  type OrgActor,
  type OrgCapability,
  type OrgRank,
} from "@quagga/core";
import type { MembershipRole } from "@quagga/types";

import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getDb, schema } from "@/lib/db";
import { canBootstrapGodEmail } from "@/lib/god";
import { writeAuditEvent } from "@/lib/audit";

/**
 * A staff member who has cleared the gate.
 *
 * Clearing it is only the door. WHAT they may read and do comes from
 * `session.actor` + `orgCan` (@quagga/core `org-permissions`) — the same matrix
 * the UI reads, so a hidden control and a refused action can never disagree.
 */
export interface OrgSession {
  /** Neon Auth user. */
  user: AuthenticatedUser;
  /** Our `users.id` (the join row), used as the audit actor. */
  dbUserId: string;
  /**
   * Org rank — `engineer`, `org_staff` or `god` (presented as "System
   * manager"). Same value as `actor.rank`; kept as `role` because the core
   * membership predicates (`canActivateAudience`, …) take a `MembershipRole`
   * and an OrgRank is one.
   */
  role: OrgRank;
  /** The actor every capability check runs against. */
  actor: OrgActor;
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
 *
 * `cache()`d for the life of ONE request. The console layout resolves the
 * session to draw the chrome and every page resolves it again to re-guard
 * before querying — correctly, since UI hiding is never the boundary — which
 * meant the whole upsert + bootstrap + membership lookup ran twice per page
 * view. Deduping does not weaken the guard: each caller still asks and still
 * gets the real answer; only the round trips collapse. The cache is torn down
 * with the request, so no session can outlive it or reach another user.
 */
export const resolveOrgSession = cache(
  async function resolveOrgSession(): Promise<OrgSessionState> {
    const user = await getAuthenticatedUser();
    if (!user) return { kind: "unauthenticated" };
    if (!isDatabaseConfigured()) return { kind: "not_ready", user };

    try {
      const db = getDb();

      // Ensure the users join row (idempotent). Deliberately NOT onConflictDoUpdate:
      // a sanitized (deleted) account keeps its `users` row with `email` nulled, and
      // clobbering it with the incoming email would un-erase the PII the deletion
      // removed. Sync the email only after the sanitized guard below.
      await db
        .insert(schema.users)
        .values({ authUserId: user.id, email: user.primaryEmail })
        .onConflictDoNothing({ target: schema.users.authUserId });
      const [dbUser] = await db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          sanitizedAt: schema.users.sanitizedAt,
        })
        .from(schema.users)
        .where(eq(schema.users.authUserId, user.id))
        .limit(1);
      if (!dbUser) return { kind: "not_ready", user };

      // Re-animation guard: a deleted-and-sanitized account must never resolve to a
      // console session, or its surviving god/org_staff membership would hand the
      // holder staff powers. The Better Auth identity is already deleted; this stops
      // a stale cookie-cache session (up to 5 min) sneaking through.
      if (isSanitized(dbUser)) return { kind: "unauthenticated" };

      // Keep the email fresh for a live account (never a sanitized one — guarded above).
      if (user.primaryEmail && dbUser.email !== user.primaryEmail) {
        await db
          .update(schema.users)
          .set({ email: user.primaryEmail })
          .where(eq(schema.users.id, dbUser.id));
      }

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
        .select({
          role: schema.memberships.role,
          department: schema.memberships.department,
          departmentLead: schema.memberships.departmentLead,
        })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, dbUser.id),
            eq(schema.memberships.groupId, orgGroup.id),
          ),
        )
        .limit(1);

      // `orgRankFromRole` IS the console gate: a role that is not an org rank
      // (lead/admin/member on the org group) resolves to null and is forbidden,
      // so a new membership role can never accidentally open the console.
      const rank = orgRankFromRole(membership?.role);
      if (rank) {
        return {
          kind: "ok",
          user,
          dbUserId: dbUser.id,
          role: rank,
          actor: {
            rank,
            department: membership?.department ?? null,
            isDepartmentLead: membership?.departmentLead ?? false,
          },
          orgGroupId: orgGroup.id,
        };
      }
      return { kind: "forbidden", user };
    } catch {
      return { kind: "not_ready", user };
    }
  },
);

/**
 * For server actions: resolve and require an `ok` session, optionally requiring
 * a CAPABILITY from the shared matrix. Throws a caller-safe Error otherwise
 * (actions catch it and surface the message). Never trust the client — every
 * mutation re-checks here, and the message it throws is the honest one from
 * @quagga/core rather than a generic "not allowed".
 *
 * Every mutation names the capability it needs, including the ones every rank
 * currently holds: `{ capability: "write" }` is a claim a reviewer can check,
 * where an unadorned `requireOrgSession()` is silence.
 */
export async function requireOrgSession(options?: {
  capability?: OrgCapability;
}): Promise<OrgSession> {
  const state = await resolveOrgSession();
  if (state.kind !== "ok") {
    throw new Error("Not authorised for the organiser console.");
  }
  const capability = options?.capability;
  if (capability && !orgCan(state.actor, capability)) {
    throw new Error(orgCapabilityRefusal(state.actor, capability));
  }
  return state;
}

/**
 * Whether a role may elevate/demote org staff. Thin wrapper over the matrix,
 * kept because callers hold a bare `MembershipRole` rather than an actor.
 */
export function canManageAccounts(role: MembershipRole): boolean {
  const rank = orgRankFromRole(role);
  return rank
    ? orgCan(
        { rank, department: null, isDepartmentLead: false },
        "manage_accounts",
      )
    : false;
}
