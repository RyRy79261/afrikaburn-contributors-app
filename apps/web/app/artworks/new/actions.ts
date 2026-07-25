"use server";

import { z } from "zod";
import { CAMP_DESCRIPTION_WORD_LIMIT, isWithinWordLimit } from "@quagga/core";
import { MAX_LAYOUT_UPLOADS, type QuestionnaireResponses } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { checkCampName } from "@/lib/groups-store";
import { createProjectRegistration } from "@/lib/project-registration-store";
import { ARTWORK_POWER_KEYS } from "./copy";

// Art project registration (canvas §d3pOJI / H2DP4 · docs/synthesis.md "art
// project registration draws on the participate/ARTeria/fire-safety pages").
// Registration is an invitation, not a requirement — but burning, sound,
// placement, the WTF Guide and grant eligibility all depend on it, so the
// submit gate asks only for what those decisions need.

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

const ArtworkRegistrationInput = z.object({
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

export type ArtworkRegistrationActionResult =
  | { status: "created"; slug: string }
  | { status: "error"; message: string }
  | { status: "warn"; warnings: string[] };

function submitGate(
  input: z.infer<typeof ArtworkRegistrationInput>,
): string | null {
  if (!input.artist) return "Who's making it? Name the artist or collective.";
  if (!input.description) {
    return "Describe the artwork — this is what the Art crew and the WTF Guide read.";
  }
  if (input.widthM === null || input.depthM === null || input.heightM === null) {
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

/**
 * Register (or draft) an art project. Creates the `artwork` group via the
 * shared `/camps/new` path, then its registration row + answer payload.
 * Server-side authz: `requireCampUser` — the creator must be signed in, and
 * becomes the project's lead.
 */
export async function createArtworkRegistrationAction(
  raw: unknown,
): Promise<ArtworkRegistrationActionResult> {
  const parsed = ArtworkRegistrationInput.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid artwork details.",
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

  const check = await checkCampName(input.name, "artwork");
  if (!check.ok) {
    return {
      status: "error",
      message: "An art project already uses that name. Pick another.",
    };
  }
  if (check.warnings.length > 0 && !input.confirmWarnings) {
    return { status: "warn", warnings: check.warnings };
  }

  const footprint = formatFootprint(input.widthM, input.depthM, input.heightM);

  const answers: QuestionnaireResponses = {
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
  };

  const result = await createProjectRegistration({
    creatorId: user.id,
    creatorEmail: user.email,
    editionId: edition.id,
    kind: "artwork",
    name: input.name,
    description: input.description ?? null,
    submit: input.submit,
    columns: {
      imageUrls: input.imageUrls,
      areaDimensions: footprint,
      placementNotes: input.placementNotes ?? null,
      lntPlan: input.strikePlan ?? null,
      grantsInterest: input.grantInterest,
    },
    answers,
  });
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "created", slug: result.slug };
}
