import "server-only";

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
 */
export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  if (!isAuthConfigured()) return null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    return toAuthenticatedUser(session?.user);
  } catch {
    return null;
  }
}

/** As above, but redirect to sign-in when unauthenticated. */
export async function getAuthenticatedUserOrRedirect(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in");
  return user;
}
