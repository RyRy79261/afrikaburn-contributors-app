"use client";

import type {
  Questionnaire,
  QuestionnaireResponses,
  SaveResult,
} from "@quagga/types";
import { QuestionnaireRunner } from "./runner";
import { submitQuestionnaireAction } from "@/app/(app)/questionnaires/[activationId]/actions";

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
  gate = false,
  respondentSeed,
  blobConfigured = false,
}: {
  activationId: string;
  questionnaire: Questionnaire;
  initialResponses: QuestionnaireResponses;
  redirectTo: string;
  submitLabel: string;
  /** Gate styling: answered-count progress + full-width submit (§Gate). */
  gate?: boolean;
  /** Per-respondent shuffle seed (the user id). Combined with the activation id
   * it keeps a shuffled page/option order stable across reloads. */
  respondentSeed?: string;
  /** Deployment has BLOB_READ_WRITE_TOKEN → file_link questions get a real
   *  uploader instead of only the URL-paste field. */
  blobConfigured?: boolean;
}) {
  const action = (responses: QuestionnaireResponses): Promise<SaveResult> =>
    submitQuestionnaireAction(activationId, responses);

  const seed = respondentSeed
    ? `${activationId}:${respondentSeed}`
    : activationId;

  return (
    <QuestionnaireRunner
      questionnaire={questionnaire}
      initialResponses={initialResponses}
      action={action}
      submitLabel={submitLabel}
      redirectTo={redirectTo}
      answeredProgress={gate}
      fullWidthSubmit={gate}
      shuffleSeed={seed}
      draftKey={seed}
      blobConfigured={blobConfigured}
    />
  );
}
