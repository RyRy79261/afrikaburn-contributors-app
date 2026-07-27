import "server-only";

import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import {
  isDepartmentScopedCapability,
  isSanitized,
  isSystemManager,
  orgCan,
  orgCanIn,
  orgCapabilityRefusal,
  orgRankFromRole,
  sanitizeOrgPermissions,
  ORG_RANK_LABELS,
  type OrgActor,
  type OrgCapability,
  type OrgRank,
  type OrgRoleGrant,
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
 * Clearing it is ONLY THE DOOR — and since org roles v1 that is meant literally:
 * `memberships.role` says this account may load the console and nothing else.
 * WHAT they may read and do comes from `session.actor.roles` resolved through
 * `orgCan` (@quagga/core `org-permissions`) — the same resolver the UI reads, so
 * a hidden control and a refused action can never disagree. An account with no
 * roles clears the gate and can do nothing, which is the correct fail-closed
 * state rather than a bug.
 *
 * The one exception, and the anti-lockout anchor: `god`. A System manager
 * resolves every capability whatever the role rows say.
 */
export interface OrgSession {
  /** Neon Auth user. */
  user: AuthenticatedUser;
  /** Our `users.id` (the join row), used as the audit actor. */
  dbUserId: string;
  /**
   * The membership role on the org group — the DOOR (`engineer`, `org_staff`)
   * or the System manager anchor (`god`). Same value as `actor.rank`; kept as
   * `role` because the core membership predicates (`canActivateAudience`, …)
   * take a `MembershipRole` and an OrgRank is one. NEVER use it to decide what
   * someone may do — ask `orgCan`.
   */
  role: OrgRank;
  /** The org membership row's id — what role assignments hang off. */
  membershipId: string;
  /** The actor every capability check runs against (rank + assigned roles). */
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
          id: schema.memberships.id,
          role: schema.memberships.role,
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
      if (rank && membership) {
        // THE ONE RESOLUTION PATH. Every capability this session resolves comes
        // from these rows (or from `rank === "god"`, the anchor). Permissions
        // are re-sanitized on the way IN as well as on the way out: a row
        // written by anything other than the role editor still cannot carry a
        // capability no role may hold.
        const assigned = await db
          .select({
            id: schema.orgRoles.id,
            key: schema.orgRoles.key,
            name: schema.orgRoles.name,
            kind: schema.orgRoles.kind,
            departmentId: schema.orgRoles.departmentId,
            permissions: schema.orgRoles.permissions,
          })
          .from(schema.orgRoleAssignments)
          .innerJoin(
            schema.orgRoles,
            eq(schema.orgRoles.id, schema.orgRoleAssignments.orgRoleId),
          )
          .where(eq(schema.orgRoleAssignments.membershipId, membership.id))
          .orderBy(asc(schema.orgRoles.sort), asc(schema.orgRoles.name));

        const roles: OrgRoleGrant[] = assigned.map((r) => ({
          id: r.id,
          key: r.key,
          name: r.name,
          kind: r.kind,
          departmentId: r.departmentId,
          permissions: sanitizeOrgPermissions(r.permissions),
        }));

        return {
          kind: "ok",
          user,
          dbUserId: dbUser.id,
          role: rank,
          membershipId: membership.id,
          actor: { rank, roles },
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
  /**
   * The department the thing being acted on belongs to, when it has one.
   * Supplying it upgrades the check from `orgCan` ("may they, anywhere?") to
   * `orgCanIn` ("may they, HERE?") — which is how a department-scoped role's
   * `delete` stays inside its own department. Omit it for capabilities with no
   * department dimension; pass `null` explicitly for an unfiled thing, which
   * only an org-wide role may touch.
   */
  departmentId?: string | null;
}): Promise<OrgSession> {
  const state = await resolveOrgSession();
  if (state.kind !== "ok") {
    throw new Error("Not authorised for the organiser console.");
  }
  const capability = options?.capability;
  if (capability) {
    // A department-scoped capability (`delete`) is ALWAYS resolved through
    // `orgCanIn`, whether or not the caller named a department. Omitting one
    // then means "this thing belongs to no department", which only an org-wide
    // role may touch — the fail-closed direction, and the one that stops a
    // "Suppliers lead" deleting a theme camp because the guard forgot to ask.
    // Everything else resolves "anywhere": a department member's ordinary work
    // is not confined by a scope no console entity declares yet.
    const permitted = isDepartmentScopedCapability(capability)
      ? orgCanIn(state.actor, capability, options?.departmentId ?? null)
      : orgCan(state.actor, capability);
    if (!permitted) {
      throw new Error(orgCapabilityRefusal(state.actor, capability));
    }
  }
  return state;
}

/**
 * For the surfaces that manage DEPARTMENTS, ROLES and ASSIGNMENTS: require the
 * System manager, resolved from `memberships.role = 'god'` and from nothing
 * else.
 *
 * This is a rail, not a convenience. Editable permissions are only safe because
 * the ability to edit them cannot itself be granted away — so this guard asks
 * the anchor directly rather than a capability a role might one day carry.
 */
export async function requireSystemManager(): Promise<OrgSession> {
  const state = await resolveOrgSession();
  if (state.kind !== "ok") {
    throw new Error("Not authorised for the organiser console.");
  }
  if (!isSystemManager(state.actor)) {
    throw new Error(
      `Only a ${ORG_RANK_LABELS.god.toLowerCase()} can manage departments, roles or who holds them.`,
    );
  }
  return state;
}

/**
 * Whether a membership role may manage accounts. Thin wrapper over the resolver,
 * kept because callers hold a bare `MembershipRole` rather than an actor —
 * `manage_accounts` is System-manager-only and not grantable, so the rank alone
 * is a complete answer here (it is the only capability of which that is true).
 */
export function canManageAccounts(role: MembershipRole): boolean {
  const rank = orgRankFromRole(role);
  return rank ? orgCan({ rank, roles: [] }, "manage_accounts") : false;
}
