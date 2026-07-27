import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@quagga/auth";
import { isAuthConfigured } from "@/lib/config";

/** Minimal authenticated-user shape used across the app. */
export interface AuthenticatedUser {
  id: string;
  primaryEmail: string | null;
  displayName: string | null;
  /** Whether the auth provider has verified `primaryEmail`. Gates god bootstrap. */
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
 * (@quagga/auth, mounted in-process — a zero-network-hop DB read). Returns null
 * (never throws) when auth isn't configured or the session read fails, so the
 * landing page and any public surface render env-lessly.
 *
 * `cache()` scopes the result to ONE request. A single page render asks for the
 * session from several places — the layout's chrome, the page's own guard, the
 * unread-count query — and each was a separate session read. The cache is
 * per-request and per-render, never shared between users: React discards it when
 * the request ends, so there is no window in which one burner's session could be
 * handed to another.
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

/** As above, but redirect to sign-in when unauthenticated. */
export async function getAuthenticatedUserOrRedirect(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in");
  return user;
}
