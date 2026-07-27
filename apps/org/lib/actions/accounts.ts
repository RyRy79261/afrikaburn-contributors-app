"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { ORG_RANK_LABELS, defaultRoleKeyForRank } from "@quagga/core";

import { schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

// Account access management — SYSTEM MANAGER ONLY (`manage_accounts`, which no
// role may carry: see @quagga/core `org-permissions`).
//
// WHAT THIS PANEL GRANTS SINCE ORG ROLES v1: the DOOR. `engineer` and
// `org_staff` mean "this account may load the console" and nothing else — what
// they may then do comes from the ORG ROLES assigned to them (`setAccountOrgRoles`
// in lib/actions/org-roles.ts). Granting the door alone is a valid, fail-closed
// state: they see an empty console until a role arrives. Because that is a poor
// first experience nobody asked for, an elevation also assigns the seeded role
// matching the door they came in through — the SAME rights that door used to
// carry as a hardcoded rank — which a System manager can change immediately.
//
// `god` — the rank the console presents as System manager — is deliberately NOT
// grantable here: it comes solely from a VERIFIED GOD_EMAILS address at sign-in,
// which is the ceiling that stops the console being able to mint its own highest
// privilege. An existing god account cannot be modified from this panel either,
// in the same spirit — which is also the sole-System-manager guard: the last one
// cannot be removed or demoted from any screen, because no screen can touch a
// god membership at all.

/** The doors this panel may grant. `god` is GOD_EMAILS-only, by design. */
const GrantableRank = z.enum(["engineer", "org_staff"]);

const SetOrgStaffInput = z.object({
  userId: z.string().uuid(),
  action: z.enum(["elevate", "demote"]),
  /**
   * Which door to grant on elevate. Optional and defaulting to `org_staff` —
   * the behaviour this action had when there was only one — so an older caller
   * keeps working rather than silently granting something else.
   */
  rank: GrantableRank.optional(),
});

/**
 * Grant a user console access (`engineer` / `org_staff`) or remove it entirely.
 * Writes audit_events either way.
 *
 * Demote removes whichever grantable rank the row held rather than matching
 * `org_staff` alone: the point is "they no longer have console access", and a
 * revoke that quietly no-ops on an engineer would be the worst kind of failure —
 * one that looks like it worked. Deleting the membership cascades their role
 * assignments away with it, so nothing is left to reattach itself if they are
 * re-granted access later.
 */
export async function setOrgStaffRole(
  raw: z.input<typeof SetOrgStaffInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({ capability: "manage_accounts" });
    const input = SetOrgStaffInput.parse(raw);
    const rank = input.rank ?? "org_staff";

    if (input.userId === session.dbUserId) {
      throw new Error("You cannot change your own access.");
    }

    // The membership existence checks, the role write, the starting role
    // assignment and the audit row are one atomic unit — access can never change
    // without its audit trail, nor an audit row be stamped for a write that a
    // guard then aborted.
    await withTransaction(async (tx) => {
      const [target] = await tx
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, input.userId))
        .limit(1);
      if (!target) throw new Error("That account no longer exists.");

      const [existing] = await tx
        .select({
          id: schema.memberships.id,
          role: schema.memberships.role,
        })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, input.userId),
            eq(schema.memberships.groupId, session.orgGroupId),
          ),
        )
        .limit(1);

      // THE SOLE-SYSTEM-MANAGER GUARD. A god membership is untouchable from this
      // panel in either direction, so the last System manager can be neither
      // removed nor demoted — by anyone, including themselves.
      if (existing?.role === "god") {
        throw new Error(
          `${ORG_RANK_LABELS.god} accounts are managed via GOD_EMAILS, not this panel.`,
        );
      }

      if (input.action === "elevate") {
        const [membership] = await tx
          .insert(schema.memberships)
          .values({
            userId: input.userId,
            groupId: session.orgGroupId,
            role: rank,
          })
          .onConflictDoUpdate({
            target: [schema.memberships.userId, schema.memberships.groupId],
            set: { role: rank },
          })
          .returning({ id: schema.memberships.id });

        // A NEW account gets the seeded role for the door it came in through, so
        // "elevate to org staff" produces someone who can actually do org staff
        // work. An EXISTING account's roles are left alone: a System manager may
        // have already tailored them, and re-adding a default over the top would
        // silently undo that.
        if (membership && !existing) {
          const [seeded] = await tx
            .select({ id: schema.orgRoles.id })
            .from(schema.orgRoles)
            .where(eq(schema.orgRoles.key, defaultRoleKeyForRank(rank)))
            .limit(1);
          if (seeded) {
            await tx
              .insert(schema.orgRoleAssignments)
              .values({ membershipId: membership.id, orgRoleId: seeded.id })
              .onConflictDoNothing();
          }
        }
      } else {
        // Demote = remove the org membership entirely (role assignments cascade).
        // The role in the WHERE is the one we just read and proved is not `god`,
        // so this can revoke an engineer as readily as org staff while still
        // being unable to delete a System manager's row.
        await tx
          .delete(schema.memberships)
          .where(
            and(
              eq(schema.memberships.userId, input.userId),
              eq(schema.memberships.groupId, session.orgGroupId),
              eq(schema.memberships.role, existing?.role ?? "org_staff"),
            ),
          );
      }

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action:
          input.action === "elevate" ? "account.elevate" : "account.demote",
        subject: input.userId,
        meta: {
          email: target.email,
          role: input.action === "elevate" ? rank : (existing?.role ?? null),
        },
      });
    });

    revalidatePath("/accounts");
    revalidatePath("/system");
    revalidatePath("/");
  });
}
