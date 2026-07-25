import "server-only";

import { desc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/config";

// The edition label the signed-OUT auth screens show (canvas `K3zNk` / `OX6KJ`
// footer). The gated portal reads its edition through `resolveSupplierSession`;
// these routes run before any session exists, so they need their own tiny,
// never-throwing read. Mirrors `apps/web/lib/edition.ts`.

/** Static fallback so the footer reads correctly env-less or pre-seed. */
export const FALLBACK_EDITION_LABEL = "AfrikaBurn 2027 · 26 April – 2 May 2027";

function formatRange(name: string, startISO: string, endISO: string): string {
  try {
    const start = new Date(`${startISO}T00:00:00Z`);
    const end = new Date(`${endISO}T00:00:00Z`);
    const day = (d: Date) =>
      d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      });
    return `${name} · ${day(start)} – ${day(end)}`;
  } catch {
    return name;
  }
}

/**
 * "AfrikaBurn 2027 · 26 April – 2 May 2027". Never throws: an unconfigured or
 * unreachable database degrades to the static label so the auth screens keep
 * rendering (the env-less boot rule).
 */
export async function getEditionLabel(): Promise<string> {
  if (!isDatabaseConfigured()) return FALLBACK_EDITION_LABEL;
  try {
    const cols = {
      name: schema.editions.name,
      startDate: schema.editions.startDate,
      endDate: schema.editions.endDate,
    };
    const db = getDb();
    const [active] = await db
      .select(cols)
      .from(schema.editions)
      .where(eq(schema.editions.isActive, true))
      .limit(1);
    const edition =
      active ??
      (
        await db
          .select(cols)
          .from(schema.editions)
          .orderBy(desc(schema.editions.year))
          .limit(1)
      )[0];
    if (!edition) return FALLBACK_EDITION_LABEL;
    return formatRange(edition.name, edition.startDate, edition.endDate);
  } catch {
    return FALLBACK_EDITION_LABEL;
  }
}
