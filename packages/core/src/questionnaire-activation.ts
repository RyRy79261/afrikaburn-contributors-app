// Questionnaire activation lifecycle (questionnaire-spec §"Engine mechanics").
// An ACTIVATION = definition × edition × audience × options. Activating it
// resolves the audience (see ./audience) into `required_actions` rows keyed
// `questionnaire:<activation_id>`; submitting a response flips that row to
// completed and stamps the response's `activationId`.
//
// Pure builders only — the caller performs the inserts/updates. Keeping the
// row-shaping here makes the gate/notification loop unit-testable and keeps the
// key convention in one place.

/**
 * Resolve the definition an activation must be rendered / validated / aggregated
 * against. The SNAPSHOT taken at activation time is authoritative: it is what the
 * respondents were actually shown, so editing (or re-versioning) the live
 * definition afterwards must never change it. The `liveFallback` is used ONLY for
 * pre-snapshot activation rows (activated before the snapshot column existed,
 * where `snapshot` is null) so no backfill is required.
 *
 * Generic over the definition shape so both apps and tests can call it without a
 * @quagga/types dependency here; callers pass `Questionnaire` values.
 */
export function resolveActivationDefinition<T>(
  snapshot: T | null | undefined,
  liveFallback: T,
): T {
  return snapshot ?? liveFallback;
}

/** The `required_actions.action_key` for an activation. One key per activation
 * per user — the unique constraint on (user_id, action_key) dedupes re-sends. */
export function activationRequiredActionKey(activationId: string): string {
  return `questionnaire:${activationId}`;
}

/** Parse an activation id back out of a `questionnaire:<id>` action key, or
 * null if the key is not a questionnaire-activation key. */
export function parseActivationActionKey(actionKey: string): string | null {
  const prefix = "questionnaire:";
  return actionKey.startsWith(prefix)
    ? actionKey.slice(prefix.length) || null
    : null;
}

/** Shape of an activation the builders read (a trimmed activation row). */
export interface ActivationLike {
  id: string;
  title: string;
  blocking: boolean;
  dueAt: Date | null;
}

/** A `required_actions` insert row (minus DB-defaulted columns). */
export interface RequiredActionInsert {
  userId: string;
  type: "questionnaire";
  actionKey: string;
  activationId: string;
  title: string;
  blocking: boolean;
  status: "pending";
  dueAt: Date | null;
}

/**
 * Build the `required_actions` rows for an activation against an already-
 * resolved audience. De-duplicates user ids defensively so a caller passing a
 * raw (non-`resolveAudience`) list still yields one row per user.
 */
export function buildActivationRequiredActions(
  activation: ActivationLike,
  userIds: readonly string[],
): RequiredActionInsert[] {
  const actionKey = activationRequiredActionKey(activation.id);
  const seen = new Set<string>();
  const rows: RequiredActionInsert[] = [];
  for (const userId of userIds) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    rows.push({
      userId,
      type: "questionnaire",
      actionKey,
      activationId: activation.id,
      title: activation.title,
      blocking: activation.blocking,
      status: "pending",
      dueAt: activation.dueAt,
    });
  }
  return rows;
}

/** The patch that flips a required action to completed on response submit. */
export interface RequiredActionCompletion {
  status: "completed";
  completedAt: Date;
}

/** Build the completion patch for a submitted response (default now). */
export function completeRequiredAction(now: Date = new Date()): RequiredActionCompletion {
  return { status: "completed", completedAt: now };
}

/** Shape of a submitted response the completion check reads. */
export interface ResponseLike {
  activationId: string | null;
  completedAt: Date | null;
}

/** True when a response fully satisfies its activation (submitted + linked). */
export function isActivationResponseComplete(
  activationId: string,
  response: ResponseLike | null | undefined,
): boolean {
  return (
    response != null &&
    response.activationId === activationId &&
    response.completedAt != null
  );
}

/** Author-side completion tally for one activation. */
export interface ActivationCompletion {
  sent: number;
  completed: number;
  pending: number;
}

/**
 * Tally sent / completed / pending from the activation's `required_actions`
 * rows. Anything not `completed` (pending/waived/expired) counts as outstanding
 * for the author's "who still owes us" view; `completed` is the done set.
 */
export function tallyActivationCompletion(
  actions: readonly { status: string }[],
): ActivationCompletion {
  const sent = actions.length;
  const completed = actions.filter((a) => a.status === "completed").length;
  return { sent, completed, pending: sent - completed };
}
