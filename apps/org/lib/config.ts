// Boot-time configuration probes for the org app. Everything is optional for
// boot — the gate renders env-lessly (build-spec §Hard constraints 4).

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
  if (!isAuthConfigured()) missing.push("Better Auth (sign-in)");
  if (!isDatabaseConfigured()) missing.push("Neon Postgres (database)");
  return missing;
}
