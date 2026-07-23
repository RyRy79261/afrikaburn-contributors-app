"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SaveResult } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { saveBio, savePrivacyFlags } from "@/lib/bio-store";

const FlagsSchema = z.record(z.string(), z.boolean());

/** Update the Burner Bio from the profile editor (always final — the bio is
 * already complete here). Privacy flags are edited separately below. */
export async function updateBioAction(
  responses: unknown,
  _privacyFlags: unknown,
  final: boolean,
): Promise<SaveResult> {
  const user = await requireCampUser();
  const edition = await getActiveEdition();
  if (!edition) {
    return { ok: false, errors: { _form: "No active edition is configured." } };
  }
  const result = await saveBio({
    userId: user.id,
    editionId: edition.id,
    rawResponses: responses,
    final: Boolean(final),
  });
  if (result.ok) revalidatePath("/profile");
  return result;
}

/** Persist edited per-field privacy flags. Hard-locked fields are re-forced
 * private inside the store regardless of input. */
export async function savePrivacyFlagsAction(
  flags: Record<string, boolean>,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = FlagsSchema.safeParse(flags);
  if (!parsed.success) return { ok: false, error: "Invalid privacy settings." };
  const user = await requireCampUser();
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };
  await savePrivacyFlags(user.id, edition.id, parsed.data);
  revalidatePath("/profile");
  return { ok: true };
}
