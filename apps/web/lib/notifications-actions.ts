"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { db, schema } from "./db";
import { requireCampUser } from "./session";

// Notification mutation actions (participant app). Server-side authz: a user
// may only ever mark THEIR OWN rows read — the WHERE always pins user_id to the
// authenticated user, so a forged notification id from another account no-ops.

export type NotificationActionResult = { ok: true } | { ok: false; error: string };

const MarkReadInput = z.object({ notificationId: z.string().uuid() });

/** Mark a single notification read (own rows only). */
export async function markNotificationRead(
  raw: z.input<typeof MarkReadInput>,
): Promise<NotificationActionResult> {
  try {
    const user = await requireCampUser();
    const input = MarkReadInput.parse(raw);
    await db()
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.id, input.notificationId),
          eq(schema.notifications.userId, user.id),
          isNull(schema.notifications.readAt),
        ),
      );
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not update that notification.",
    };
  }
}

/** Mark every unread notification read (own inbox only). */
export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  try {
    const user = await requireCampUser();
    await db()
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.userId, user.id),
          isNull(schema.notifications.readAt),
        ),
      );
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not update your notifications.",
    };
  }
}
