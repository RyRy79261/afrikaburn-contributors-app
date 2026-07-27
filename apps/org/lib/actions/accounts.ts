"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { ORG_RANK_LABELS, normalizeDepartment } from "@quagga/core";

import { schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

// Account access management — SYSTEM MANAGER ONLY (`manage_accounts`).
//
// The grantable ranks are `engineer` and `org_staff`. `god` — the rank the
// console presents as System manager — is deliberately NOT grantable here: it
// comes solely from a VERIFIED GOD_EMAILS address at sign-in, which is the
// ceiling that stops the console being able to mint its own highest privilege.
// An existing god account cannot be modified from this panel either, in the
// same spirit.

/** The ranks this panel may grant. `god` is GOD_EMAILS-only, by design. */
const GrantableRank = z.enum(["engineer", "org_staff"]);

const SetOrgStaffInput = z.object({
  userId: z.string().uuid(),
  action: z.enum(["elevate", "demote"]),
  /**
   * Which rank to grant on elevate. Optional and defaulting to `org_staff` —
   * the behaviour this action had when there was only one grantable rank — so
   * an older caller keeps working rather than silently granting something else.
   */
  rank: GrantableRank.optional(),
  /** Free-text department label; empty/omitted clears it. */
  department: z.string().max(200).nullish(),
  /** Whether they lead that department. */
  departmentLead: z.boolean().optional(),
});

/**
 * Grant a user an org rank (`engineer` / `org_staff`) or remove their org access
 * entirely, optionally recording the department they belong to and whether they
 * lead it. Writes audit_events either way.
 *
 * Demote removes whichever grantable rank the row held rather than matching
 * `org_staff` alone: the point is "they no longer have console access", and a
 * revoke that quietly no-ops on an engineer would be the worst kind of failure —
 * one that looks like it worked.
 */
export async function setOrgStaffRole(
  raw: z.input<typeof SetOrgStaffInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({ capability: "manage_accounts" });
    const input = SetOrgStaffInput.parse(raw);
    const rank = input.rank ?? "org_staff";
    const department = normalizeDepartment(input.department);
    const departmentLead = input.departmentLead ?? false;

    if (input.userId === session.dbUserId) {
      throw new Error("You cannot change your own access.");
    }

    // The membership existence checks, the role write and the audit row are one
    // atomic unit — access can never change without its audit trail, nor an
    // audit row be stamped for a write that a guard then aborted.
    await withTransaction(async (tx) => {
      const [target] = await tx
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, input.userId))
        .limit(1);
      if (!target) throw new Error("That account no longer exists.");

      const [existing] = await tx
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, input.userId),
            eq(schema.memberships.groupId, session.orgGroupId),
          ),
        )
        .limit(1);

      if (existing?.role === "god") {
        throw new Error(
          `${ORG_RANK_LABELS.god} accounts are managed via GOD_EMAILS, not this panel.`,
        );
      }

      if (input.action === "elevate") {
        await tx
          .insert(schema.memberships)
          .values({
            userId: input.userId,
            groupId: session.orgGroupId,
            role: rank,
            department,
            departmentLead,
          })
          .onConflictDoUpdate({
            target: [schema.memberships.userId, schema.memberships.groupId],
            set: { role: rank, department, departmentLead },
          });
      } else {
        // Demote = remove the org membership entirely. The role in the WHERE is
        // the one we just read and proved is not `god`, so this can revoke an
        // engineer as readily as org staff while still being unable to delete a
        // System manager's row.
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
          ...(input.action === "elevate" ? { department, departmentLead } : {}),
        },
      });
    });

    revalidatePath("/accounts");
    revalidatePath("/");
  });
}

const SetDepartmentInput = z.object({
  userId: z.string().uuid(),
  department: z.string().max(200).nullish(),
  departmentLead: z.boolean(),
});

/**
 * Record which department an org member belongs to, and whether they lead it.
 *
 * Deliberately a LABEL, not a catalog: no `departments` table, no picker of
 * known departments, no screen to manage them — because the org cannot yet say
 * how many departments there are or what protocols they carry (Ryan, 27 Jul
 * 2026), and a catalog would be us inventing the org's shape for it. The value
 * grants NOTHING today (@quagga/core `org-permissions` never consults it); it
 * records who answers for what, somewhere a future rule can find it.
 *
 * System manager only, audited.
 */
export async function setOrgDepartment(
  raw: z.input<typeof SetDepartmentInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({ capability: "manage_accounts" });
    const input = SetDepartmentInput.parse(raw);
    const department = normalizeDepartment(input.department);

    // Update + audit are one atomic unit, like every other access write here.
    await withTransaction(async (tx) => {
      const updated = await tx
        .update(schema.memberships)
        .set({ department, departmentLead: input.departmentLead })
        .where(
          and(
            eq(schema.memberships.userId, input.userId),
            eq(schema.memberships.groupId, session.orgGroupId),
          ),
        )
        .returning({ id: schema.memberships.id });
      if (updated.length === 0) {
        throw new Error(
          "That account has no org access, so there is nothing to file under a department.",
        );
      }

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "account.department",
        subject: input.userId,
        meta: { department, departmentLead: input.departmentLead },
      });
    });

    revalidatePath("/accounts");
  });
}
