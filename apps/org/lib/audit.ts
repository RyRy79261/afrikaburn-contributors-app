import "server-only";

import type { Database } from "@quagga/db";
import { schema } from "@/lib/db";

/**
 * Append an audit event. Written on the transitions build-spec §audit_events
 * names — elevation, approval/rejection, payment reconciliation — plus the
 * console's other consequential writes (supplier vetting, review threads) for a
 * complete trail. `actorId` is the acting staff member's `users.id`.
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
