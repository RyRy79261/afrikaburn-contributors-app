// Boot-time configuration probes for the supplier portal. Everything is
// optional for boot — the landing/sign-in renders env-lessly (build-spec
// §Hard constraints 4). Identical shape to apps/org's config so the graceful
// degraded states read the same across the three apps.

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET,
  );
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Human-readable list of the backing services still to be configured. */
export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!isAuthConfigured()) missing.push("Neon Auth (sign-in)");
  if (!isDatabaseConfigured()) missing.push("Neon Postgres (database)");
  return missing;
}
