import "server-only";

import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import type { RequiredActionLike } from "@quagga/core";
import {
  BURNER_BIO_ACTION_KEY,
  isParticipantFacingActivation,
  parseActivationActionKey,
} from "@quagga/core";
import { db, schema } from "./db";

// The code-side action-key → route registry (build-spec: the DB stores the key,
// never the component). Only keys with a built page appear here.
const ACTION_ROUTES: Record<string, string> = {
  [BURNER_BIO_ACTION_KEY]: "/onboarding",
};

/**
 * Route that satisfies a required-action key, or null if none is built. Static
 * keys (the Burner Bio) come from the registry; questionnaire-activation keys
 * (`questionnaire:<id>`) route dynamically to the shared fill page — this is
 * what lets BOTH org-outbound and project-authored activations gate/land here.
 */
export function actionRoute(actionKey: string): string | null {
  const activationId = parseActivationActionKey(actionKey);
  if (activationId) return `/questionnaires/${activationId}`;
  return ACTION_ROUTES[actionKey] ?? null;
}

/** Ensure a pending `required_actions` row exists for this user + key. Idempotent
 * (unique on user+action_key); a completed row is left untouched. */
export async function ensureRequiredAction(input: {
  userId: string;
  actionKey: string;
  type: "questionnaire" | "acknowledgement" | "payment" | "profile_update";
  title: string;
  blocking?: boolean;
}): Promise<void> {
  await db()
    .insert(schema.requiredActions)
    .values({
      userId: input.userId,
      actionKey: input.actionKey,
      type: input.type,
      title: input.title,
      blocking: input.blocking ?? true,
      status: "pending",
    })
    .onConflictDoNothing({
      target: [schema.requiredActions.userId, schema.requiredActions.actionKey],
    });
}

/** Mark a required action completed for a user. No-op if it doesn't exist. */
export async function completeRequiredAction(
  userId: string,
  actionKey: string,
): Promise<void> {
  await db()
    .update(schema.requiredActions)
    .set({ status: "completed", completedAt: new Date() })
    .where(
      and(
        eq(schema.requiredActions.userId, userId),
        eq(schema.requiredActions.actionKey, actionKey),
      ),
    );
}

/**
 * All of a user's required actions, oldest first — the participant-app gating
 * spine reads this. Org-INTERNAL questionnaire activations are excluded: they
 * gate the org console only and must never gate/route the participant app, even
 * for an org_staff/god who is also a camp user (spec §"Authoring levels").
 * Rows with no activation (the Burner Bio) are kept via the LEFT JOIN + null
 * audience.
 *
 * Request-scoped (`cache`): the hard gate consults this on essentially every
 * gated surface, and several pages ask twice (once through `enforceGate`, once
 * to render the pending-questionnaire card). Same user, same request, same
 * answer — one query.
 */
export const listRequiredActions = cache(async function listRequiredActions(
  userId: string,
): Promise<RequiredActionLike[]> {
  const rows = await db()
    .select({
      actionKey: schema.requiredActions.actionKey,
      blocking: schema.requiredActions.blocking,
      status: schema.requiredActions.status,
      audience: schema.questionnaireActivations.audience,
      // CLOSING AN ACTIVATION MUST RELEASE ITS GATE. `closeActivation` flips
      // `questionnaire_activations.status` to "closed" and leaves the
      // `required_actions` rows `pending` — and this query never read that
      // column, so a closed questionnaire went on hard-gating every recipient
      // out of the whole app with no way back. "Close" is the ONLY undo for a
      // mis-sent blocking send; it has to mean it.
      //
      // Read here rather than by expiring the action rows, so it is also right
      // for rows written before the fix, and so reopening an activation
      // restores the gate rather than needing a second migration of state.
      activationStatus: schema.questionnaireActivations.status,
    })
    .from(schema.requiredActions)
    .leftJoin(
      schema.questionnaireActivations,
      eq(
        schema.questionnaireActivations.id,
        schema.requiredActions.activationId,
      ),
    )
    .where(eq(schema.requiredActions.userId, userId))
    .orderBy(asc(schema.requiredActions.createdAt));
  return rows
    .filter((r) => isParticipantFacingActivation(r.audience))
    .map(({ actionKey, blocking, status, activationStatus }) => ({
      actionKey,
      // A row whose activation is no longer open still EXISTS (it stays in the
      // inbox and in the audit trail) but it cannot block. `activationStatus`
      // is null for non-questionnaire actions like the Burner Bio, which have
      // no activation and must keep blocking.
      blocking:
        blocking && (activationStatus === null || activationStatus === "open"),
      status,
    }));
});
