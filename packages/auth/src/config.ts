// THE single shared Better Auth configuration, mounted independently by all
// three apps (auth-platform-spec §2.1: one betterAuth() config, drizzleAdapter
// pointed at the same Neon DB, each app runs its own in-process copy — not a
// proxy, not a central auth server). Keeping this identical across apps is what
// makes a session minted by one valid in the others.
//
// Env-less boot (AGENTS.md rule 4): constructed with a placeholder secret and the
// build-placeholder DB URL, so `import`ing this never throws and all three apps
// boot to a graceful "not configured" state. Real requests only work once the
// real env is present. Warnings are emitted loudly at construction.

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
import { passkey } from "@better-auth/passkey";
import { createHttpDb, schema } from "@quagga/db";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@quagga/core";
import { sendAuthEmail } from "./email";
import {
  AUTH_RP_NAME,
  authConfigWarnings,
  isGoogleConfigured,
  resolveBaseURL,
  resolveCookieDomain,
  resolvePasskeyOrigins,
  resolvePasskeyRpID,
  resolveRequireEmailVerification,
  resolveTrustedOrigins,
  isEmailProviderConfigured,
  type AuthEnv,
} from "./env";

/**
 * Build-time placeholder secret (≥32 chars). Lets `next build`'s page-data
 * collection and env-less local boot construct the instance without a real
 * BETTER_AUTH_SECRET; any signed cookie produced with it is intentionally
 * worthless, and authConfigWarnings() shouts about it.
 */
const PLACEHOLDER_SECRET =
  "quagga-build-placeholder-better-auth-secret-0000000000";

/**
 * Assemble the betterAuth() options from an env bag. Pure aside from binding the
 * Drizzle adapter to a fresh HTTP DB client (no connection is opened until a
 * query runs). Exported so tests and tooling can inspect the resolved options.
 */
export function buildAuthOptions(env: AuthEnv = process.env) {
  const baseURL = resolveBaseURL(env);
  const cookieDomain = resolveCookieDomain(env);
  const emailProvider = isEmailProviderConfigured(env);
  const passkeyRpID = resolvePasskeyRpID(env);
  const passkeyOrigins = resolvePasskeyOrigins(env);

  return {
    appName: "AfrikaBurn Contributors",
    secret: env.BETTER_AUTH_SECRET ?? PLACEHOLDER_SECRET,
    ...(baseURL ? { baseURL } : {}),
    // Absolute origins only — never a wildcard (the trustedOrigins ATO class).
    trustedOrigins: resolveTrustedOrigins(env),
    // No outbound telemetry from a POPIA-holding auth stack.
    telemetry: { enabled: false },

    // Auth tables live in OUR Neon DB (owned by @quagga/db). transaction is left
    // at its default (false): the neon-http driver has no transaction support, so
    // operations run sequentially — the documented serverless-safe path.
    database: drizzleAdapter(createHttpDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
        // Plugin-owned tables (migration 0015). The adapter maps each Better
        // Auth model name to the drizzle table by these keys.
        twoFactor: schema.twoFactor,
        passkey: schema.passkey,
      },
    }),

    emailAndPassword: {
      enabled: true,
      // NIST length policy from @quagga/core — length is the only rule.
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // DERIVED: required only when a provider exists (see env.ts). "OFF for now"
      // is the honest consequence of RESEND_API_KEY being deliberately unset.
      requireEmailVerification: resolveRequireEmailVerification(env),
      // The spec requires every session killed on reset; Better Auth defaults
      // this to FALSE, so set it explicitly.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail(env, { to: user.email, kind: "reset", url });
      },
      onPasswordReset: async ({ user }) => {
        await sendAuthEmail(env, {
          to: user.email,
          kind: "password-reset-completed",
        });
      },
    },

    emailVerification: {
      // Only auto-send on sign-up when there is a provider to send with.
      sendOnSignUp: emailProvider,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail(env, { to: user.email, kind: "verify", url });
      },
    },

    // Self-hosting unlocks server-side change-email (absent on managed Neon). The
    // 48h revocation window + POPIA state machine stay in @quagga/core /
    // email_change_requests; Better Auth owns only the identity-side token here.
    user: {
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ newEmail, url }) => {
          await sendAuthEmail(env, { to: newEmail, kind: "change-email", url });
        },
      },
    },

    // Database sessions (default) + a short-lived signed cookie cache: fast reads
    // without giving up server-side revocation.
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh once a day
      cookieCache: { enabled: true, maxAge: 300 }, // 5 minutes
    },

    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },

    // Google social sign-in (existing behaviour), wired only when credentials
    // exist so env-less boot still works. Callback is derived from baseURL.
    ...(isGoogleConfigured(env)
      ? {
          socialProviders: {
            google: {
              clientId: env.GOOGLE_CLIENT_ID as string,
              clientSecret: env.GOOGLE_CLIENT_SECRET as string,
            },
          },
        }
      : {}),

    // THE most dangerous config to get wrong: DB-backed rate-limit storage so
    // counters are shared across serverless lambdas. Default in-memory storage is
    // per-lambda and effectively no rate limiting at all. Rate limiting is on in
    // production and off in dev by Better Auth's own default.
    rateLimit: {
      storage: "database",
      modelName: "rateLimit",
    },

    // Optional second factors / passwordless accelerators (auth-platform-spec §3).
    // Both are self-host-only Better Auth plugins — the whole reason we moved off
    // managed Neon. Neither is ever the ONLY way in: password (or Google) stays
    // the primary credential, so a lost passkey or authenticator is never a dead
    // end (recovery: password + 2FA backup codes).
    plugins: [
      twoFactor({
        // Names the account in authenticator apps ("AfrikaBurn Contributors").
        issuer: AUTH_RP_NAME,
        // FOOTGUN GUARD (auth-platform-spec §3): the raw backup-code option
        // defaults to plaintext storage. Store them ENCRYPTED — plaintext
        // recovery codes in our Neon DB would be a POPIA + security failure.
        backupCodeOptions: { storeBackupCodes: "encrypted" },
        // Let Google-only / passkey-only accounts still enrol a second factor
        // (a password is still required to enrol when a credential account
        // exists). The built-in account lockout (10 fails → 15 min) on the
        // /two-factor/verify endpoints stays at its default.
        allowPasswordless: true,
      }),
      passkey({
        // rpID scoped to the apex so ONE passkey works across all three
        // subdomains; undefined off-apex (localhost/preview) so the browser
        // accepts a request-host rpID. See resolvePasskeyRpID.
        ...(passkeyRpID ? { rpID: passkeyRpID } : {}),
        rpName: AUTH_RP_NAME,
        // Array of expected origins (1.6.25 supports it) — all three prod
        // origins under the apex; undefined off-apex to derive from the request.
        ...(passkeyOrigins ? { origin: passkeyOrigins } : {}),
        // Discoverable (resident) credentials + user verification for a
        // one-tap, username-less sign-in on the non-technical volunteer base.
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      }),
    ],

    advanced: {
      cookiePrefix: "quagga",
      // Cross-subdomain SSO — enabled only when actually served under the apex,
      // so localhost / *.vercel.app previews (which cannot share the cookie) still
      // boot and work host-only.
      ...(cookieDomain
        ? { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }
        : {}),
    },
  } satisfies BetterAuthOptions;
}

/** Construct a Better Auth instance for a given env, shouting any warnings. */
export function createAuth(env: AuthEnv = process.env) {
  for (const warning of authConfigWarnings(env)) {
    console.warn(`[auth] ${warning}`);
  }
  return betterAuth(buildAuthOptions(env));
}

/**
 * The shared singleton the apps mount:
 *   - `app/api/auth/[...all]/route.ts`: `export const { GET, POST } = toNextJsHandler(auth)`
 *   - server components / actions: `await auth.api.getSession({ headers })`
 */
export const auth = createAuth();

/** The concrete Better Auth instance type, for typing app-side helpers. */
export type Auth = ReturnType<typeof createAuth>;
