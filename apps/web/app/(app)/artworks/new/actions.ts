"use server";

import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { checkCampName } from "@/lib/groups-store";
import { createProjectRegistration } from "@/lib/project-registration-store";
import {
  ArtworkRegistrationInput,
  artworkSubmitGate,
  buildArtworkPayload,
  type ArtworkRegistrationActionResult,
} from "./shared";

// Art project registration (canvas §d3pOJI / H2DP4 · docs/synthesis.md "art
// project registration draws on the participate/ARTeria/fire-safety pages").
// The Zod boundary, submit gate and payload builder live in ./shared (a
// "use server" file exports only async actions); this file owns the create
// action. Registration is an invitation, not a requirement — the submit gate
// asks only for what burn/sound/placement/grant decisions need.

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
    const gate = artworkSubmitGate(input);
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

  const payload = buildArtworkPayload(input);
  const result = await createProjectRegistration({
    creatorId: user.id,
    creatorEmail: user.email,
    editionId: edition.id,
    kind: "artwork",
    name: input.name,
    description: payload.description,
    submit: input.submit,
    columns: payload.columns,
    answers: payload.answers,
  });
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "created", slug: result.slug };
}
