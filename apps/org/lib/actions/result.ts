// Shared result shape for the console's server actions. Actions never throw to
// the client — they catch, and return a discriminated result the caller toasts.

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Wrap an action body: run it, coerce thrown Errors into a failed result. */
export async function runAction(
  fn: () => Promise<void>,
): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Something went wrong. Try again.";
    return { ok: false, error };
  }
}

/** A result that carries data back to the caller on success. */
export type ActionResultOf<T> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * `runAction` for an action whose caller needs the values that were actually
 * written — the normalized form, not the text that was typed.
 *
 * Without this a form keeps whatever the user entered while the database holds
 * something else, so the field shows a value that was never stored and the Save
 * button stays enabled against no remaining change.
 */
export async function runActionWith<T>(
  fn: () => Promise<T>,
): Promise<ActionResultOf<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Something went wrong. Try again.";
    return { ok: false, error };
  }
}
