import "server-only";

import { redirect } from "next/navigation";
import { auth } from "@/lib/neon-auth";
import { isAuthConfigured } from "@/lib/config";

/** Minimal authenticated-user shape used across the app. */
export interface AuthenticatedUser {
  id: string;
  primaryEmail: string | null;
  displayName: string | null;
}

type SessionUser = { id: string; email?: string | null; name?: string | null };

function toAuthenticatedUser(
  user: SessionUser | null | undefined,
): AuthenticatedUser | null {
  if (!user?.id) return null;
  return {
    id: user.id,
    primaryEmail: user.email ?? null,
    displayName: user.name ?? null,
  };
}

/**
 * Read the current authenticated user. Returns null (never throws) when auth
 * isn't configured or the session read fails, so the landing page and any
 * public surface render env-lessly.
 */
export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  if (!isAuthConfigured()) return null;
  try {
    const { data: session } = await auth.getSession();
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
