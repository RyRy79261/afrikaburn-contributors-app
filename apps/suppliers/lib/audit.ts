import "server-only";

import { schema, type DbOrTx } from "@/lib/db";

/**
 * Append an audit event. The portal writes the supplier-driven events —
 * self-registration, account link, onboarding step transitions — so the org's
 * trail stays complete. `actorId` is the acting supplier's linked `users.id`.
 *
 * Accepts either the HTTP db or a transaction handle, so it composes inside the
 * multi-write actions (register / step / doc-ack) that must be atomic.
 */
export async function writeAuditEvent(
  db: DbOrTx,
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
