import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "@quagga/auth";
import { isAuthConfigured } from "@/lib/config";

/** Minimal authenticated-user shape used across the supplier portal. */
export interface AuthenticatedUser {
  id: string;
  primaryEmail: string | null;
  displayName: string | null;
  /** Whether the auth provider has verified `primaryEmail`. */
  emailVerified: boolean;
}

type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  emailVerified?: boolean | null;
};

function toAuthenticatedUser(
  user: SessionUser | null | undefined,
): AuthenticatedUser | null {
  if (!user?.id) return null;
  return {
    id: user.id,
    primaryEmail: user.email ?? null,
    displayName: user.name ?? null,
    emailVerified: user.emailVerified === true,
  };
}

/**
 * Read the current authenticated user from the self-hosted Better Auth session
 * (@quagga/auth, mounted in-process). Returns null (never throws) when auth
 * isn't configured or the session read fails, so the portal renders env-lessly
 * rather than crashing.
 *
 * `cache()` scopes it to ONE request: the layout, the page guard and any
 * per-user query each ask for the session, and each used to be its own read.
 * React tears the cache down with the request, so it can never be shared
 * between users.
 */
export const getAuthenticatedUser = cache(
  async (): Promise<AuthenticatedUser | null> => {
    if (!isAuthConfigured()) return null;
    try {
      const session = await auth.api.getSession({ headers: await headers() });
      return toAuthenticatedUser(session?.user);
    } catch {
      return null;
    }
  },
);
