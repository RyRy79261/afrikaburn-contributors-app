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
 * `settled()` resolves once nothing has been awaiting a response for `quietMs`,
 * and fails LOUDLY on timeout, naming the requests still pending — a server
 * that never answers should be a readable error, not a mystery 20-second hang.
 */
export function trackRequests(page: Page): {
  settled: (opts?: { quietMs?: number; timeout?: number }) => Promise<void>;
} {
  const pending = new Set<Request>();
  let lastChange = Date.now();
  const started = (r: Request) => {
    pending.add(r);
    lastChange = Date.now();
  };
  const ended = (r: Request) => {
    pending.delete(r);
    lastChange = Date.now();
  };
  const answered = (r: Response) => ended(r.request());
  page.on("request", started);
  page.on("response", answered);
  page.on("requestfailed", ended);

  return {
    async settled({ quietMs = 500, timeout = 20_000 } = {}) {
      const deadline = Date.now() + timeout;
      try {
        while (pending.size > 0 || Date.now() - lastChange < quietMs) {
          if (Date.now() > deadline) {
            const urls = [...pending].map((r) => r.url()).join(", ");
            throw new Error(
              `network did not settle within ${timeout}ms; still pending: ${urls || "(none — requests kept starting)"}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        page.off("request", started);
        page.off("response", answered);
        page.off("requestfailed", ended);
      }
    },
  };
}
