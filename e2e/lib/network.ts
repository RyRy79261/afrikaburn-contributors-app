import type { Page, Request, Response } from "@playwright/test";

/**
 * Wait for the page's network to go quiet after an in-page (soft) navigation.
 *
 * `page.waitForLoadState("networkidle")` CANNOT do this. Playwright records
 * lifecycle states per DOCUMENT, and a Next.js `router.push()` does not load a
 * new document — so once the page you started on has been idle for 500ms, the
 * state is already recorded and the wait resolves at once, whatever the router
 * is still fetching. Measured on 26 Sep 2026: with a 3s fetch in flight after a
 * `history.pushState`, `waitForLoadState("networkidle")` returned in 1ms.
 *
 * So this counts requests itself. Call it BEFORE the action that navigates, so
 * the requests that action causes are seen from their first byte, then await
 * `settled()` once the URL has moved on:
 *
 *   const network = trackRequests(page);
 *   await submit.click();
 *   await expect(page).not.toHaveURL(signInRoute);
 *   await network.settled();
 *
 * A request counts as done when its RESPONSE ARRIVES, not when its body has
 * finished downloading. Next's router reads RSC payloads as a stream, and in CI
 * (26 Sep 2026) the `?_rsc=` fetches after every sign-in never fired
 * `requestfinished` at all, although the server closes them in well under a
 * second — so waiting for the body timed out on every shard that signs in.
 * What the caller races is the router's navigation, and that is outstanding
 * until the server answers; a response in hand is the signal that matters.
 *
 * ONLY NAVIGATION REQUESTS ARE TRACKED — `fetch`, `xhr` and `document`, which
 * is what the router's RSC requests are. Static assets are not: a JS chunk
 * served from cache was seen in CI (26 Sep 2026) never reporting a response at
 * all, and no script, stylesheet, image or font can abort a caller's `goto`.
 * Any of `response`, `requestfinished` or `requestfailed` ends a request.
 *
 * Next's LINK PREFETCHES are ignored too. The sign-in page prefetches its own links
 * (`/auth/sign-up`, `/auth/forgot-password`, `/`), and when the page navigates
 * away Chromium abandons them with neither a response nor a `requestfailed` —
 * seen in CI on 26 Sep 2026 — so they would sit "pending" forever. A prefetch is
 * not a navigation, so a caller's `goto` cannot be aborted by one; it is safe to
 * leave out. Next marks them with the `Next-Router-Prefetch` header.
 *
 * `settled()` resolves once nothing has been awaiting a response for `quietMs`,
 * and fails LOUDLY on timeout, naming the requests still pending — a server
 * that never answers should be a readable error, not a mystery 20-second hang.
 *
 * A REQUEST PENDING LONGER THAN `staleMs` NO LONGER HOLDS THE WAIT. When the
 * auth forms' `router.refresh()` supersedes the `router.push()` it follows, the
 * router drops the push's `?_rsc=` fetch and Chromium reports nothing for it:
 * no response, no `requestfinished`, no `requestfailed`. CI on 26 Sep 2026
 * (PRs #73 and #74, and `main` itself) failed sign-in after sign-in on exactly
 * that, with "still pending: http://localhost:3000/?_rsc=…" after 20s, while
 * the landing page had rendered. An abandoned request cannot abort the caller's
 * next `goto`, so once it is `staleMs` old it is logged and left out. A server
 * that is merely slow still holds the wait for `staleMs`, and whatever it
 * failed to serve is caught by the caller's next assertion.
 */
export function trackRequests(page: Page): {
  settled: (opts?: {
    quietMs?: number;
    timeout?: number;
    staleMs?: number;
  }) => Promise<void>;
} {
  // Each pending request, with the time it started.
  const pending = new Map<Request, number>();
  let lastChange = Date.now();
  const started = (r: Request) => {
    if (!NAVIGATION_TYPES.has(r.resourceType()) || isPrefetch(r)) return;
    pending.set(r, Date.now());
    lastChange = Date.now();
  };
  const ended = (r: Request) => {
    pending.delete(r);
    lastChange = Date.now();
  };
  const answered = (r: Response) => ended(r.request());
  page.on("request", started);
  page.on("response", answered);
  page.on("requestfinished", ended);
  page.on("requestfailed", ended);

  return {
    async settled({ quietMs = 500, timeout = 20_000, staleMs = 5_000 } = {}) {
      const deadline = Date.now() + timeout;
      const live = () => {
        const now = Date.now();
        return [...pending].filter(([, since]) => now - since < staleMs);
      };
      try {
        while (live().length > 0 || Date.now() - lastChange < quietMs) {
          if (Date.now() > deadline) {
            const urls = live()
              .map(([r]) => r.url())
              .join(", ");
            throw new Error(
              `network did not settle within ${timeout}ms; still pending: ${urls || "(none — requests kept starting)"}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (pending.size > 0) {
          const urls = [...pending.keys()].map((r) => r.url()).join(", ");
          console.warn(
            `[e2e] settled(): left out ${pending.size} request(s) pending over ${staleMs}ms (abandoned by the router): ${urls}`,
          );
        }
      } finally {
        page.off("request", started);
        page.off("response", answered);
        page.off("requestfinished", ended);
        page.off("requestfailed", ended);
      }
    },
  };
}

const NAVIGATION_TYPES = new Set(["fetch", "xhr", "document"]);

function isPrefetch(r: Request): boolean {
  const headers = r.headers();
  return (
    "next-router-prefetch" in headers ||
    "next-router-segment-prefetch" in headers
  );
}
