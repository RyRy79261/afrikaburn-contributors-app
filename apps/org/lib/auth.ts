import "server-only";

import { auth } from "@/lib/neon-auth";
import { isAuthConfigured } from "@/lib/config";

/** Minimal authenticated-user shape used across the console. */
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
 * Read the current authenticated Neon Auth user. Returns null (never throws)
 * when auth isn't configured or the session read fails, so the gate renders
 * env-lessly rather than crashing.
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
