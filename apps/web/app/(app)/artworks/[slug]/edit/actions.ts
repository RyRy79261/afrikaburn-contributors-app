"use server";

import { z } from "zod";
import { PROJECT_ADMIN_ROLES } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import {
  getProjectRegistrationForEdit,
  updateProjectRegistration,
} from "@/lib/project-registration-store";
import { runProjectCarryForward } from "@/lib/project-carry-forward";
import type { ProjectCarryForwardResult } from "@/lib/project-registration-store";
import {
  ArtworkRegistrationInput,
  artworkSubmitGate,
  buildArtworkPayload,
  type ArtworkRegistrationActionResult,
} from "@/app/(app)/artworks/new/shared";

// Edit + resubmit an existing Art Project registration (roadmap M4-10). Reuses
// the create form's Zod schema, submit gate and payload builder; the difference
// is the WRITE target (update in place vs create a group).
//
// AUTHZ (server-side): project resolved from the slug; only its lead/admin may
// edit; the state machine blocks edits once approved/rejected/withdrawn (the same
// draft/changes_requested window the camp wizard allows). The name never changes.

export async function updateArtworkRegistrationAction(
  slug: string,
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

  const edition = await getActiveEdition();
  if (!edition) {
    return {
      status: "error",
      message: "No AfrikaBurn edition is open for registration yet.",
    };
  }

  const ctx = await getProjectRegistrationForEdit(
    slug,
    "artwork",
    user.id,
    edition.id,
  );
  if (!ctx) {
    return { status: "error", message: "That art project no longer exists." };
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
    const gate = artworkSubmitGate(input);
    if (gate) return { status: "error", message: gate };
  }

  const payload = buildArtworkPayload(input);
  const result = await updateProjectRegistration({
    groupId: ctx.group.id,
    editionId: edition.id,
    kind: "artwork",
    editorUserId: user.id,
    editorEmail: user.email,
    description: payload.description,
    submit: input.submit,
    columns: payload.columns,
    answers: payload.answers,
    safetyDocuments: payload.safetyDocuments,
  });
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "updated", slug: result.slug };
}

const CarryForwardSlug = z.string().trim().min(1).max(200);

/**
 * Bring this project's most recent prior registration across into this
 * edition's draft (CREATIVE-019). Lead/admin only, enforced in
 * `runProjectCarryForward`; what carries is @quagga/core's policy.
 */
export async function carryForwardArtworkRegistrationAction(
  slug: string,
): Promise<ProjectCarryForwardResult> {
  const parsed = CarryForwardSlug.safeParse(slug);
  if (!parsed.success) {
    return { ok: false, error: "That project isn't one we recognise." };
  }
  return runProjectCarryForward(parsed.data, "artwork");
}
