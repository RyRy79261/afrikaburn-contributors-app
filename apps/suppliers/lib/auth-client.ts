"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

/**
 * Self-hosted Better Auth client (@quagga/auth is mounted at this portal's own
 * /api/auth/* by app/api/auth/[...all]/route.ts). Same-origin fetches — no base
 * URL needed. Used by the branded sign-in / sign-up views, the sign-out button,
 * and the shared account-security surfaces. A session established here shares the
 * cross-subdomain cookie with the participant and organiser apps (see @quagga/auth
 * crossSubDomainCookies), which is how email overlap can link a burner account to
 * a supplier row.
 *
 * Plugin clients mirror the server plugins in @quagga/auth (migration 0015):
 * twoFactorClient (TOTP + backup codes, sign-in challenge) and passkeyClient
 * (WebAuthn). One apex-scoped passkey works across app./org./suppliers.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), passkeyClient()],
});
