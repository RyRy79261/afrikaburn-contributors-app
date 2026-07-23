import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";

/**
 * Neon Auth (Better Auth) server instance. Configure via:
 *   - NEON_AUTH_BASE_URL      — your Neon Auth API URL (Neon Console → Auth)
 *   - NEON_AUTH_COOKIE_SECRET — at least 32 chars (`openssl rand -base64 32`)
 *
 * Build-time fallbacks let `next build` succeed WITHOUT env vars set (the
 * secret must be ≥ 32 chars or createNeonAuth throws on import). Any real
 * request made without the env configured fails loudly when it reaches the Neon
 * Auth API — the app boots and the landing page renders regardless.
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
