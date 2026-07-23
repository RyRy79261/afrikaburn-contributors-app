"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { getDb, schema } from "@/lib/db";
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

    const db = getDb();

    const [target] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);
    if (!target) throw new Error("That account no longer exists.");

    const [existing] = await db
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
      await db
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
      await db
        .delete(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, input.userId),
            eq(schema.memberships.groupId, session.orgGroupId),
            eq(schema.memberships.role, "org_staff"),
          ),
        );
    }

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: input.action === "elevate" ? "account.elevate" : "account.demote",
      subject: input.userId,
      meta: { email: target.email, role: "org_staff" },
    });

    revalidatePath("/accounts");
    revalidatePath("/");
  });
}
