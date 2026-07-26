"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Self-hosted Better Auth client (@quagga/auth is mounted at this portal's own
 * /api/auth/* by app/api/auth/[...all]/route.ts). Same-origin fetches — no base
 * URL needed. Used by the branded sign-in / sign-up views and the sign-out
 * button. A session established here shares the cross-subdomain cookie with the
 * participant and organiser apps (see @quagga/auth crossSubDomainCookies), which
 * is how email overlap can link a burner account to a supplier row.
 */
export const authClient = createAuthClient();
