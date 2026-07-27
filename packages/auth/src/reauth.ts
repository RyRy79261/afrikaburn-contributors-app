// Re-authentication marker.
//
// `requestAccountDeletion` proves it is really you by calling
// `auth.api.signInEmail` with the password you just typed. That is a genuine
// sign-in as far as Better Auth is concerned, so it mints a session row and
// fires `databaseHooks.session.create.after` — the hook that cancels a pending
// deletion. Without a marker, asking to delete an account that is ALREADY
// scheduled would silently cancel the existing request (and mail the burner a
// "your deletion was cancelled" notice) on the way to refusing them.
//
// A password check is not a return. Wrap those calls in `withReauth` and the
// hook stands down.

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<true>();

/**
 * Run `fn` marked as a re-authentication: any session created inside it is a
 * credential check, not the burner coming back, so sign-in side effects are
 * suppressed. The marker is async-context-scoped — concurrent requests cannot
 * see each other's.
 */
export function withReauth<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(true, fn);
}

/** True when the current async context is inside `withReauth`. */
export function isReauth(): boolean {
  return store.getStore() === true;
}
