import { z } from "zod";
import {
  CAMP_DESCRIPTION_WORD_LIMIT,
  SOUND_SCALE_VALUES,
  isWithinWordLimit,
} from "@quagga/core";
import { MAX_LAYOUT_UPLOADS, type QuestionnaireResponses } from "@quagga/types";
import { VEHICLE_ACK_KEYS } from "./copy";

// Shared (non-action) shape for Mutant Vehicle registration — the Zod boundary,
// the value type, the submit gate and the payload builder. Lives in a PLAIN
// module (no "use server") so both the create action and the edit action can
// import it: a "use server" file may only export async functions, so these
// synchronous helpers + the schema cannot live alongside the actions.

export const VehicleRegistrationInput = z.object({
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
  photoUrls: z.array(z.string().url()).max(MAX_LAYOUT_UPLOADS).default([]),
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

export type VehicleRegistrationValues = z.infer<typeof VehicleRegistrationInput>;

export type VehicleRegistrationActionResult =
  | { status: "created"; slug: string }
  | { status: "updated"; slug: string }
  | { status: "error"; message: string }
  | { status: "warn"; warnings: string[] };

/** Map parsed input → the mirrored `registrations` columns + the self-describing
 * answer payload. Shared by create and edit so the two never drift. */
export function buildVehiclePayload(input: VehicleRegistrationValues): {
  description: string | null;
  columns: { imageUrls: string[]; soundLevel: string | null };
  answers: QuestionnaireResponses;
} {
  return {
    description: input.mutationDescription ?? null,
    columns: {
      imageUrls: input.photoUrls,
      soundLevel: input.soundLevel ?? null,
    },
    answers: {
      base_vehicle: input.baseVehicle ?? "",
      mutation_description: input.mutationDescription ?? "",
      photos: input.photoUrls,
      soop_level: input.soundLevel ?? "",
      flame_effects: input.flameEffects,
      night_driving: input.nightDriving,
      acknowledgements: [...new Set(input.acks)],
    },
  };
}

/** Everything the DMV needs before a submission is worth a wrangler's time. */
export function vehicleSubmitGate(
  input: VehicleRegistrationValues,
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
