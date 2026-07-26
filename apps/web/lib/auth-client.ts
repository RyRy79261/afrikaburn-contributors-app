"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

/**
 * Self-hosted Better Auth client (@quagga/auth is mounted at this app's own
 * /api/auth/* by app/api/auth/[...all]/route.ts). Same-origin fetches — no base
 * URL needed. Use from client components:
 *   const { data: session } = authClient.useSession();
 *   await authClient.signIn.email({ email, password });
 *   await authClient.signIn.social({ provider: "google" });
 *
 * Plugin clients mirror the server plugins wired in @quagga/auth (migration 0015):
 *   - twoFactorClient: authClient.twoFactor.enable / verifyTotp / verifyBackupCode
 *     / disable / generateBackupCodes, and the sign-in second-factor challenge.
 *   - passkeyClient: authClient.passkey.addPasskey / deletePasskey,
 *     authClient.signIn.passkey, authClient.useListPasskeys().
 * A session established here shares the cross-subdomain cookie with org. and
 * suppliers., and one apex-scoped passkey works across all three.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), passkeyClient()],
});
