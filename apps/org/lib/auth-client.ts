"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

/**
 * Self-hosted Better Auth client (@quagga/auth is mounted at this console's own
 * /api/auth/* by app/api/auth/[...all]/route.ts). Same-origin fetches — no base
 * URL needed. Used by the branded sign-in views, the console sign-out button, and
 * the shared account-security surfaces.
 *
 * Plugin clients mirror the server plugins in @quagga/auth (migration 0015):
 * twoFactorClient (TOTP + backup codes, sign-in challenge) and passkeyClient
 * (WebAuthn). One apex-scoped passkey works across app./org./suppliers.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), passkeyClient()],
});
