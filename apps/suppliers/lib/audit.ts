import "server-only";

import type { Database } from "@quagga/db";
import { schema } from "@/lib/db";

/**
 * Append an audit event. The portal writes the supplier-driven events —
 * self-registration, account link, onboarding step transitions — so the org's
 * trail stays complete. `actorId` is the acting supplier's linked `users.id`.
 */
export async function writeAuditEvent(
  db: Database,
  event: {
    actorId: string;
    action: string;
    subject?: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(schema.auditEvents).values({
    actorId: event.actorId,
    action: event.action,
    subject: event.subject ?? null,
    meta: event.meta ?? null,
  });
}
