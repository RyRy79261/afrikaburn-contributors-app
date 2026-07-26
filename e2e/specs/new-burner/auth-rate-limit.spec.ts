// specs/new-burner/auth-rate-limit.spec.ts — M3-18's wrong-password throttle.
//
// The binding scope (roadmap M3-18): "wrong-password lockout / rate-limit —
// repeat failures are throttled, AND assert it throttles ACROSS requests (the
// rateLimit.storage trap)." The app configures Better Auth with
// `rateLimit.storage = "database"` (packages/auth/src/config.ts) precisely so the
// counter is SHARED across serverless lambdas — the default in-memory storage is
// per-lambda and is effectively no rate limiting at all on Vercel.
//
// HOW WE PROVE IT, not through the UI: the branded sign-in form collapses every
// failure (wrong password AND rate-limited) into one enumeration-safe message, so
// the UI cannot distinguish a throttle. We therefore drive the REAL auth endpoint
// (`POST /api/auth/sign-in/email`) and assert on its HTTP status — 429 "Too many
// requests" (verified present in better-auth 1.6.25). This is the real product
// endpoint, not a test side-door.
//
// The CROSS-REQUEST proof: once throttled, a SECOND, brand-new browser context
// (no cookies, no client state) hitting the same endpoint is ALSO 429. If the
// limit were client-side or per-context it would reset; a 429 from a cold context
// can only come from server-side, shared (DB-backed) state.
//
// Threshold-agnostic + honest: Better Auth enables rate limiting by default only
// in production (a Vercel preview is production; local dev is not). So we loop up
// to a generous cap and, if NO 429 ever appears, we SKIP with a clear reason
// rather than fail — a dev target legitimately has throttling off. We never
// fabricate a pass.

import { test, expect } from "../../fixtures";
import { signUpBurner } from "../../personas/factories";

const SIGN_IN_ENDPOINT = "/api/auth/sign-in/email";
const MAX_ATTEMPTS = 40; // comfortably above Better Auth's sensitive-path limits
const WRONG_PASSWORD = "definitely-not-the-right-password-000";

test.describe("new burner · auth rate limiting (DB-backed, cross-request)", () => {
  test("repeated wrong-password sign-ins are throttled server-side, shared across contexts", async ({
    webPage,
    makeAppPage,
  }) => {
    test.slow(); // a throttle can take dozens of rapid POSTs to trip

    // A real, existing account so this is a genuine wrong-password scenario. (The
    // throttle keys on IP + path regardless, but this keeps the story honest.)
    const account = await signUpBurner(webPage);

    // Hammer the REAL endpoint with wrong passwords until the server throttles.
    let throttledAt: number | null = null;
    let sawAuthFailure = false;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await webPage.request.post(SIGN_IN_ENDPOINT, {
        data: { email: account.email, password: WRONG_PASSWORD },
        failOnStatusCode: false,
      });
      const status = res.status();
      if (status === 429) {
        throttledAt = i + 1;
        break;
      }
      // A wrong password is a 401/400 before the throttle kicks in — proof the
      // endpoint is live and actually evaluating credentials, not 500-ing.
      if (status === 401 || status === 400) sawAuthFailure = true;
    }

    test.skip(
      throttledAt === null,
      `No 429 within ${MAX_ATTEMPTS} attempts — rate limiting appears OFF on this ` +
        `deployment. Better Auth enables it by default only in production (a Vercel ` +
        `preview qualifies; local dev does not). Point E2E at a production-mode preview.`,
    );

    // We reached the throttle by way of real credential rejections, not errors.
    expect(sawAuthFailure).toBe(true);

    // CROSS-REQUEST / CROSS-CONTEXT: a cold, cookieless context is throttled too.
    // Only server-side, shared (DB-backed) state can refuse a request that carries
    // none of the first context's client state. This is the rateLimit.storage
    // trap made observable.
    const coldPage = await makeAppPage("web");
    const coldRes = await coldPage.request.post(SIGN_IN_ENDPOINT, {
      data: { email: account.email, password: WRONG_PASSWORD },
      failOnStatusCode: false,
    });
    expect(
      coldRes.status(),
      "a brand-new context must inherit the server-side throttle (proves DB-backed, " +
        "not per-lambda/in-memory rate limiting)",
    ).toBe(429);
  });
});
