import "server-only";

import { desc, eq } from "drizzle-orm";
import { db, schema } from "./db";

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
