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
 */
export function navigateOnwards(router: PushRouter, href: string): void {
  if (href === INVITE_RESUME_PATH) {
    window.location.assign(href);
    return;
  }
  router.push(href);
  router.refresh();
}
