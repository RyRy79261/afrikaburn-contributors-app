// Boot-time configuration probes for the supplier portal. Everything is
// optional for boot — the landing/sign-in renders env-lessly (build-spec
// §Hard constraints 4). Identical shape to apps/org's config so the graceful
// degraded states read the same across the three apps.

/**
 * True when self-hosted auth has its shared signing secret. `BETTER_AUTH_SECRET`
 * (identical across all three apps) is what makes a session from one app valid in
 * another; the authoritative probe lives in @quagga/auth and this inlines the
 * same check so config stays a lightweight, client-safe module.
 */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET);
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Human-readable list of the backing services still to be configured. */
export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!isAuthConfigured()) missing.push("Better Auth (sign-in)");
  if (!isDatabaseConfigured()) missing.push("Neon Postgres (database)");
  return missing;
}
