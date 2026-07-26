"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Self-hosted Better Auth client (@quagga/auth is mounted at this console's own
 * /api/auth/* by app/api/auth/[...all]/route.ts). Same-origin fetches — no base
 * URL needed. Used by the branded sign-in views and the console sign-out button.
 */
export const authClient = createAuthClient();
