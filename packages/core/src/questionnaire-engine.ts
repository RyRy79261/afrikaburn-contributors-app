// Questionnaire engine (build-spec §Schema questionnaire spine, ported 1:1 from
// Camp 404). The DB stores a `required_actions` row keyed by `action_key`; this
// module is the CODE-SIDE registry that maps a key to its definition, plus the
// pure gating helpers that decide "what blocks this user next". Routing keys →
// concrete routes stays in apps/web (it owns its route table); everything here
// is pure and unit-testable.

import type { Questionnaire } from "@quagga/types";
import { buildBurnerBioQuestionnaire } from "./bio";

/** The Burner Bio's `required_actions.action_key` — the one code questionnaire
 * in the MVP. Onboarding is gated on this being completed. */
export const BURNER_BIO_ACTION_KEY = "burner_bio";

/** Code-side registry: action key → definition builder. Future gated flows add
 * an entry here (BUILDER questionnaires instead live in the DB). */
const CODE_QUESTIONNAIRES: Record<string, () => Questionnaire> = {
  [BURNER_BIO_ACTION_KEY]: buildBurnerBioQuestionnaire,
};

/** Resolve a code questionnaire definition by key, or null if unregistered. */
export function getCodeQuestionnaire(key: string): Questionnaire | null {
  const build = CODE_QUESTIONNAIRES[key];
  return build ? build() : null;
}

/** Whether a key names a registered code questionnaire. */
export function isCodeQuestionnaire(key: string): boolean {
  return key in CODE_QUESTIONNAIRES;
}

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

/** True when at least one pending blocking action exists. */
export function hasPendingBlocker(
  actions: readonly RequiredActionLike[],
): boolean {
  return firstBlockingAction(actions) !== null;
}
