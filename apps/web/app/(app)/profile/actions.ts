"use server";

import { revalidatePath } from "next/cache";
import type { SaveResult } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import {
  saveBio,
  saveCampmateSettings,
  savePrivacyFlags,
} from "@/lib/bio-store";
import {
  CampmateSettingsInput,
  CampmateSettingsPatchInput,
  PrivacyFlagsInput,
} from "@/lib/campmate-input";

const FlagsSchema = PrivacyFlagsInput;

const NullableFlagsSchema = PrivacyFlagsInput.nullable();

/** Update the Burner Bio from the profile editor. The editor's Privacy step
 * sends the FULL per-field flag map alongside the answers, so we forward it —
 * hard-locked fields are still re-forced private inside the store. A save that
 * omits flags (null) leaves the stored privacy choices untouched. */
export async function updateBioAction(
  responses: unknown,
  privacyFlags: unknown,
  final: boolean,
  extras?: unknown,
  campmate?: unknown,
): Promise<SaveResult> {
  const user = await requireCampUser();
  const edition = await getActiveEdition();
  if (!edition) {
    return { ok: false, errors: { _form: "No active edition is configured." } };
  }
  const flags = NullableFlagsSchema.safeParse(privacyFlags);
  const settings = CampmateSettingsInput.safeParse(campmate);
  const result = await saveBio({
    userId: user.id,
    editionId: edition.id,
    rawResponses: responses,
    rawPrivacyFlags: flags.success && flags.data ? flags.data : undefined,
    rawExtras: extras,
    campmate: settings.success ? settings.data : undefined,
    final: Boolean(final),
  });
  if (result.ok) revalidatePath("/profile");
  return result;
}

/** Persist edited per-field privacy flags. Hard-locked fields are re-forced
 * private inside the store regardless of input. */
export async function savePrivacyFlagsAction(
  flags: unknown,
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

/**
 * Epic #68: update the camp-mate settings from the profile card — who may see
 * the photo, who may contact you, and whether you are in your camp's people
 * list. A partial patch (only what the card changed), Zod-validated here and
 * merged server-side; the photo level goes through `enforcePrivacyFlags` like
 * every other privacy write.
 */
export async function saveCampmateSettingsAction(
  patch: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = CampmateSettingsPatchInput.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "Invalid settings." };
  const user = await requireCampUser();
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };
  const saved = await saveCampmateSettings(user.id, edition.id, parsed.data);
  if (!saved) {
    return { ok: false, error: "Finish your Burner Bio first." };
  }
  revalidatePath("/profile");
  return { ok: true };
}
