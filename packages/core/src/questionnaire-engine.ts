// Questionnaire engine (build-spec §Schema questionnaire spine, ported 1:1 from
// Camp 404). The DB stores a `required_actions` row keyed by `action_key`; this
// module holds the pure gating helpers that decide "what blocks this user next".
// Routing keys → concrete routes stays in apps/web (it owns its route table);
// everything here is pure and unit-testable.
//
// This module also once held a code-side registry mapping an action key to its
// definition builder (`CODE_QUESTIONNAIRES` / `getCodeQuestionnaire` /
// `isCodeQuestionnaire`). Nothing ever resolved a questionnaire through it —
// apps/web calls `buildBurnerBioQuestionnaire` directly and treats
// `BURNER_BIO_ACTION_KEY` as a plain string — so it was removed. Add it back
// only when a SECOND code questionnaire makes the indirection buy something.

import type { AudienceSpec } from "@quagga/types";

/** The Burner Bio's `required_actions.action_key` — the one code questionnaire
 * in the MVP. Onboarding is gated on this being completed. */
export const BURNER_BIO_ACTION_KEY = "burner_bio";

/** Minimal shape the gating helpers need from a `required_actions` row. */
export interface RequiredActionLike {
  actionKey: string;
  blocking: boolean;
  status: "pending" | "completed" | "waived" | "expired";
}

/** The first pending, blocking required action (input order = priority), or
 * null when nothing blocks the user. This is the routing spine: apps/web maps
 * the returned action's key to a page. */
export function firstBlockingAction<T extends RequiredActionLike>(
  actions: readonly T[],
): T | null {
  for (const action of actions) {
    if (action.blocking && action.status === "pending") return action;
  }
  return null;
}

/**
 * Whether an activation may surface in the PARTICIPANT app (the hard gate, the
 * fill page, and the pending-questionnaires list). Org-INTERNAL activations
 * (`audience.kind === "org_internal"`) gate the ORG CONSOLE only and must NEVER
 * leak into the participant app — even when the targeted user is also a camp
 * user (an org_staff/god who is also a burner). Spec §"Authoring levels":
 * org-internal appears "never in the participant app". A row with no audience
 * (the code-side Burner Bio spine) is participant-facing.
 */
export function isParticipantFacingActivation(
  audience: AudienceSpec | null | undefined,
): boolean {
  return audience?.kind !== "org_internal";
}
