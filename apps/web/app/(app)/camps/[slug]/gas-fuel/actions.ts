"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveEdition } from "@/lib/edition";
import { requireCampUser } from "@/lib/session";
import {
  saveGasFuelRecord,
  startGasFuelFromLastYear,
} from "@/lib/gas-fuel-store";

// The gas & fuel record's actions (docs/registration-safety-spec.md). Thin on
// purpose, like the layout's: WHO comes from the session; the Zod parse of the
// whole input, the caller's membership (locked), whether they may edit, and the
// edge-triggered fuel depot notice all happen inside the store's transaction
// over facts it reads itself.

export type GasFuelActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const NO_EDITION = "No active edition is configured.";
const SlugOnly = z.object({ slug: z.string().min(1).max(200) });

async function activeEdition() {
  const edition = await getActiveEdition();
  return edition ? { id: edition.id, year: edition.year } : null;
}

/** Refreshes every surface that reads the saved record. */
function revalidate(slug: string) {
  revalidatePath(`/camps/${slug}`);
  revalidatePath(`/camps/${slug}/gas-fuel`);
  revalidatePath(`/camps/${slug}/registration`);
}

/** Save the record. It stops being a draft; the depot notice is decided. */
export async function saveGasFuelRecordAction(
  raw: unknown,
): Promise<GasFuelActionResult<{ advice: boolean }>> {
  const user = await requireCampUser();
  const edition = await activeEdition();
  if (!edition) return { ok: false, error: NO_EDITION };
  const r = await saveGasFuelRecord(user.id, edition, raw);
  const slug = SlugOnly.safeParse(raw);
  if (r.ok && slug.success) revalidate(slug.data.slug);
  return r;
}

/** "Start from 2026": copy last year's record in as a draft. */
export async function startGasFuelFromLastYearAction(
  raw: unknown,
): Promise<GasFuelActionResult> {
  const user = await requireCampUser();
  const edition = await activeEdition();
  if (!edition) return { ok: false, error: NO_EDITION };
  const r = await startGasFuelFromLastYear(user.id, edition, raw);
  const slug = SlugOnly.safeParse(raw);
  if (r.ok && slug.success) revalidatePath(`/camps/${slug.data.slug}/gas-fuel`);
  return r.ok ? { ok: true } : r;
}
