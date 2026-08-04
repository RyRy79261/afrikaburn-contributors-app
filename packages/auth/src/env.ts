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
  /** Optional rate-limit tuning. UNSET IN PRODUCTION — see resolveRateLimit. */
  AUTH_RATE_LIMIT_WINDOW_SECONDS?: string | undefined;
  AUTH_RATE_LIMIT_MAX?: string | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  NODE_ENV?: string | undefined;
}

/** The registrable apex every app is a subdomain of. */
export const AUTH_APEX_DOMAIN = "quagga.ryanjnoble.dev";

/**
 * Session lifetime, in seconds. Database sessions (Better Auth's default) plus
 * a short signed cookie cache: fast reads without giving up server-side
 * revocation.
 *
 * It lives HERE, in the pure module, rather than as literals inside
 * `buildAuthOptions`, because the org console's System panel reports the session
 * lifetime to whoever is debugging a "why am I still signed in?" question. Two
 * copies of a number like that drift, and the copy that drifts is always the one
 * being read. config.ts consumes these, so the panel and the running auth stack
 * cannot disagree.
 *
 * `cookieCacheMaxAgeSeconds` is the honest caveat the panel has to state: a
 * revoked session can still be honoured for up to that long, because the check
 * is a signature on a cookie rather than a database read.
 */
export const AUTH_SESSION = {
  expiresInSeconds: 60 * 60 * 24 * 7, // 7 days
  updateAgeSeconds: 60 * 60 * 24, // refreshed once a day
  cookieCacheMaxAgeSeconds: 300, // 5 minutes
} as const;

/** Human-readable Relying Party / issuer name shown in authenticator + TOTP UIs. */
export const AUTH_RP_NAME = "AfrikaBurn Contributors";

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

/**
 * Whether cookies get the `Secure` flag (and the `__Secure-` name prefix).
 *
 * Derived from the ORIGIN we are actually served on, not from `NODE_ENV`.
 * Better Auth's default keys off NODE_ENV, which is wrong for one real case: a
 * production BUILD served over plain http, which is exactly how the E2E suite
 * runs the app locally. There the browser silently drops every `__Secure-`
 * cookie, so sign-up "succeeds" with no session and every authenticated journey
 * fails in a way that looks like broken auth.
 *
 * Returns `undefined` (keep Better Auth's default → secure) when no base URL is
 * configured, so a real deployment can never accidentally opt out: it takes an
 * explicit http:// base URL to turn the flag off.
 */
export function resolveUseSecureCookies(env: AuthEnv): boolean | undefined {
  const baseURL = resolveBaseURL(env);
  if (!baseURL) return undefined;
  return baseURL.startsWith("https://") ? undefined : false;
}

/**
 * Optional rate-limit tuning, so a deployment can raise the ceiling WITHOUT a
 * code change and without anyone reaching for `enabled: false`.
 *
 * Returns `{}` when unset, which keeps Better Auth's own (secure) defaults —
 * this can only ever LOOSEN things deliberately, never silently.
 *
 * The case that forced it: the E2E suite drives real sign-ups from several
 * parallel workers that all share 127.0.0.1, so the limiter correctly sees one
 * client hammering /sign-up/email and returns 429. The limiter is right; the
 * test environment needs a higher ceiling. Production must leave these unset.
 */
export function resolveRateLimit(env: AuthEnv): {
  window?: number;
  max?: number;
  customRules?: Record<string, { window: number; max: number }>;
} {
  const window = Number(env.AUTH_RATE_LIMIT_WINDOW_SECONDS);
  const max = Number(env.AUTH_RATE_LIMIT_MAX);
  const hasWindow = Number.isFinite(window) && window > 0;
  const hasMax = Number.isFinite(max) && max > 0;
  if (!hasWindow && !hasMax) return {};

  const out: {
    window?: number;
    max?: number;
    customRules?: Record<string, { window: number; max: number }>;
  } = {};
  if (hasWindow) out.window = window;
  if (hasMax) out.max = max;

  // The GLOBAL max is not enough. Better Auth ships STRICTER built-in rules for
  // the sensitive auth paths, and those win over `max` — so raising only the
  // global ceiling still yields 429 on sign-up, which is exactly what happened.
  if (hasMax) {
    const rule = { window: hasWindow ? window : 60, max };
    out.customRules = {
      "/sign-up/email": rule,
      "/sign-in/email": rule,
      "/forget-password": rule,
      "/reset-password": rule,
    };
  }
  return out;
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
  return (
    host === AUTH_APEX_DOMAIN ||
    (host?.endsWith(`.${AUTH_APEX_DOMAIN}`) ?? false)
  );
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
 * The WebAuthn Relying Party ID for passkeys. THE ONE near-irreversible passkey
 * decision (auth-platform-spec §3): scope it to the registrable APEX so a single
 * passkey works across app./org./suppliers. A passkey scoped to a subdomain would
 * NOT work on the others and cannot be widened without re-enrolling every user.
 *
 * Returned only when the app is actually served under the apex. On localhost /
 * *.vercel.app previews the browser rejects an apex rpID that is not a suffix of
 * the current origin, so we return undefined and let the plugin derive rpID from
 * the request host — local passkeys work host-only, exactly like the cookie
 * scoping. (Ryan: the domain may be nuked & rebuilt later; rpID binding is not a
 * blocker — this resolves to the apex the moment production serves under it.)
 */
export function resolvePasskeyRpID(env: AuthEnv): string | undefined {
  return isUnderApex(env) ? AUTH_APEX_DOMAIN : undefined;
}

/**
 * The expected WebAuthn origin(s) passkey registration/authentication is
 * validated against. The @better-auth/passkey plugin accepts an ARRAY (verified
 * against the installed 1.6.25 types — this resolves the spec's single-vs-array
 * open fork), so under the apex we trust all three production subdomain origins:
 * a challenge issued on app. then verifies for org./suppliers., which is what
 * makes ONE apex-scoped passkey usable everywhere. Off-apex we return undefined
 * so the plugin derives the expected origin from the request/baseURL (localhost
 * and preview hosts work host-only).
 */
export function resolvePasskeyOrigins(env: AuthEnv): string[] | undefined {
  if (!isUnderApex(env)) return undefined;
  return resolveTrustedOrigins(env);
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
  const isProd =
    env.VERCEL_ENV === "production" || env.NODE_ENV === "production";

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
