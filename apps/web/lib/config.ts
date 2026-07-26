// Boot-time configuration probes. Every backing service is OPTIONAL for boot:
// the app renders a landing page and a graceful "not configured" banner when
// these are unset (build-spec §Hard constraints 4).

/**
 * True when self-hosted auth has its shared signing secret. `BETTER_AUTH_SECRET`
 * (identical across all three apps) is the one env var that makes a session from
 * one app valid in another — the authoritative probe lives in @quagga/auth; this
 * inlines the same check so config stays a lightweight, client-safe module that
 * does not pull the whole auth package (and its betterAuth() construction) in.
 */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET);
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function isFullyConfigured(): boolean {
  return isAuthConfigured() && isDatabaseConfigured();
}

/** Human-readable list of the backing services still to be configured. */
export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!isAuthConfigured()) missing.push("Better Auth (sign-in)");
  if (!isDatabaseConfigured()) missing.push("Neon Postgres (database)");
  return missing;
}
