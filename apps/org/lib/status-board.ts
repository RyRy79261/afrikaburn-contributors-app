import "server-only";

import { and, desc, eq, isNotNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  bucketSubmissionsByMonth,
  type SeriesPoint,
} from "@/lib/status-board-format";

// The two read models the status board / overview need on top of
// `getStatusBoard` (lib/queries.ts): the audit-event activity feed and the
// registrations-over-time series. Both are read-only and assume the caller has
// already cleared the gate. The pure formatting/bucketing lives in
// lib/status-board-format.ts (unit-tested) and is re-exported here so the
// components have one import.

export {
  activityLabel,
  activityTone,
  bucketSubmissionsByMonth,
  hasSeries,
  relativeTime,
  type ActivityTone,
  type SeriesPoint,
} from "@/lib/status-board-format";

// --- Recent activity (audit events) ---------------------------------------

export interface ActivityRow {
  id: string;
  action: string;
  actorEmail: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

/** The most recent audit events across the console (newest first). */
export async function getRecentActivity(limit = 6): Promise<ActivityRow[]> {
  const db = getDb();
  return db
    .select({
      id: schema.auditEvents.id,
      action: schema.auditEvents.action,
      actorEmail: schema.users.email,
      meta: schema.auditEvents.meta,
      createdAt: schema.auditEvents.createdAt,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(limit);
}

// --- Registrations over time ----------------------------------------------

/**
 * Registrations-over-time for an edition, from `registrations.submitted_at`.
 * Only submitted registrations carry a timestamp, so drafts never appear —
 * the series is "submissions per month", which is what it says on the card.
 */
export async function getSubmissionSeries(
  editionId: string | null,
): Promise<SeriesPoint[]> {
  if (!editionId) return [];
  const db = getDb();
  const rows = await db
    .select({ submittedAt: schema.registrations.submittedAt })
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.editionId, editionId),
        isNotNull(schema.registrations.submittedAt),
      ),
    );
  return bucketSubmissionsByMonth(
    rows.flatMap((r) => (r.submittedAt ? [r.submittedAt] : [])),
  );
}
