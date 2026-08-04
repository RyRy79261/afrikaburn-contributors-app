// Narrowing helpers for the portal's action results. Every server action
// returns a discriminated `{ ok } | { ok, error }`, and a test that writes
// `expect(result.ok).toBe(false)` then reaches for `result.error` fights the
// type checker for no benefit. These assert AND narrow, so the refusal MESSAGE
// — which is the control in several of these guards, not decoration — can be
// asserted directly.

type ActionLike = { ok: true; message?: string } | { ok: false; error: string };

/** Assert the action refused, and hand back the message it refused with. */
export function refusal(result: ActionLike): string {
  if (result.ok) {
    throw new Error("expected the action to refuse, but it reported success");
  }
  return result.error;
}

/** Assert the action succeeded, and hand back its message (if any). */
export function success(result: ActionLike): string | undefined {
  if (!result.ok) {
    throw new Error(`expected the action to succeed, but it refused: ${result.error}`);
  }
  return result.message;
}
