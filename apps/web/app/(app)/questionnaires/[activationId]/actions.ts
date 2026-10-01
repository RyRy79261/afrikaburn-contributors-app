"use server";

import { z } from "zod";
import type { SaveResult } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { submitResponse } from "@/lib/questionnaire-store";
import { saveOnboardingProgress } from "@/lib/onboarding-store";

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

const ProgressInput = z.object({
  activationId: z.string().uuid(),
  acknowledged: z.array(z.string().min(1).max(200)).max(50),
});

/**
 * Record how far the signed-in member has got through a camp onboarding (Ryan,
 * 1 Oct 2026: leads see partial progress). Best-effort: the runner fires this
 * as the member goes and never waits on it. The store refuses anyone who was
 * not sent this onboarding, or whose action is no longer pending, and clamps
 * the report to the onboarding's own steps and boxes.
 */
export async function saveOnboardingProgressAction(
  input: unknown,
): Promise<{ ok: boolean }> {
  const parsed = ProgressInput.safeParse(input);
  if (!parsed.success) return { ok: false };
  const user = await requireCampUser();
  const ok = await saveOnboardingProgress({
    activationId: parsed.data.activationId,
    userId: user.id,
    report: { acknowledged: parsed.data.acknowledged },
  });
  return { ok };
}
