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
export { sendAuthEmail, type AuthEmailInput, type AuthEmailKind } from "./email";
export {
  AUTH_APEX_DOMAIN,
  AUTH_COOKIE_DOMAIN,
  AUTH_RP_NAME,
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
  resolveRequireEmailVerification,
  resolveTrustedOrigins,
  type AuthEnv,
} from "./env";
