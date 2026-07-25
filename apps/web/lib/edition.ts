import "server-only";

import { desc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { isDatabaseConfigured } from "./config";

export interface Edition {
  id: string;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

/** The active edition (AfrikaBurn 2027, per seed). Falls back to the most
 * recent edition if none is flagged active; null when the table is empty or the
 * DB is unreachable. */
export async function getActiveEdition(): Promise<Edition | null> {
  const rows = await db()
    .select()
    .from(schema.editions)
    .where(eq(schema.editions.isActive, true))
    .limit(1);
  if (rows[0]) return rows[0];
  const latest = await db()
    .select()
    .from(schema.editions)
    .orderBy(desc(schema.editions.year))
    .limit(1);
  return latest[0] ?? null;
}

/** Static fallback so banners read correctly before the edition is seeded or
 * env-less (matches the seeded AfrikaBurn 2027 dates + the design canvas copy). */
export const FALLBACK_EDITION_LABEL = "AfrikaBurn 2027 · 26 April – 2 May 2027";

function formatEditionRange(
  name: string,
  startISO: string,
  endISO: string,
): string {
  try {
    const start = new Date(`${startISO}T00:00:00Z`);
    const end = new Date(`${endISO}T00:00:00Z`);
    const day = (d: Date) =>
      d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      });
    return `${name} · ${day(start)} – ${day(end)} ${end.getUTCFullYear()}`;
  } catch {
    return name;
  }
}

/** The active edition rendered as the shared header/footer banner string, e.g.
 * "AfrikaBurn 2027 · 26 April – 2 May 2027". Never throws — falls back to the
 * static label when the DB is unset or unreachable (env-less boot law). */
export async function getEditionLabel(): Promise<string> {
  if (!isDatabaseConfigured()) return FALLBACK_EDITION_LABEL;
  try {
    const edition = await getActiveEdition();
    if (!edition) return FALLBACK_EDITION_LABEL;
    return formatEditionRange(edition.name, edition.startDate, edition.endDate);
  } catch {
    return FALLBACK_EDITION_LABEL;
  }
}
