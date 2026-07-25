import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import type { AudienceSpec } from "@quagga/types";

import { getDb, schema } from "./db";
import { isDatabaseConfigured } from "./config";
import { audienceLabel } from "./questionnaires/queries";

// Org Bulletins read models (console → Bulletins). Read-only; callers clear the
// console gate first. Read-rate = (bulletin notifications read) / (total sent).

export interface BulletinSummary {
  id: string;
  title: string;
  audience: AudienceSpec;
  audienceLabel: string;
  pinned: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  /** Recipients who have opened it. */
  readCount: number;
  /** Total recipients the bulletin fanned out to. */
  sentCount: number;
}

/** All bulletins (published + drafts) newest first, with read-rate tallies. */
export async function listBulletins(): Promise<BulletinSummary[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.bulletins)
    .orderBy(desc(schema.bulletins.createdAt));

  // Per-bulletin read/sent tallies from the notifications fan-out.
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

  return rows.map((b) => {
    const tally = tallyByBulletin.get(b.id) ?? { sent: 0, read: 0 };
    return {
      id: b.id,
      title: b.title,
      audience: b.audience,
      audienceLabel: audienceLabel(b.audience),
      pinned: b.pinned,
      publishedAt: b.publishedAt,
      createdAt: b.createdAt,
      readCount: tally.read,
      sentCount: tally.sent,
    };
  });
}

/** A single bulletin for the compose/edit + read-rate detail. */
export async function getBulletin(id: string): Promise<BulletinSummary | null> {
  if (!isDatabaseConfigured()) return null;
  const list = await listBulletins();
  return list.find((b) => b.id === id) ?? null;
}
