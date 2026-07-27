"use server";

import { z } from "zod";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { searchCampDirectory, type CampSearchResult } from "@/lib/groups-store";

const QuerySchema = z.string().max(120);

/**
 * Server action powering the Burner Bio camp-history type-ahead. Auth-gated;
 * delegates visibility to `searchCampDirectory` (registered camps + the viewer's
 * own camps only — free camps stay undiscoverable to strangers).
 */
export async function searchCampsAction(
  query: unknown,
): Promise<CampSearchResult[]> {
  const parsed = QuerySchema.safeParse(query);
  if (!parsed.success) return [];
  const user = await requireCampUser();
  const edition = await getActiveEdition();
  if (!edition) return [];
  return searchCampDirectory(parsed.data, edition.id, user.id);
}
