"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { getDb, schema } from "@/lib/db";
import { requireSupplierSession } from "@/lib/session";
import { runAction, type ActionResult } from "./result";

// Portal notification mutations (docs/notifications-spec.md). Server-side
// authz: a supplier marks only their OWN rows read — every WHERE pins
// `user_id` to the gated session's `dbUserId`, so a forged notification id
// simply matches nothing. The UI is never the boundary.

const MarkReadInput = z.object({ notificationId: z.string().uuid() });

/** Mark a single notification read (own rows only). */
export async function markNotificationRead(
  raw: z.input<typeof MarkReadInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSupplierSession();
    const input = MarkReadInput.parse(raw);
    await getDb()
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.id, input.notificationId),
          eq(schema.notifications.userId, session.dbUserId),
          isNull(schema.notifications.readAt),
        ),
      );
    revalidatePath("/notifications");
    // The header bell's count lives in the portal layout.
    revalidatePath("/", "layout");
  });
}

/** Mark every unread notification read (own inbox only). */
export async function markAllNotificationsRead(): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSupplierSession();
    await getDb()
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.userId, session.dbUserId),
          isNull(schema.notifications.readAt),
        ),
      );
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
  });
}
