"use server";

import { PROJECT_ADMIN_ROLES } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import {
  getProjectRegistrationForEdit,
  updateProjectRegistration,
} from "@/lib/project-registration-store";
import {
  VehicleRegistrationInput,
  buildVehiclePayload,
  vehicleSubmitGate,
  type VehicleRegistrationActionResult,
} from "@/app/(app)/vehicles/new/shared";

// Edit + resubmit an existing Mutant Vehicle registration (roadmap M4-10; design
// note: MV/art register through their own forms, so they re-open through them too).
// Reuses the create form's Zod schema, submit gate and payload builder verbatim —
// the only difference is the WRITE target (update in place vs create a group).
//
// AUTHZ (server-side, the boundary): the project is resolved from the slug, the
// caller's role on THAT group is read, and only a lead/admin may edit. The state
// machine gate (`editable`) blocks edits once approved/rejected/withdrawn — the
// same draft/changes_requested window the camp wizard allows. The name is never
// changed here (renaming would re-key the URL); the locked name field is ignored.

export async function updateVehicleRegistrationAction(
  slug: string,
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

  const edition = await getActiveEdition();
  if (!edition) {
    return {
      status: "error",
      message: "No AfrikaBurn edition is open for registration yet.",
    };
  }

  const ctx = await getProjectRegistrationForEdit(
    slug,
    "mutant_vehicle",
    user.id,
    edition.id,
  );
  if (!ctx) {
    return { status: "error", message: "That mutant vehicle no longer exists." };
  }
  if (!ctx.role || !PROJECT_ADMIN_ROLES.includes(ctx.role)) {
    return {
      status: "error",
      message: "Only a project lead can edit this registration.",
    };
  }
  if (!ctx.editable) {
    return {
      status: "error",
      message: "This registration is locked and can't be edited right now.",
    };
  }

  if (input.submit) {
    const gate = vehicleSubmitGate(input);
    if (gate) return { status: "error", message: gate };
  }

  const payload = buildVehiclePayload(input);
  const result = await updateProjectRegistration({
    groupId: ctx.group.id,
    editionId: edition.id,
    kind: "mutant_vehicle",
    editorUserId: user.id,
    description: payload.description,
    submit: input.submit,
    columns: payload.columns,
    answers: payload.answers,
  });
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "updated", slug: result.slug };
}
