"use server";

import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { checkCampName } from "@/lib/groups-store";
import { createProjectRegistration } from "@/lib/project-registration-store";
import {
  VehicleRegistrationInput,
  buildVehiclePayload,
  vehicleSubmitGate,
  type VehicleRegistrationActionResult,
} from "./shared";

// Mutant Vehicle registration (canvas §S8ZcWf / Qq5u0 · docs/synthesis.md
// "MV registration mirrors the real DMV process"). The Zod boundary, submit gate
// and payload builder live in ./shared (a "use server" file exports only async
// actions); this file owns the create action. Everything is optional at DRAFT;
// the submit gate is what the DMV actually needs before a wrangler picks it up.

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
    const gate = vehicleSubmitGate(input);
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

  const payload = buildVehiclePayload(input);
  const result = await createProjectRegistration({
    creatorId: user.id,
    creatorEmail: user.email,
    editionId: edition.id,
    kind: "mutant_vehicle",
    name: input.name,
    description: payload.description,
    submit: input.submit,
    columns: payload.columns,
    answers: payload.answers,
  });
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "created", slug: result.slug };
}
