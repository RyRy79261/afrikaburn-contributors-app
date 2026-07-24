import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";

/**
 * Neon Auth (Better Auth) server instance for the supplier portal.
 *
 * INTENTIONALLY identical to `apps/web/lib/neon-auth.ts` and
 * `apps/org/lib/neon-auth.ts`: all three apps share one Neon Auth deployment
 * (same `NEON_AUTH_BASE_URL`) and one cookie secret, so a session established in
 * any app is recognised by the others — email overlap is exactly what links a
 * burner account to a supplier row (see `lib/session.ts`). In production the
 * apps are served under a shared registrable domain so the session cookie is
 * sent to all; see the deployment notes.
 *
 * Build-time fallbacks let `next build` succeed WITHOUT env vars set (the secret
 * must be ≥ 32 chars or createNeonAuth throws on import). Any real request
 * without configured env fails only when it reaches the Neon Auth API — the app
 * boots and the landing renders regardless.
 */
const PLACEHOLDER_BASE_URL = "https://build-placeholder.neon-auth.invalid";
const PLACEHOLDER_COOKIE_SECRET =
  "build-placeholder-secret-build-placeholder-secret"; // 50 chars

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL ?? PLACEHOLDER_BASE_URL,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET ?? PLACEHOLDER_COOKIE_SECRET,
    sameSite: "lax",
  },
});
