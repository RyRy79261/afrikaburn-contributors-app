"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { layoutRefusalMessage } from "@quagga/core";
import { getActiveEdition } from "@/lib/edition";
import { requireCampUser } from "@/lib/session";
import {
  createCampLayout,
  loadCampLayout,
  loadLayoutAccess,
  saveCampLayout,
  startLayoutFromLastYear,
  type LayoutEdition,
} from "@/lib/camp-layout-store";

// Camp layout actions (docs/camp-layout-spec.md). Thin on purpose: WHO the
// caller is comes from the session, and everything else — the Zod parse of
// the whole input, the catalogue check, the caller's membership (locked),
// whether they may edit, the compare-and-set — happens inside the store's
// transaction over facts it reads itself. A non-member, a former member and
// a slug that does not exist all get "Camp not found.".
//
// SAVES DO NOT REVALIDATE. The editor saves as you go; re-rendering the page
// on every save would throw the canvas's payload back at it for nothing. The
// pages that show the layout are dynamic and read it fresh on the next visit.

export type LayoutActionResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

export type SaveLayoutResult =
  | { ok: true; version: number }
  | {
      ok: false;
      error: string;
      /** Set when someone else saved first: who and when, for the message
       * "Ren Notfound saved a newer version at 14:35". */
      conflict?: { byName: string | null; at: string | null };
    };

async function activeEdition(): Promise<LayoutEdition | null> {
  const edition = await getActiveEdition();
  return edition ? { id: edition.id, year: edition.year } : null;
}

const NO_EDITION = "No active edition is configured.";
const SlugOnly = z.object({ slug: z.string().min(1).max(200) });

function revalidate(slug: string) {
  revalidatePath(`/camps/${slug}`);
  revalidatePath(`/camps/${slug}/layout`);
}

/** "Create the plot" — an empty plot of the size the camp typed. */
export async function createCampLayoutAction(
  raw: unknown,
): Promise<LayoutActionResult> {
  const user = await requireCampUser();
  const edition = await activeEdition();
  if (!edition) return { ok: false, error: NO_EDITION };
  const r = await createCampLayout(user.id, edition, raw);
  const slug = SlugOnly.safeParse(raw);
  if (r.ok && slug.success) revalidate(slug.data.slug);
  return r.ok ? { ok: true } : r;
}

/** "Start from last year's layout" — one click, a copy. */
export async function startLayoutFromLastYearAction(
  raw: unknown,
): Promise<LayoutActionResult> {
  const user = await requireCampUser();
  const edition = await activeEdition();
  if (!edition) return { ok: false, error: NO_EDITION };
  const r = await startLayoutFromLastYear(user.id, edition, raw);
  const slug = SlugOnly.safeParse(raw);
  if (r.ok && slug.success) revalidate(slug.data.slug);
  return r.ok ? { ok: true } : r;
}

/** Autosave: compare-and-set on the version the editor last saved. */
export async function saveCampLayoutAction(
  raw: unknown,
): Promise<SaveLayoutResult> {
  const user = await requireCampUser();
  const edition = await activeEdition();
  if (!edition) return { ok: false, error: NO_EDITION };
  const r = await saveCampLayout(user.id, edition, raw);
  if (r.ok) return { ok: true, version: r.version };
  if (r.error !== layoutRefusalMessage("stale")) return r;

  // Someone else saved first. Say who and when — read through the same
  // membership check every read takes, so this names nobody to a caller who
  // could not open the layout anyway.
  const slug = SlugOnly.safeParse(raw);
  const access = slug.success
    ? await loadLayoutAccess(slug.data.slug, user.id)
    : null;
  const view = access ? await loadCampLayout(access, edition) : null;
  return {
    ok: false,
    error: r.error,
    conflict: {
      byName: view?.layout?.updatedByName ?? null,
      at: view?.layout?.updatedAt.toISOString() ?? null,
    },
  };
}
