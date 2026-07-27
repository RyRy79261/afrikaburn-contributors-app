"use server";

import { z } from "zod";
import { USERNAME_MAX_LENGTH, validateUsername } from "@quagga/core";
import type { SaveResult } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { isUsernameAvailable, saveBio } from "@/lib/bio-store";

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

/**
 * The Zod boundary for the availability check. Capped WELL above
 * USERNAME_MAX_LENGTH on purpose: a 200-char paste is a user typing, and
 * `validateUsername` answers it with a sentence about length. Anything longer is
 * not a username attempt, so it is refused before it reaches a query.
 */
const UsernameCandidate = z.string().max(USERNAME_MAX_LENGTH * 10);

export type UsernameCheck =
  | { status: "available" }
  | { status: "taken"; message: string }
  | { status: "invalid"; message: string };

/**
 * Is a candidate username free? A server action is a PUBLIC HTTP endpoint, so:
 *
 *  - AUTHORISED: signed-in burners only (`requireCampUser` redirects otherwise).
 *    A signed-out visitor has no business enumerating handles, and requiring an
 *    account is what makes abuse attributable and rate-limitable per user.
 *  - ZOD-VALIDATED at the boundary, then the SAME `validateUsername` the save
 *    path runs — one rule set, so the check can never say yes to something the
 *    save would reject.
 *  - RATE-LIMIT-FRIENDLY: one indexed equality lookup on `lower(username)`, no
 *    joins, no writes, no email, nothing to fan out. Cheap enough to debounce
 *    from the field and cheap enough to throttle without losing anything.
 *  - ENUMERATION-SANE: revealing that a handle is TAKEN is inherent to unique
 *    handles — you cannot let someone pick one without telling them. Revealing
 *    WHO holds it is not, so nothing about the holder is returned or hinted at,
 *    and an invalid candidate is never silently reported as "taken" (which would
 *    otherwise leak the reserved list as if it were real accounts).
 */
export async function checkUsernameAvailabilityAction(
  candidate: unknown,
): Promise<UsernameCheck> {
  const user = await requireCampUser();

  const parsed = UsernameCandidate.safeParse(candidate);
  if (!parsed.success) {
    return { status: "invalid", message: "That username is too long." };
  }

  const checked = validateUsername(parsed.data);
  if (!checked.ok) return { status: "invalid", message: checked.error };

  const free = await isUsernameAvailable(user.id, checked.username);
  return free
    ? { status: "available" }
    : { status: "taken", message: "That username is already taken." };
}
