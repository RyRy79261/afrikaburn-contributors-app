"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Self-hosted Better Auth client (@quagga/auth is mounted at this app's own
 * /api/auth/* by app/api/auth/[...all]/route.ts). Same-origin fetches — no base
 * URL needed. Use from client components:
 *   const { data: session } = authClient.useSession();
 *   await authClient.signIn.email({ email, password });
 *   await authClient.signIn.social({ provider: "google" });
 */
export const authClient = createAuthClient();
