// Boot-time configuration probes for the org app. Everything is optional for
// boot — the gate renders env-lessly (build-spec §Hard constraints 4).

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET,
  );
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Where the "Go to the participant app" gate button points. Configurable per
 * environment; falls back to the dev port so the button works env-less.
 */
export function participantAppUrl(): string {
  return process.env.NEXT_PUBLIC_PARTICIPANT_APP_URL ?? "http://localhost:3000";
}

/** Human-readable list of the backing services still to be configured. */
export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!isAuthConfigured()) missing.push("Neon Auth (sign-in)");
  if (!isDatabaseConfigured()) missing.push("Neon Postgres (database)");
  return missing;
}
