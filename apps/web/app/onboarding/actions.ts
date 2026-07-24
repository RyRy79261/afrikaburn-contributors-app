"use server";

import { z } from "zod";
import type { SaveResult } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { saveBio } from "@/lib/bio-store";

const FlagsSchema = z.record(z.string(), z.boolean()).nullable();

/** Save the Burner Bio from the onboarding runner. Validates responses + flags
 * (Zod at the boundary); `final` completes onboarding and clears the gate. */
export async function saveOnboardingBioAction(
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
  const flags = FlagsSchema.safeParse(privacyFlags);
  return saveBio({
    userId: user.id,
    editionId: edition.id,
    rawResponses: responses,
    rawPrivacyFlags: flags.success && flags.data ? flags.data : undefined,
    rawExtras: extras,
    final: Boolean(final),
  });
}
