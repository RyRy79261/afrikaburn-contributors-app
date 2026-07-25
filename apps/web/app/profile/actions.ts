"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SaveResult } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { saveBio, savePrivacyFlags } from "@/lib/bio-store";

const FlagsSchema = z.record(z.string(), z.boolean());

const NullableFlagsSchema = z.record(z.string(), z.boolean()).nullable();

/** Update the Burner Bio from the profile editor. The editor's Privacy step
 * sends the FULL per-field flag map alongside the answers, so we forward it —
 * hard-locked fields are still re-forced private inside the store. A save that
 * omits flags (null) leaves the stored privacy choices untouched. */
export async function updateBioAction(
  responses: unknown,
  privacyFlags: unknown,
  final: boolean,
  extras?: unknown,
): Promise<SaveResult> {
  const user = await requireCampUser();
  const edition = await getActiveEdition();
  if (!edition) {
    return { ok: false, errors: { _form: "No active edition is configured." } };
  }
  const flags = NullableFlagsSchema.safeParse(privacyFlags);
  const result = await saveBio({
    userId: user.id,
    editionId: edition.id,
    rawResponses: responses,
    rawPrivacyFlags: flags.success && flags.data ? flags.data : undefined,
    rawExtras: extras,
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
