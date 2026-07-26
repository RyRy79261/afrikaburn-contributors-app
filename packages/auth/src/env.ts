// Pure environment resolution for the shared Better Auth config.
//
// PURITY CONTRACT: no I/O, no better-auth import, no side effects (not even a
// console.warn — warning emission lives in config.ts's createAuth). Everything
// here is a deterministic function of an env bag, so the derivations Ryan cares
// about (baseURL fallback, DERIVED email verification, cross-subdomain cookie
// scoping, trusted origins) are unit-testable without a database or a running
// auth instance. config.ts consumes these to assemble the betterAuth() options;
// each app consumes isAuthConfigured() for its graceful "not configured" boot.

/** The subset of process.env the auth config reads. Optional everywhere so all
 * three apps still boot env-less (AGENTS.md rule 4). */
export interface AuthEnv {
  BETTER_AUTH_SECRET?: string | undefined;
  /** Per-app absolute origin in production (e.g. https://app.quagga.ryanjnoble.dev). */
  BETTER_AUTH_URL?: string | undefined;
  /** Vercel preview host (no protocol) — the previews' baseURL source. */
  VERCEL_URL?: string | undefined;
  VERCEL_ENV?: string | undefined;
  /** Presence of the email provider is what makes verification/reset possible. */
  RESEND_API_KEY?: string | undefined;
  /**
   * Explicit override for the DERIVED email-verification gate. Only meaningful
   * when a provider IS configured: set it falsey to keep sending reset/notify
   * email while NOT gating sign-in on verification (Ryan's decision 2). It can
   * never turn verification ON without a provider — that is impossible.
   */
  BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION?: string | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  NODE_ENV?: string | undefined;
}

/** The registrable apex every app is a subdomain of. */
export const AUTH_APEX_DOMAIN = "quagga.ryanjnoble.dev";

/**
 * The Domain= all session cookies are scoped to (leading dot), so a session
 * minted by one app verifies on the others — this is what gives cross-app SSO.
 * It is a hard prerequisite that cannot be satisfied on a *.vercel.app host
 * (Public Suffix List), which is why crossSubDomainCookies is enabled only when
 * the resolved baseURL is actually under the apex (see resolveCookieDomain).
 */
export const AUTH_COOKIE_DOMAIN = `.${AUTH_APEX_DOMAIN}`;

/**
 * The three production app origins — the only absolute origins trusted by
 * default. trustedOrigins is NEVER a wildcard (the documented ATO bypass class
 * targets wildcard / scheme-less callbackURLs); preview origins are added
 * explicitly and absolutely at resolve time.
 */
export const PRODUCTION_ORIGINS: readonly string[] = [
  "https://app.quagga.ryanjnoble.dev",
  "https://org.quagga.ryanjnoble.dev",
  "https://suppliers.quagga.ryanjnoble.dev",
];

/** True when the auth stack has its shared signing secret — the one env var that
 * makes a session from one app valid in another. Drives isAuthConfigured(). */
export function isAuthConfigured(env: AuthEnv): boolean {
  return Boolean(env.BETTER_AUTH_SECRET);
}

/** True when an email provider (Resend) is configured. Verification and the
 * password-reset link email are only possible when this is true. */
export function isEmailProviderConfigured(env: AuthEnv): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/**
 * Resolve the per-app base URL: the explicit production value first, else the
 * Vercel preview URL (which carries no protocol), else undefined so Better Auth
 * infers it from the request headers (fine for local dev / env-less boot).
 */
export function resolveBaseURL(env: AuthEnv): string | undefined {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return undefined;
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** True when the resolved base URL is actually served under our apex. */
export function isUnderApex(env: AuthEnv): boolean {
  const host = hostOf(resolveBaseURL(env));
  return host === AUTH_APEX_DOMAIN || (host?.endsWith(`.${AUTH_APEX_DOMAIN}`) ?? false);
}

/**
 * The cookie Domain= to scope sessions to, or undefined when it must NOT be set.
 * Only returned when the app is served under the apex — on a *.vercel.app
 * preview or localhost, scoping to the apex would silently break every cookie,
 * so we leave it host-only there (SSO simply doesn't span previews, which the
 * Public Suffix List makes impossible anyway).
 */
export function resolveCookieDomain(env: AuthEnv): string | undefined {
  return isUnderApex(env) ? AUTH_COOKIE_DOMAIN : undefined;
}

/** Parse a loose boolean env value. Returns undefined when unset/unrecognised. */
export function parseBoolEnv(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(v)) return true;
  if (["false", "0", "off", "no"].includes(v)) return false;
  return undefined;
}

/**
 * DERIVED email-verification requirement (Ryan's decision 2 — never a hardcoded
 * weakening):
 *   - no provider          ⇒ false (verification is IMPOSSIBLE without a sender;
 *                            a loud boot warning is emitted separately).
 *   - provider present      ⇒ true by default.
 *   - provider + override=false ⇒ false (he wants reset/notify email but no
 *                            verification gate).
 * The override can never force verification ON without a provider.
 */
export function resolveRequireEmailVerification(env: AuthEnv): boolean {
  if (!isEmailProviderConfigured(env)) return false;
  return parseBoolEnv(env.BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION) !== false;
}

/** True when Google social sign-in is fully configured. */
export function isGoogleConfigured(env: AuthEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * The absolute trusted origins: the three production apps, plus this app's own
 * base URL and the current Vercel preview origin when present. Deduped; absolute
 * only; no wildcards.
 */
export function resolveTrustedOrigins(env: AuthEnv): string[] {
  const origins = new Set<string>(PRODUCTION_ORIGINS);
  const base = resolveBaseURL(env);
  if (base) {
    try {
      origins.add(new URL(base).origin);
    } catch {
      /* ignore an unparseable base URL */
    }
  }
  return [...origins];
}

/**
 * Loud, human-readable boot warnings for a misconfigured or intentionally-open
 * auth stack. config.ts emits these via console.warn at construction so a
 * DB-less/secret-less build says so plainly rather than appearing configured.
 */
export function authConfigWarnings(env: AuthEnv): string[] {
  const warnings: string[] = [];
  const isProd = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";

  if (!isAuthConfigured(env)) {
    warnings.push(
      "BETTER_AUTH_SECRET is not set — using an insecure BUILD PLACEHOLDER. " +
        "Sessions are not secure and cross-app SSO will not work until the same " +
        "secret is set on all three Vercel projects.",
    );
  }

  if (isAuthConfigured(env) && !isEmailProviderConfigured(env)) {
    warnings.push(
      "No email provider (RESEND_API_KEY) is configured — email verification is " +
        "DISABLED because it is impossible without a sender, and password reset " +
        "presents as unavailable. Both switch on automatically the moment a " +
        "Resend key exists.",
    );
  }

  if (
    isEmailProviderConfigured(env) &&
    parseBoolEnv(env.BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION) === false
  ) {
    warnings.push(
      "BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION is explicitly false — an email " +
        "provider is configured, so reset/notification email is sent, but sign-in " +
        "is NOT gated on email verification.",
    );
  }

  if (isProd && isAuthConfigured(env) && !isUnderApex(env)) {
    warnings.push(
      "Production auth is not served under the apex " +
        `(${AUTH_APEX_DOMAIN}); cross-subdomain SSO cookies are disabled for this ` +
        "origin. Set BETTER_AUTH_URL to the app's apex subdomain.",
    );
  }

  return warnings;
}
