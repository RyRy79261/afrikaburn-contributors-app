import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type { RequiredActionLike } from "@quagga/core";
import { BURNER_BIO_ACTION_KEY } from "@quagga/core";
import { db, schema } from "./db";

// The code-side action-key → route registry (build-spec: the DB stores the key,
// never the component). Only keys with a built page appear here.
const ACTION_ROUTES: Record<string, string> = {
  [BURNER_BIO_ACTION_KEY]: "/onboarding",
};

/** Route that satisfies a required-action key, or null if none is built. */
export function actionRoute(actionKey: string): string | null {
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

/** All of a user's required actions, oldest first — the gating spine reads this. */
export async function listRequiredActions(
  userId: string,
): Promise<RequiredActionLike[]> {
  const rows = await db()
    .select({
      actionKey: schema.requiredActions.actionKey,
      blocking: schema.requiredActions.blocking,
      status: schema.requiredActions.status,
    })
    .from(schema.requiredActions)
    .where(eq(schema.requiredActions.userId, userId))
    .orderBy(asc(schema.requiredActions.createdAt));
  return rows;
}
