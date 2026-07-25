"use server";

import { z } from "zod";
import {
  CAMP_DESCRIPTION_WORD_LIMIT,
  SOUND_SCALE_VALUES,
  isWithinWordLimit,
} from "@quagga/core";
import { MAX_LAYOUT_UPLOADS, type QuestionnaireResponses } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { checkCampName } from "@/lib/groups-store";
import { createProjectRegistration } from "@/lib/project-registration-store";
import { VEHICLE_ACK_KEYS } from "./copy";

// Mutant Vehicle registration (canvas §S8ZcWf / Qq5u0 · docs/synthesis.md
// "MV registration mirrors the real DMV process"). Everything is optional at
// DRAFT; the submit gate below is what the DMV actually needs before a wrangler
// can pick the application up.

const VehicleRegistrationInput = z.object({
  name: z.string().trim().min(2, "Give your mutant a name.").max(120),
  baseVehicle: z.string().trim().max(160).optional(),
  mutationDescription: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .refine(
      (d) => !d || isWithinWordLimit(d, CAMP_DESCRIPTION_WORD_LIMIT),
      `The mutation description must be ${CAMP_DESCRIPTION_WORD_LIMIT} words or fewer.`,
    ),
  photoUrls: z
    .array(z.string().url())
    .max(MAX_LAYOUT_UPLOADS)
    .default([]),
  /** A `SOUND_SCALE` value — the single source of truth for sound levels. */
  soundLevel: z
    .string()
    .trim()
    .refine(
      (v) => SOUND_SCALE_VALUES.includes(v),
      "Pick a sound level from the list.",
    )
    .optional(),
  flameEffects: z.boolean().nullable().default(null),
  nightDriving: z.boolean().nullable().default(null),
  acks: z.array(z.enum(VEHICLE_ACK_KEYS)).default([]),
  submit: z.boolean().default(false),
  confirmWarnings: z.boolean().default(false),
});

export type VehicleRegistrationActionResult =
  | { status: "created"; slug: string }
  | { status: "error"; message: string }
  | { status: "warn"; warnings: string[] };

/** Everything the DMV needs before a submission is worth a wrangler's time. */
function submitGate(
  input: z.infer<typeof VehicleRegistrationInput>,
): string | null {
  if (!input.baseVehicle) {
    return "Tell the DMV what you're mutating — the donor vehicle.";
  }
  if (!input.mutationDescription) {
    return "Describe the mutation — the DMV needs to know it no longer reads as a normal vehicle.";
  }
  if (
    !isWithinWordLimit(input.mutationDescription, CAMP_DESCRIPTION_WORD_LIMIT)
  ) {
    return `The mutation description must be ${CAMP_DESCRIPTION_WORD_LIMIT} words or fewer.`;
  }
  if (!input.soundLevel) return "Pick your SOOP sound level.";
  if (input.flameEffects === null) {
    return "Say whether your mutant carries flame effects.";
  }
  if (input.nightDriving === null) {
    return "Say whether you plan to drive at night.";
  }
  // Set, not length: a crafted payload could repeat one key three times.
  if (new Set(input.acks).size !== VEHICLE_ACK_KEYS.length) {
    return "Tick all three acknowledgements — on-site licensing depends on them.";
  }
  return null;
}

/**
 * Register (or draft) a mutant vehicle. Creates the `mutant_vehicle` group via
 * the shared `/camps/new` path, then its registration row + answer payload.
 * Server-side authz: `requireCampUser` — the creator must be signed in, and
 * becomes the project's lead.
 */
export async function createVehicleRegistrationAction(
  raw: unknown,
): Promise<VehicleRegistrationActionResult> {
  const parsed = VehicleRegistrationInput.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid vehicle details.",
    };
  }
  const input = parsed.data;
  const user = await requireCampUser();

  if (input.submit) {
    const gate = submitGate(input);
    if (gate) return { status: "error", message: gate };
  }

  const edition = await getActiveEdition();
  if (!edition) {
    return {
      status: "error",
      message: "No AfrikaBurn edition is open for registration yet.",
    };
  }

  const check = await checkCampName(input.name, "mutant_vehicle");
  if (!check.ok) {
    return {
      status: "error",
      message: "A mutant vehicle already cruises under that name. Pick another.",
    };
  }
  if (check.warnings.length > 0 && !input.confirmWarnings) {
    return { status: "warn", warnings: check.warnings };
  }

  const answers: QuestionnaireResponses = {
    base_vehicle: input.baseVehicle ?? "",
    mutation_description: input.mutationDescription ?? "",
    photos: input.photoUrls,
    soop_level: input.soundLevel ?? "",
    flame_effects: input.flameEffects,
    night_driving: input.nightDriving,
    acknowledgements: [...new Set(input.acks)],
  };

  const result = await createProjectRegistration({
    creatorId: user.id,
    creatorEmail: user.email,
    editionId: edition.id,
    kind: "mutant_vehicle",
    name: input.name,
    description: input.mutationDescription ?? null,
    submit: input.submit,
    columns: {
      imageUrls: input.photoUrls,
      soundLevel: input.soundLevel ?? null,
    },
    answers,
  });
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "created", slug: result.slug };
}
