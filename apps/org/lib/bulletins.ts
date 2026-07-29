import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import type { AudienceSpec } from "@quagga/types";

import { getDb, schema } from "./db";
import { isDatabaseConfigured } from "./config";
import { audienceLabel } from "./questionnaires/queries";

// Org Bulletins read models (console → Bulletins). Read-only; callers clear the
// console gate first. Read-rate = (bulletin notifications read) / (total sent).

export interface BulletinSummary {
  id: string;
  title: string;
  /** Raw markdown body — the list derives a plain-text preview, the compose
   * form seeds the editor with it. */
  bodyMd: string;
  audience: AudienceSpec;
  audienceLabel: string;
  pinned: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  /** Last edit — the drafts list shows "last edited …". */
  updatedAt: Date;
  /** Recipients who have opened it. */
  readCount: number;
  /** Total recipients the bulletin fanned out to. */
  sentCount: number;
}

/** How many recipients a bulletin reached, and how many have opened it. */
interface Tally {
  sent: number;
  read: number;
}

const NO_TALLY: Tally = { sent: 0, read: 0 };

/** The stored row plus its tally, as every surface consumes it. */
function toSummary(
  b: typeof schema.bulletins.$inferSelect,
  tally: Tally,
): BulletinSummary {
  return {
    id: b.id,
    title: b.title,
    bodyMd: b.bodyMd,
    audience: b.audience,
    audienceLabel: audienceLabel(b.audience),
    pinned: b.pinned,
    publishedAt: b.publishedAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    readCount: tally.read,
    sentCount: tally.sent,
  };
}

/** All bulletins (published + drafts) newest first, with read-rate tallies. */
export async function listBulletins(): Promise<BulletinSummary[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.bulletins)
    .orderBy(desc(schema.bulletins.createdAt));

  // Per-bulletin read/sent tallies from the notifications fan-out. One grouped
  // aggregate for the whole page, which is the right shape HERE — the list
  // renders every bulletin, so every group is used.
  const tallies = await db
    .select({
      bulletinId: schema.notifications.bulletinId,
      sent: sql<number>`count(*)::int`,
      read: sql<number>`count(*) filter (where ${schema.notifications.readAt} is not null)::int`,
    })
    .from(schema.notifications)
    .where(eq(schema.notifications.kind, "bulletin"))
    .groupBy(schema.notifications.bulletinId);
  const tallyByBulletin = new Map(
    tallies.map((t) => [t.bulletinId, { sent: t.sent, read: t.read }]),
  );

  return rows.map((b) => toSummary(b, tallyByBulletin.get(b.id) ?? NO_TALLY));
}

/**
 * A single bulletin for the compose/edit + read-rate detail.
 *
 * Its own two queries rather than a filter over `listBulletins()`. That is what
 * it used to be, and it meant opening ONE bulletin fetched every bulletin row
 * in the deployment — bodies included, which are up to 20 000 characters each —
 * and then aggregated every bulletin notification ever sent, to read a single
 * row and a single pair of counts out of the result. The cost grew with the
 * whole broadcast history for a page that shows one notice.
 */
export async function getBulletin(id: string): Promise<BulletinSummary | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb();

  const [row] = await db
    .select()
    .from(schema.bulletins)
    .where(eq(schema.bulletins.id, id))
    .limit(1);
  if (!row) return null;

  // The tally for THIS bulletin, counted in SQL. No group-by and no map: the
  // aggregate is over one bulletin's notification rows and returns one row.
  const [tally] = await db
    .select({
      sent: sql<number>`count(*)::int`,
      read: sql<number>`count(*) filter (where ${schema.notifications.readAt} is not null)::int`,
    })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.kind, "bulletin"),
        eq(schema.notifications.bulletinId, id),
      ),
    );

  return toSummary(row, tally ?? NO_TALLY);
}
