// Shared result shape for the portal's server actions. Actions never throw to
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
