"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { getDb, schema } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { runAction, type ActionResult } from "./result";

// Console notification mutations. Server-side authz: staff mark only their OWN
// rows read — the WHERE always pins user_id to the gated session's dbUserId.

const MarkReadInput = z.object({ notificationId: z.string().uuid() });

/** Mark a single notification read (own rows only). */
export async function markNotificationRead(
  raw: z.input<typeof MarkReadInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
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
    revalidatePath("/", "layout");
  });
}

/** Mark every unread notification read (own inbox only). */
export async function markAllNotificationsRead(): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
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
