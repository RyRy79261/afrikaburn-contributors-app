import "server-only";

import { inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/config";

// The sole-camp-lead block names the projects but carries only their ids (core
// is pure and knows nothing about routing). "Transfer leadership → Open Mad
// Hatters" needs a URL, so this resolves ids → slugs.
//
// A dead end with a reason is still a dead end: the whole point of the block is
// that the burner can go and FIX it, which means the link has to work.

export interface BlockedProject {
  id: string;
  name: string;
  slug: string;
}

/** Resolve group ids to their name + slug, for the transfer-leadership links. */
export async function resolveBlockedProjects(
  groupIds: readonly string[],
): Promise<BlockedProject[]> {
  if (!isDatabaseConfigured() || groupIds.length === 0) return [];
  try {
    return await db()
      .select({
        id: schema.groups.id,
        name: schema.groups.name,
        slug: schema.groups.slug,
      })
      .from(schema.groups)
      .where(inArray(schema.groups.id, [...groupIds]));
  } catch {
    return [];
  }
}
