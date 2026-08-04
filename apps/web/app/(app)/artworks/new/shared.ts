import { z } from "zod";
import { CAMP_DESCRIPTION_WORD_LIMIT, isWithinWordLimit } from "@quagga/core";
import { MAX_LAYOUT_UPLOADS, type QuestionnaireResponses } from "@quagga/types";
import { ARTWORK_POWER_KEYS } from "./copy";

// Shared (non-action) shape for Art Project registration — the Zod boundary, the
// value type, the submit gate and the payload builder. Lives in a PLAIN module
// (no "use server") so both the create and edit actions can import it: a
// "use server" file may only export async functions.

const metres = z
  .number()
  .finite()
  .positive("Dimensions are in metres and must be greater than zero.")
  .max(200)
  .nullable()
  .default(null);

const wordLimited = (label: string) =>
  z
    .string()
    .trim()
    .max(4000)
    .optional()
    .refine(
      (v) => !v || isWithinWordLimit(v, CAMP_DESCRIPTION_WORD_LIMIT),
      `${label} must be ${CAMP_DESCRIPTION_WORD_LIMIT} words or fewer.`,
    );

export const ArtworkRegistrationInput = z.object({
  name: z.string().trim().min(2, "Give your artwork a name.").max(120),
  artist: z.string().trim().max(160).optional(),
  description: wordLimited("The description"),
  imageUrls: z.array(z.string().url()).max(MAX_LAYOUT_UPLOADS).default([]),
  widthM: metres,
  depthM: metres,
  heightM: metres,
  placementNotes: wordLimited("Placement notes"),
  burnIntent: z.boolean().nullable().default(null),
  powerNeeds: z.array(z.enum(ARTWORK_POWER_KEYS)).default([]),
  buildPlan: wordLimited("The build plan"),
  strikePlan: wordLimited("The strike & Leave No Trace plan"),
  grantInterest: z.boolean().default(false),
  submit: z.boolean().default(false),
  confirmWarnings: z.boolean().default(false),
});

export type ArtworkRegistrationValues = z.infer<
  typeof ArtworkRegistrationInput
>;

export type ArtworkRegistrationActionResult =
  | { status: "created"; slug: string }
  | { status: "updated"; slug: string }
  | { status: "error"; message: string }
  | { status: "warn"; warnings: string[] };

export function artworkSubmitGate(
  input: ArtworkRegistrationValues,
): string | null {
  if (!input.artist) return "Who's making it? Name the artist or collective.";
  if (!input.description) {
    return "Describe the artwork — this is what the Art crew and the WTF Guide read.";
  }
  if (
    input.widthM === null ||
    input.depthM === null ||
    input.heightM === null
  ) {
    return "Give the footprint in metres — width, depth and height.";
  }
  if (input.burnIntent === null) {
    return "Say whether the piece is intended to burn (all burns need approval).";
  }
  if (!input.buildPlan) return "Add a build plan — how it gets made on site.";
  if (!input.strikePlan) {
    return "Add a strike & Leave No Trace plan. Pack it in, pack it out.";
  }
  return null;
}

/** Render the footprint for `registrations.s4_area_dimensions` (metres, per
 * AfrikaBurn's structural-safety guidance: "present all dimensions in meters"). */
function formatFootprint(
  width: number | null,
  depth: number | null,
  height: number | null,
): string | null {
  if (width === null || depth === null || height === null) return null;
  return `${width} m W × ${depth} m D × ${height} m H`;
}

/** Map parsed input → the mirrored `registrations` columns + self-describing
 * answer payload. Shared by create and edit so the two never drift. */
export function buildArtworkPayload(input: ArtworkRegistrationValues): {
  description: string | null;
  columns: {
    imageUrls: string[];
    areaDimensions: string | null;
    placementNotes: string | null;
    lntPlan: string | null;
    grantsInterest: boolean;
  };
  answers: QuestionnaireResponses;
} {
  return {
    description: input.description ?? null,
    columns: {
      imageUrls: input.imageUrls,
      areaDimensions: formatFootprint(
        input.widthM,
        input.depthM,
        input.heightM,
      ),
      placementNotes: input.placementNotes ?? null,
      lntPlan: input.strikePlan ?? null,
      grantsInterest: input.grantInterest,
    },
    answers: {
      artist_or_collective: input.artist ?? "",
      description: input.description ?? "",
      images: input.imageUrls,
      width_m: input.widthM,
      depth_m: input.depthM,
      height_m: input.heightM,
      placement_notes: input.placementNotes ?? "",
      burn_intent: input.burnIntent,
      power_needs: [...new Set(input.powerNeeds)],
      build_plan: input.buildPlan ?? "",
      strike_plan: input.strikePlan ?? "",
      grant_interest: input.grantInterest,
    },
  };
}
