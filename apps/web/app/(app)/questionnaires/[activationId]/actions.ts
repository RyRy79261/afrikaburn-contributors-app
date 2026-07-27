"use server";

import { z } from "zod";
import type { SaveResult } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { submitResponse } from "@/lib/questionnaire-store";

const SubmitInput = z.object({ activationId: z.string().uuid() });

/**
 * Submit a member's answers to an activation (project- OR org-authored — the
 * flow is identical). Validates against the definition inside the store, saves
 * the response, and flips the required action to completed (clearing the gate).
 */
export async function submitQuestionnaireAction(
  activationId: unknown,
  responses: unknown,
): Promise<SaveResult> {
  const parsed = SubmitInput.safeParse({ activationId });
  if (!parsed.success) {
    return { ok: false, errors: { _form: "Invalid questionnaire." } };
  }
  const user = await requireCampUser();
  return submitResponse({
    userId: user.id,
    activationId: parsed.data.activationId,
    rawResponses: responses,
  });
}
