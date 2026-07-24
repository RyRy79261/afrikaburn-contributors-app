"use client";

import type {
  Questionnaire,
  QuestionnaireResponses,
  SaveResult,
} from "@quagga/types";
import { QuestionnaireRunner } from "./runner";
import { submitQuestionnaireAction } from "@/app/questionnaires/[activationId]/actions";

/**
 * Member-facing fill wrapper: binds the activation id to the shared
 * QuestionnaireRunner. Works the same for project- and org-authored
 * questionnaires — it only submits responses; the server validates + completes
 * the required action.
 */
export function QuestionnaireFill({
  activationId,
  questionnaire,
  initialResponses,
  redirectTo,
  submitLabel,
}: {
  activationId: string;
  questionnaire: Questionnaire;
  initialResponses: QuestionnaireResponses;
  redirectTo: string;
  submitLabel: string;
}) {
  const action = (
    responses: QuestionnaireResponses,
  ): Promise<SaveResult> => submitQuestionnaireAction(activationId, responses);

  return (
    <QuestionnaireRunner
      questionnaire={questionnaire}
      initialResponses={initialResponses}
      action={action}
      submitLabel={submitLabel}
      redirectTo={redirectTo}
    />
  );
}
