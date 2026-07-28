"use client";

import { INVITE_RESUME_PATH } from "@quagga/core";

/** The subset of `useRouter()` this helper needs. */
export interface PushRouter {
  push: (href: string) => void;
  refresh: () => void;
}

/**
 * Navigate after a step that changed server-side state the whole document
 * depends on — a freshly minted session, or a blocking gate that just cleared.
 *
 * `/join/continue` gets a FULL-DOCUMENT navigation rather than a soft push. It
 * is a page now (the write moved to a server action on a confirm button), but a
 * soft push would render it against the RSC cache from before the session
 * existed, so it could read as signed-out and bounce a freshly signed-in visitor
 * back to the auth form. A hard navigation guarantees the request carries the
 * new session cookie. Everything else keeps the soft push + refresh.
 *
 * ## Why the push/refresh pair is DEFERRED a macrotask
 *
 * Every caller reaches this from inside `startTransition(async () => …)` — the
 * save happens in the transition and the navigation is what follows a
 * successful save. Called synchronously from in there, the transition is left
 * awaiting a navigation that the same-tick `refresh()` supersedes, so it never
 * settles and `isPending` stays true for good. What that looks like to a
 * participant: a Submit button stuck on "Saving…" on something that HAS been
 * saved, and no redirect. On the blocking questionnaire gate it meant being
 * held on a gate they had already cleared, with nothing to click.
 *
 * Deferring lets the transition resolve first, so the pending state clears and
 * the pair runs on its own tick. Proved by bisection on 28 Jul against a
 * production build: push-only fixed it, push+refresh-inside-transition hung,
 * push+refresh-deferred fixed it and KEPT the refresh — which matters, because
 * the refresh is what re-renders the app shell above the pushed route, and that
 * is how the navigation comes back after a gate clears (AppShell `gatedNav`).
 *
 * IT LIVES HERE, not at the call sites. The first fix deferred it inside
 * questionnaire `runner.tsx` alone, and left the identical construct live in
 * `bio-flow.tsx` — where "Save changes" on the profile bio editor stuck on
 * "Saving…" in exactly the same way. Two copies of a rule is how the
 * notification `linkApp` bug happened as well. One seam, one rule.
 */
export function navigateOnwards(router: PushRouter, href: string): void {
  if (href === INVITE_RESUME_PATH) {
    window.location.assign(href);
    return;
  }
  setTimeout(() => {
    router.push(href);
    router.refresh();
  }, 0);
}
