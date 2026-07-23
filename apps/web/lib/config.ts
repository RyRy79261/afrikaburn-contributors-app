// Boot-time configuration probes. Every backing service is OPTIONAL for boot:
// the app renders a landing page and a graceful "not configured" banner when
// these are unset (build-spec §Hard constraints 4).

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET,
  );
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
  if (!isAuthConfigured()) missing.push("Neon Auth (sign-in)");
  if (!isDatabaseConfigured()) missing.push("Neon Postgres (database)");
  return missing;
}
