// @quagga/auth — the shared self-hosted Better Auth foundation (auth-platform-spec).
//
// The wiring agent consumes this package as follows:
//
//   Route handler (each app), app/api/auth/[...all]/route.ts:
//     import { toNextJsHandler } from "better-auth/next-js";
//     import { auth } from "@quagga/auth";
//     export const { GET, POST } = toNextJsHandler(auth);
//
//   Server read (server components / actions):
//     import { auth } from "@quagga/auth";
//     const session = await auth.api.getSession({ headers: await headers() });
//
//   Boot probe (replaces lib/config.ts isAuthConfigured):
//     import { isAuthConfigured } from "@quagga/auth";
//     isAuthConfigured(process.env);
//
//   Client (built per app, not exported here — it is client-only):
//     import { createAuthClient } from "better-auth/react";
//     export const authClient = createAuthClient();  // same-origin /api/auth/*
//
// The Better Auth server API surface the account backend already expects is on
// `auth.api.*`: getSession, listSessions, revokeSession(s)/revokeOtherSessions,
// changePassword, requestPasswordReset, resetPassword, sendVerificationEmail,
// verifyEmail, changeEmail, listAccounts, unlinkAccount, deleteUser. Capability
// support is tracked in @quagga/core AUTH_CAPABILITIES.

export { auth, createAuth, buildAuthOptions, type Auth } from "./config";
export {
  sendAuthEmail,
  sendSingleEmail,
  type AuthEmailInput,
  type AuthEmailKind,
} from "./email";
// Wrap any `auth.api.signInEmail` call made purely to VERIFY a password, so the
// session-create hook does not read it as the burner returning.
export { withReauth, isReauth } from "./reauth";
// The pure env module is ALSO published as `@quagga/auth/env`. Importing it
// there gets the resolvers without evaluating this file's `auth` singleton (a
// betterAuth() construction with a drizzle adapter bound to it), which is what
// the org console's System panel and its unit tests want: they read how auth is
// configured, they do not need an auth instance to do it.
export {
  AUTH_APEX_DOMAIN,
  AUTH_COOKIE_DOMAIN,
  AUTH_RP_NAME,
  AUTH_SESSION,
  PRODUCTION_ORIGINS,
  authConfigWarnings,
  isAuthConfigured,
  isEmailProviderConfigured,
  isGoogleConfigured,
  isUnderApex,
  parseBoolEnv,
  resolveBaseURL,
  resolveCookieDomain,
  resolvePasskeyOrigins,
  resolvePasskeyRpID,
  resolveRateLimit,
  resolveRequireEmailVerification,
  resolveTrustedOrigins,
  resolveUseSecureCookies,
  type AuthEnv,
} from "./env";
