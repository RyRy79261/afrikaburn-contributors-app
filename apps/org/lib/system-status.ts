// What this deployment is ACTUALLY configured with — derived, never asserted.
//
// This is the module behind `/system`. It exists because "the app is broken" is
// almost never a code question: it is email verification silently off because
// nobody set a Resend key, uploads falling back to link-paste because the blob
// token is missing, a migration that would refuse to run against a pooled
// endpoint, or a database that is simply not there. Every one of those states
// already exists in this codebase and already degrades honestly — but each one
// is honest in its OWN corner, so the person debugging has to know where to
// look. This puts them on one page.
//
// THREE RULES, in order of how badly they would hurt if broken:
//
//  1. NEVER PRINT A SECRET. Every check reports whether a value is SET and what
//     follows from that — never the value. The one deliberate exception is a
//     database HOSTNAME (parsed out with `connectionHost`, so a password in the
//     connection string cannot come with it), because "which database am I
//     actually talking to" is the question this page exists to answer and a host
//     is not a credential. `redactSecrets` is the backstop for anything that
//     arrives from outside — a driver error can and does quote the connection
//     string it failed on — and a unit test seeds every secret env var with a
//     marker and asserts no marker survives into any rendered string.
//  2. DERIVE, DO NOT DUPLICATE. Email verification, the rate-limit ceiling,
//     passkey scoping and the session lifetime all come from @quagga/auth's own
//     pure resolvers; the migration verdict comes from @quagga/db's `planMigration`,
//     the same function the build calls. A page that reported its own second
//     opinion of the config would be worse than no page, because it would be
//     believed. If this file ever computes a policy itself, that is the bug.
//  3. SAY WHY, NOT JUST WHAT. "Email verification: off" invites someone to go
//     turn it on and find no switch. "Off — impossible without an email sender;
//     it switches on the moment RESEND_API_KEY exists" ends the investigation.
//
// PURE. No `server-only`, no `process.env`, no database — it takes an env bag
// and a probe result and returns a report, so the whole thing is unit-tested
// (`__tests__/system-status.test.ts`). `system-probe.ts` is the server half that
// reads the real env and runs the real probe.

import {
  AUTH_SESSION,
  isAuthConfigured,
  isEmailProviderConfigured,
  isGoogleConfigured,
  isUnderApex,
  parseBoolEnv,
  resolveBaseURL,
  resolveCookieDomain,
  resolvePasskeyRpID,
  resolveRateLimit,
  resolveRequireEmailVerification,
  resolveUseSecureCookies,
  AUTH_APEX_DOMAIN,
} from "@quagga/auth/env";
import { connectionHost, planMigration } from "@quagga/db";
import {
  AUTH_CAPABILITIES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  parseGodEmails,
} from "@quagga/core";

/**
 * How a check reads at a glance.
 *
 * `degraded` and `attention` are deliberately different states, and conflating
 * them is what makes a status page useless. A deployment with no Resend key is
 * DEGRADED: it is working exactly as designed, with an honest fallback, and
 * nothing is wrong. A production deploy whose migration would refuse to run
 * needs ATTENTION. If everything amber shouted, nobody would look.
 */
export type CheckTone = "ok" | "degraded" | "attention" | "info";

/**
 * The env bag this reads.
 *
 * Deliberately NOT `NodeJS.ProcessEnv`: Next's types augment that interface to
 * make `NODE_ENV` required, so every test case would have to supply a variable
 * most of them do not care about. `process.env` satisfies this, and so does a
 * three-key object literal in a test — which is the point, because the tests
 * here are a table of environments.
 */
export type SystemEnv = Readonly<Record<string, string | undefined>>;

export interface SystemCheck {
  id: string;
  label: string;
  /** The state, short enough for a badge. NEVER a secret value. */
  value: string;
  tone: CheckTone;
  /** Why it is in that state, and what follows from it. */
  detail: string;
  /** The env var NAMES that decide it. Names only — never their values. */
  env?: readonly string[];
}

export interface SystemStatus {
  /** Is the deployment's plumbing working? */
  health: SystemCheck[];
  /** What is the auth stack actually enforcing? */
  security: SystemCheck[];
  /** The single line at the top: the worst thing on the page, named. */
  headline: { tone: CheckTone; summary: string };
}

/** The live database probe `system-probe.ts` performs. */
export type DatabaseProbe =
  | { kind: "not_configured" }
  | {
      kind: "ok";
      latencyMs: number;
      /** The active edition, or null when reference data has never been seeded. */
      edition: { name: string; year: number } | null;
    }
  | { kind: "unreachable"; message: string };

/**
 * Env vars whose VALUE is a credential. Used only to redact — this module never
 * reads a value from here to display it.
 *
 * `GOD_EMAILS` is on the list although it is not a secret: it is a list of
 * people's email addresses, which is personal information, and an ENGINEER may
 * open this page. The count is reported; the addresses never are.
 */
const SECRET_ENV_VARS = [
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "RESEND_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "PGCRYPTO_KEY",
  "GOD_EMAILS",
] as const;

/**
 * Scrub anything that could carry a credential out of text we did not write.
 *
 * Two passes, because either alone is insufficient. First every connection-string
 * URL is replaced wholesale (a Postgres URL embeds its password, and a driver
 * error quotes the URL it failed on). Then every known secret env VALUE is
 * replaced by name, which catches a key echoed back by an HTTP error, a value
 * that appears without a URL around it, and anything a future env var brings
 * along — provided it is added to `SECRET_ENV_VARS`.
 *
 * Short values are skipped in the second pass on purpose: replacing a two-letter
 * secret would corrupt ordinary prose without protecting anything real.
 */
export function redactSecrets(text: string, env: SystemEnv): string {
  let out = text.replace(
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`,)]+/gi,
    "[connection string redacted]",
  );
  for (const name of SECRET_ENV_VARS) {
    const value = env[name];
    if (value && value.length >= 8) {
      out = out.split(value).join(`[${name} redacted]`);
    }
  }
  return out;
}

/** "7 days" / "5 minutes" / "90 seconds" — a duration a human reads, not seconds. */
export function humanDuration(seconds: number): string {
  const units: Array<[number, string]> = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size;
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/** The database host, or null — parsed, so a password can never ride along. */
function hostOf(connectionString: string | undefined): string | null {
  return connectionString ? connectionHost(connectionString) : null;
}

// --- Health: is the plumbing working? ---------------------------------------

function databaseCheck(
  env: SystemEnv,
  probe: DatabaseProbe,
): SystemCheck {
  const host = hostOf(env.DATABASE_URL ?? env.DATABASE_URL_UNPOOLED);
  const where = host ? ` Host: ${host}.` : "";

  if (probe.kind === "not_configured") {
    return {
      id: "database",
      label: "Database",
      value: "Not configured",
      tone: "degraded",
      detail:
        "DATABASE_URL is unset, so every data-backed page renders its preview shell. " +
        "That is the intended env-less boot, not a fault — the apps are required to come " +
        "up without env rather than crash.",
      env: ["DATABASE_URL"],
    };
  }
  if (probe.kind === "unreachable") {
    return {
      id: "database",
      label: "Database",
      value: "Unreachable",
      tone: "attention",
      detail:
        `A query issued while rendering this page failed.${where} ` +
        `Reported: ${redactSecrets(probe.message, env)}`,
      env: ["DATABASE_URL"],
    };
  }
  return {
    id: "database",
    label: "Database",
    value: `Connected · ${probe.latencyMs} ms`,
    tone: "ok",
    detail:
      `One real round trip, made while rendering this page.${where} ` +
      "Local Postgres behind the Neon proxies is faithful enough to catch logic, " +
      "never pooling behaviour or cold starts.",
    env: ["DATABASE_URL"],
  };
}

function migrationCheck(env: SystemEnv): SystemCheck {
  const base = {
    id: "migrations",
    label: "Migrations at deploy",
    env: ["DATABASE_URL_UNPOOLED", "DATABASE_URL"],
  } as const;

  // `planMigration` THROWS for a configuration it would refuse to run against.
  // Rendering that refusal here is the whole point: it is the exact sentence the
  // build would fail with, available before someone spends a deploy finding out.
  let plan;
  try {
    plan = planMigration(env);
  } catch (err) {
    return {
      ...base,
      value: "Would refuse to run",
      tone: "attention",
      detail: redactSecrets(
        err instanceof Error ? err.message : String(err),
        env,
      ),
    };
  }

  if (plan.kind === "skip") {
    return {
      ...base,
      value: "Skipped — no database",
      tone: "degraded",
      detail:
        "With no database configured the deploy applies nothing and exits cleanly, " +
        "which keeps a DB-less build legal. A production deploy in this state fails loudly instead.",
    };
  }
  if (plan.usingUnpooled) {
    return {
      ...base,
      value: "Direct (unpooled) endpoint",
      tone: "ok",
      detail:
        `Migrating against ${hostOf(plan.connectionString) ?? "the configured host"} via DATABASE_URL_UNPOOLED. ` +
        "Session advisory locks hold there, which is what serialises the three concurrent app builds " +
        "so only one of them migrates and seeds.",
    };
  }
  return {
    ...base,
    value: "Falling back to DATABASE_URL",
    tone: "degraded",
    detail:
      `DATABASE_URL_UNPOOLED is unset, so the runner would use ${hostOf(plan.connectionString) ?? "the configured host"} ` +
      "— not a pooler, and not a Vercel deploy, so it is allowed with a warning. On any Vercel " +
      "deploy this same configuration is a hard failure: Neon's integration points DATABASE_URL at " +
      "the PgBouncer endpoint, where the advisory lock does not hold.",
  };
}

function referenceDataCheck(probe: DatabaseProbe): SystemCheck {
  const base = { id: "reference-data", label: "Reference data" } as const;
  if (probe.kind !== "ok") {
    return {
      ...base,
      value: "Unknown",
      tone: "info",
      detail: "Can't be read without a working database connection.",
    };
  }
  if (!probe.edition) {
    return {
      ...base,
      value: "No active edition",
      tone: "attention",
      detail:
        "Nothing has seeded this database, so every edition-scoped page falls through to the " +
        "preview shell and reads like a missing env var when the environment is correct. " +
        "The deploy seeds reference data when — and only when — it finds no edition, so a " +
        "redeploy fixes it. Burners, camps and registrations are never seeded; an empty " +
        "directory on a fresh database is the correct first-boot state.",
    };
  }
  return {
    ...base,
    value: probe.edition.name,
    tone: "ok",
    detail:
      `The active edition is ${probe.edition.name} (${probe.edition.year}). Seeds carry only ` +
      "org-owned reference data — editions, the org group, camp categories, the supplier " +
      "catalogue, questionnaire templates. Every account and camp is created live through the app.",
  };
}

function emailCheck(env: SystemEnv): SystemCheck {
  const base = {
    id: "email",
    label: "Email provider",
    env: ["RESEND_API_KEY"],
  } as const;
  return isEmailProviderConfigured(env)
    ? {
        ...base,
        value: "Resend configured",
        tone: "ok",
        detail:
          "Verification, password reset, security notices and bulletin email are delivered for real.",
      }
    : {
        ...base,
        value: "Not configured",
        tone: "degraded",
        detail:
          "Every message is written to the server log instead of being sent, and the send reports " +
          "delivered: false rather than failing. Three consequences follow, and they are the usual " +
          "cause of a 'broken' report: email verification is off (see below), password reset presents " +
          "as unavailable, and nobody receives a notification email.",
      };
}

function blobCheck(env: SystemEnv): SystemCheck {
  const base = {
    id: "blob",
    label: "File uploads",
    env: ["BLOB_READ_WRITE_TOKEN"],
  } as const;
  return env.BLOB_READ_WRITE_TOKEN
    ? {
        ...base,
        value: "Vercel Blob configured",
        tone: "ok",
        detail:
          "Supplier documents, questionnaire images and registration layouts upload directly, " +
          "with type and size enforced server-side by the issued token.",
      }
    : {
        ...base,
        value: "Not configured",
        tone: "degraded",
        detail:
          "Every uploader degrades to pasting a link, and the token endpoint answers 501 with that " +
          "advice. Nothing is lost — a file lives somewhere else and the record points at it.",
      };
}

function authSecretCheck(env: SystemEnv): SystemCheck {
  const base = {
    id: "auth-secret",
    label: "Auth signing secret",
    env: ["BETTER_AUTH_SECRET"],
  } as const;
  return isAuthConfigured(env)
    ? {
        ...base,
        value: "Set",
        tone: "ok",
        detail:
          "Sessions are signed with it. It must be the SAME value on all three apps — that identity " +
          "is what makes a session minted on one valid on the others.",
      }
    : {
        ...base,
        value: "Not set — build placeholder in use",
        tone: "attention",
        detail:
          "The auth stack is constructed with a known placeholder so the app still boots, and any " +
          "cookie it signs is deliberately worthless. Nobody can sign in until a real secret exists.",
      };
}

function encryptionCheck(env: SystemEnv): SystemCheck {
  const base = {
    id: "encryption-key",
    label: "ID encryption key",
    env: ["PGCRYPTO_KEY"],
  } as const;
  const raw = env.PGCRYPTO_KEY;
  if (!raw) {
    return {
      ...base,
      value: "Not set",
      tone: "attention",
      detail:
        "SA ID and passport numbers are encrypted at rest with this key. Without it, saving one " +
        "throws rather than storing it in the clear — which is the right failure, and a broken " +
        "gate-verification flow until the key is set.",
    };
  }
  // The length rule is the crypto module's own (scrypt needs real material);
  // reporting the LENGTH is safe, reporting the key is not.
  return raw.length < 16
    ? {
        ...base,
        value: "Set but too short",
        tone: "attention",
        detail:
          `The key must be at least 16 characters; this one is ${raw.length}. Encryption refuses ` +
          "to run, so ID capture fails exactly as if the key were absent.",
      }
    : {
        ...base,
        value: "Set",
        tone: "ok",
        detail:
          "AES-256-GCM over the SA ID and passport columns, keyed from this value. Losing it makes " +
          "existing ciphertext unreadable — it is not a rotatable setting today.",
      };
}

function deploymentCheck(env: SystemEnv): SystemCheck {
  const baseURL = resolveBaseURL(env);
  const edition = env.VERCEL_ENV ?? env.NODE_ENV ?? "development";
  return {
    id: "deployment",
    label: "This deployment",
    value: edition,
    tone: "info",
    detail: baseURL
      ? `Serving as ${baseURL}${isUnderApex(env) ? ` (under the ${AUTH_APEX_DOMAIN} apex)` : " — not under the apex, so cross-app sign-on is host-only here"}.`
      : "No base URL is configured, so Better Auth infers the origin from the request headers. " +
        "That is correct for local development and for a preview; a real deployment should set BETTER_AUTH_URL.",
    env: ["BETTER_AUTH_URL", "VERCEL_ENV", "NODE_ENV"],
  };
}

// --- Security: what is the auth stack enforcing? ----------------------------

function emailVerificationCheck(env: SystemEnv): SystemCheck {
  const base = {
    id: "email-verification",
    label: "Email verification",
    env: ["RESEND_API_KEY", "BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION"],
  } as const;

  // The WHY matters more than the WHAT here, because the value is DERIVED: it is
  // not a switch someone forgot to flip, and looking for that switch is the wrong
  // investigation. The answer itself comes from the resolver the auth config
  // uses, so this can never report a gate the stack is not actually applying.
  const required = resolveRequireEmailVerification(env);

  if (!isEmailProviderConfigured(env)) {
    return {
      ...base,
      value: "Off — no email sender",
      tone: "degraded",
      detail:
        "Verification is derived from provider presence, not configured directly. With no Resend key " +
        "there is nothing to send the link with, so requiring verification would lock every new account " +
        "out of an app it could never get into. It switches on by itself the moment a key exists.",
    };
  }
  if (!required && parseBoolEnv(env.BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION) === false) {
    return {
      ...base,
      value: "Off — explicitly overridden",
      tone: "attention",
      detail:
        "An email provider IS configured, so reset and notification mail is delivered, but " +
        "BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION is set false, so sign-in is not gated on a verified " +
        "address. Deliberate and reversible — but note that a System manager is bootstrapped only for " +
        "a VERIFIED address, so that ceiling still holds.",
    };
  }
  return {
    ...base,
    value: required ? "Required" : "Off",
    tone: required ? "ok" : "degraded",
    detail: required
      ? "Sign-in is gated on a verified address, and the verification mail goes out on sign-up."
      : "An email provider is configured but verification is not being required. Nothing in the " +
        "environment explains it, which makes this worth a look.",
  };
}

function godBootstrapCheck(env: SystemEnv): SystemCheck {
  // COUNT ONLY, never the addresses: they are email addresses, an engineer may
  // read this page, and an engineer never receives an email address.
  const count = parseGodEmails(env.GOD_EMAILS).length;
  const base = {
    id: "god-emails",
    label: "System manager bootstrap",
    env: ["GOD_EMAILS"],
  } as const;
  return count === 0
    ? {
        ...base,
        value: "No addresses configured",
        tone: "attention",
        detail:
          "The System manager rank is granted at sign-in to a listed address and by no other route — " +
          "the console cannot mint its own highest privilege. With an empty list, nobody new can " +
          "become one, and existing ranks are unaffected.",
      }
    : {
        ...base,
        value: `${count} address${count === 1 ? "" : "es"} configured`,
        tone: "ok",
        detail:
          "Listed addresses are granted the System manager rank on sign-in, but only once the email is " +
          "VERIFIED — an unverified claim (an identity provider asserting someone else's address) must " +
          "never elevate. The addresses themselves are not shown here; they are people's email addresses.",
      };
}

function rateLimitCheck(env: SystemEnv): SystemCheck {
  const resolved = resolveRateLimit(env);
  const base = {
    id: "rate-limit",
    label: "Auth rate limit",
    env: ["AUTH_RATE_LIMIT_MAX", "AUTH_RATE_LIMIT_WINDOW_SECONDS"],
  } as const;
  const storage =
    "Counters live in the database rather than in memory, so they are shared across serverless " +
    "instances — in-memory storage would be per-instance and effectively no limit at all.";

  if (resolved.max === undefined && resolved.window === undefined) {
    return {
      ...base,
      value: "Library defaults",
      tone: "ok",
      detail:
        `Neither override is set, so Better Auth's own ceilings stand, including the stricter per-endpoint ` +
        `rules on sign-in, sign-up and password reset. ${storage} Rate limiting is on in production and ` +
        "off in development by the library's default.",
    };
  }
  const window = resolved.window ?? 60;
  return {
    ...base,
    value: `${resolved.max ?? "default"} per ${humanDuration(window)}`,
    tone: "attention",
    detail:
      "An override is set, which RAISES the ceiling. It exists so a test deployment can loosen the " +
      "limiter instead of anyone reaching for a switch that disables it — the E2E suite drives real " +
      "sign-ups from several workers sharing one IP. Production should leave both unset. " +
      `${storage}`,
  };
}

function sessionCheck(): SystemCheck {
  return {
    id: "session",
    label: "Session lifetime",
    value: humanDuration(AUTH_SESSION.expiresInSeconds),
    tone: "info",
    detail:
      `Sessions are stored in the database and refreshed at most once every ` +
      `${humanDuration(AUTH_SESSION.updateAgeSeconds)}, so they are revocable server-side. ` +
      `The caveat worth knowing when you revoke one: a signed cookie cache answers reads for up to ` +
      `${humanDuration(AUTH_SESSION.cookieCacheMaxAgeSeconds)}, so a revoked session can still be ` +
      "honoured for that long before the next database check.",
  };
}

function secondFactorCheck(): SystemCheck {
  // Read from the capability matrix rather than asserted here: that matrix is
  // what the account surfaces gate on, so if a plugin were ever removed this
  // page would say so instead of promising a factor that no longer exists.
  const totp = AUTH_CAPABILITIES.twoFactor.support === "supported";
  const codes = AUTH_CAPABILITIES.backupCodes.support === "supported";
  return {
    id: "two-factor",
    label: "Two-factor",
    value: totp ? "TOTP available" : "Unavailable",
    tone: totp ? "ok" : "degraded",
    detail: totp
      ? `Authenticator-app codes, enrolled behind a password check.${codes ? " Backup codes are stored encrypted, never in plaintext." : ""} ` +
        "Never the only way in: a password or Google remains primary, so a lost authenticator is not a dead end."
      : "The two-factor plugin is not installed on this build, and the account surface says so rather than offering a control that cannot work.",
  };
}

function passkeyCheck(env: SystemEnv): SystemCheck {
  const available = AUTH_CAPABILITIES.passkeys.support === "supported";
  const rpID = resolvePasskeyRpID(env);
  return {
    id: "passkeys",
    label: "Passkeys",
    value: available
      ? rpID
        ? `Available · scoped to ${rpID}`
        : "Available · scoped to this host"
      : "Unavailable",
    tone: available ? "ok" : "degraded",
    detail: available
      ? rpID
        ? "WebAuthn, scoped to the registrable apex, so ONE passkey works across the participant app, " +
          "this console and the supplier portal. Widening that scope later would mean re-enrolling everyone."
        : "WebAuthn, scoped to the host actually being served, because a browser rejects an apex scope that " +
          "is not a suffix of the current origin. Passkeys therefore work here but do not span the three apps; " +
          "they do the moment this is served under the apex."
      : "The passkey plugin is not installed on this build.",
  };
}

function ssoCheck(env: SystemEnv): SystemCheck {
  const domain = resolveCookieDomain(env);
  return {
    id: "sso",
    label: "Cross-app sign-on",
    value: domain ? `Shared on ${domain}` : "Host-only",
    tone: domain ? "ok" : "info",
    detail: domain
      ? "Session cookies are scoped to the apex, so signing in on one app signs you in on all three."
      : "Cookies are scoped to this host alone, so each app needs its own sign-in. That is not a " +
        "misconfiguration: a preview host cannot share a cookie across the apex, and setting the " +
        "domain anyway would break every cookie rather than share it.",
    env: ["BETTER_AUTH_URL"],
  };
}

function cookieSecurityCheck(env: SystemEnv): SystemCheck {
  const insecure = resolveUseSecureCookies(env) === false;
  return {
    id: "secure-cookies",
    label: "Cookie security",
    value: insecure ? "Secure flag off" : "Secure flag on",
    tone: insecure ? "attention" : "ok",
    detail: insecure
      ? "The configured base URL is plain http://, so session cookies are issued without the Secure " +
        "flag — a browser would silently drop them otherwise, which is how a production build served " +
        "over http fails as 'sign-up succeeded but there is no session'. Correct for a local " +
        "end-to-end run; wrong anywhere reachable."
      : "Session cookies carry the Secure flag. Turning it off takes an explicit http:// base URL — it " +
        "is never inferred from the environment name.",
    env: ["BETTER_AUTH_URL"],
  };
}

function googleCheck(env: SystemEnv): SystemCheck {
  const base = {
    id: "google",
    label: "Google sign-in",
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  } as const;
  return isGoogleConfigured(env)
    ? {
        ...base,
        value: "Configured",
        tone: "ok",
        detail:
          "Offered alongside email and password, and linkable to an existing account with the same address.",
      }
    : {
        ...base,
        value: "Not configured",
        tone: "degraded",
        detail:
          "Both credentials are needed; the provider is wired only when both exist, so the button is " +
          "absent rather than present and broken.",
      };
}

function passwordPolicyCheck(): SystemCheck {
  return {
    id: "password-policy",
    label: "Password policy",
    value: `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`,
    tone: "info",
    detail:
      "Length is the only rule — no character-class requirements, no forced rotation. Composition " +
      "rules push people towards predictable manglings; a long passphrase is stronger and easier. " +
      "A password reset ends every other session.",
  };
}

/** The worst tone present, in the order a reader should care about it. */
function worstTone(checks: SystemCheck[]): CheckTone {
  if (checks.some((c) => c.tone === "attention")) return "attention";
  if (checks.some((c) => c.tone === "degraded")) return "degraded";
  return "ok";
}

/**
 * Assemble the whole report. Pure: same env + same probe → same page.
 */
export function deriveSystemStatus(
  env: SystemEnv,
  probe: DatabaseProbe,
): SystemStatus {
  const health: SystemCheck[] = [
    databaseCheck(env, probe),
    migrationCheck(env),
    referenceDataCheck(probe),
    authSecretCheck(env),
    emailCheck(env),
    blobCheck(env),
    encryptionCheck(env),
    deploymentCheck(env),
  ];
  const security: SystemCheck[] = [
    emailVerificationCheck(env),
    godBootstrapCheck(env),
    rateLimitCheck(env),
    sessionCheck(),
    secondFactorCheck(),
    passkeyCheck(env),
    ssoCheck(env),
    cookieSecurityCheck(env),
    googleCheck(env),
    passwordPolicyCheck(),
  ];

  const all = [...health, ...security];
  const tone = worstTone(all);
  const needing = all.filter((c) => c.tone === "attention");
  const degraded = all.filter((c) => c.tone === "degraded");

  // Name the things, don't just count them. "2 items need attention" makes a
  // reader hunt; naming them means the summary is sometimes the whole answer.
  const summary =
    tone === "attention"
      ? `Needs attention: ${needing.map((c) => c.label.toLowerCase()).join(", ")}.`
      : tone === "degraded"
        ? `Running with ${degraded.map((c) => c.label.toLowerCase()).join(", ")} unconfigured — each degrades honestly rather than failing.`
        : "Everything this page can check is configured and reachable.";

  return { health, security, headline: { tone, summary } };
}
