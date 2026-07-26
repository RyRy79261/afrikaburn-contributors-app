"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

const SetOrgStaffInput = z.object({
  userId: z.string().uuid(),
  action: z.enum(["elevate", "demote"]),
});

/**
 * Elevate a user to `org_staff` or demote them (remove org access). GOD-ONLY.
 * `god` cannot be granted here — that comes solely from GOD_EMAILS — and an
 * existing god account cannot be modified from this panel. Writes audit_events.
 */
export async function setOrgStaffRole(
  raw: z.input<typeof SetOrgStaffInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({ god: true });
    const input = SetOrgStaffInput.parse(raw);

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
          "God accounts are managed via GOD_EMAILS, not this panel.",
        );
      }

      if (input.action === "elevate") {
        await tx
          .insert(schema.memberships)
          .values({
            userId: input.userId,
            groupId: session.orgGroupId,
            role: "org_staff",
          })
          .onConflictDoUpdate({
            target: [schema.memberships.userId, schema.memberships.groupId],
            set: { role: "org_staff" },
          });
      } else {
        // Demote = remove the org membership entirely (only the org_staff row).
        await tx
          .delete(schema.memberships)
          .where(
            and(
              eq(schema.memberships.userId, input.userId),
              eq(schema.memberships.groupId, session.orgGroupId),
              eq(schema.memberships.role, "org_staff"),
            ),
          );
      }

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action:
          input.action === "elevate" ? "account.elevate" : "account.demote",
        subject: input.userId,
        meta: { email: target.email, role: "org_staff" },
      });
    });

    revalidatePath("/accounts");
    revalidatePath("/");
  });
}
