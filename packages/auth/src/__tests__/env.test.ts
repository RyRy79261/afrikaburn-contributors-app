import { describe, it, expect } from "vitest";
import {
  authConfigWarnings,
  isAuthConfigured,
  isEmailProviderConfigured,
  isGoogleConfigured,
  isUnderApex,
  parseBoolEnv,
  resolveApexDomain,
  resolveBaseURL,
  resolveCookieDomain,
  resolvePasskeyOrigins,
  resolvePasskeyRpID,
  resolveProductionOrigins,
  resolveRateLimit,
  resolveRequireEmailVerification,
  resolveTrustedOrigins,
  resolveUseSecureCookies,
  type AuthEnv,
} from "../env";

// A fictional apex used throughout — the resolvers are pure functions of
// AUTH_APEX_DOMAIN, so any registrable domain exercises the same logic a real
// deployment's apex would. Never a real or personal domain.
const TEST_APEX = "contributors.example";
const withApex = (env: AuthEnv = {}): AuthEnv => ({
  ...env,
  AUTH_APEX_DOMAIN: TEST_APEX,
});

describe("isAuthConfigured", () => {
  it("is true only when the shared secret is present", () => {
    expect(isAuthConfigured({})).toBe(false);
    expect(isAuthConfigured({ BETTER_AUTH_SECRET: "x" })).toBe(true);
  });
});

describe("resolveBaseURL", () => {
  it("prefers the explicit production URL", () => {
    expect(
      resolveBaseURL({
        BETTER_AUTH_URL: `https://app.${TEST_APEX}`,
        VERCEL_URL: "preview.vercel.app",
      }),
    ).toBe(`https://app.${TEST_APEX}`);
  });

  it("falls back to the Vercel preview URL (adding https)", () => {
    expect(resolveBaseURL({ VERCEL_URL: "preview.vercel.app" })).toBe(
      "https://preview.vercel.app",
    );
  });

  it("is undefined env-less (Better Auth infers from the request)", () => {
    expect(resolveBaseURL({})).toBeUndefined();
  });
});

describe("resolveApexDomain", () => {
  it("is undefined when AUTH_APEX_DOMAIN is unset — no personal or built-in default", () => {
    expect(resolveApexDomain({})).toBeUndefined();
  });

  it("trims whitespace and treats a blank value as unset", () => {
    expect(resolveApexDomain({ AUTH_APEX_DOMAIN: `  ${TEST_APEX}  ` })).toBe(
      TEST_APEX,
    );
    expect(resolveApexDomain({ AUTH_APEX_DOMAIN: "   " })).toBeUndefined();
  });
});

describe("cross-subdomain cookie scoping", () => {
  it("scopes to the apex only when served under the configured apex", () => {
    expect(
      resolveCookieDomain(
        withApex({ BETTER_AUTH_URL: `https://org.${TEST_APEX}` }),
      ),
    ).toBe(`.${TEST_APEX}`);
    expect(
      isUnderApex(withApex({ BETTER_AUTH_URL: `https://${TEST_APEX}` })),
    ).toBe(true);
  });

  it("never scopes when no apex is configured, however the host looks", () => {
    expect(
      resolveCookieDomain({ BETTER_AUTH_URL: `https://org.${TEST_APEX}` }),
    ).toBeUndefined();
    expect(isUnderApex({ BETTER_AUTH_URL: `https://${TEST_APEX}` })).toBe(
      false,
    );
  });

  it("does NOT scope on a *.vercel.app preview or localhost, even with an apex configured", () => {
    expect(
      resolveCookieDomain(withApex({ VERCEL_URL: "preview.vercel.app" })),
    ).toBeUndefined();
    expect(
      resolveCookieDomain(
        withApex({ BETTER_AUTH_URL: "http://localhost:3000" }),
      ),
    ).toBeUndefined();
    expect(resolveCookieDomain(withApex())).toBeUndefined();
  });

  it("is not fooled by an apex-suffix lookalike host", () => {
    expect(
      resolveCookieDomain(
        withApex({ BETTER_AUTH_URL: `https://${TEST_APEX}.evil.com` }),
      ),
    ).toBeUndefined();
  });

  it("treats an unparseable BETTER_AUTH_URL as NOT under the apex", () => {
    // A typo'd base URL must fail closed. Reading it as apex-hosted would
    // silently switch on cross-subdomain cookie scoping for an origin that
    // cannot carry it, which breaks every cookie the deployment sets.
    expect(isUnderApex(withApex({ BETTER_AUTH_URL: `app.${TEST_APEX}` }))).toBe(
      false,
    );
    expect(
      resolveCookieDomain(withApex({ BETTER_AUTH_URL: "not a url at all" })),
    ).toBeUndefined();
    // …and the same typo must not poison the trusted-origins list either.
    expect(
      resolveTrustedOrigins(withApex({ BETTER_AUTH_URL: "not a url at all" })),
    ).toEqual(resolveProductionOrigins(withApex()));
  });
});

// --- Secure cookies (derived from the ORIGIN, never NODE_ENV) -------------

describe("resolveUseSecureCookies", () => {
  it("only an explicit http:// base URL turns Secure off", () => {
    // The one real case: a PRODUCTION build served over plain http, which is
    // exactly how the E2E suite runs the apps locally. There the browser drops
    // every __Secure- cookie and sign-up "succeeds" with no session at all.
    expect(
      resolveUseSecureCookies({ BETTER_AUTH_URL: "http://localhost:3000" }),
    ).toBe(false);
  });

  it("is undefined everywhere else, so Better Auth's secure default stands", () => {
    // undefined is NOT the same as false here: it leaves the key off the
    // options object entirely, so a real deployment can never accidentally
    // opt out of Secure cookies by being misread.
    expect(resolveUseSecureCookies({})).toBeUndefined();
    expect(
      resolveUseSecureCookies({ BETTER_AUTH_URL: `https://app.${TEST_APEX}` }),
    ).toBeUndefined();
    // A Vercel preview URL carries no protocol and is resolved to https.
    expect(
      resolveUseSecureCookies({ VERCEL_URL: "preview.vercel.app" }),
    ).toBeUndefined();
  });
});

// --- Rate limiting (the most dangerous config in the package) -------------

describe("resolveRateLimit", () => {
  it("returns {} for anything that is not a positive number", () => {
    // {} keeps Better Auth's own secure defaults. This resolver can only ever
    // LOOSEN the limiter deliberately — a typo, a zero or a negative must not
    // quietly become a ceiling, because the fix people reach for when the
    // limiter looks broken is turning the limiter off.
    expect(resolveRateLimit({})).toEqual({});
    expect(resolveRateLimit({ AUTH_RATE_LIMIT_MAX: "0" })).toEqual({});
    expect(resolveRateLimit({ AUTH_RATE_LIMIT_MAX: "-5" })).toEqual({});
    expect(resolveRateLimit({ AUTH_RATE_LIMIT_MAX: "lots" })).toEqual({});
    expect(resolveRateLimit({ AUTH_RATE_LIMIT_WINDOW_SECONDS: "0" })).toEqual(
      {},
    );
    expect(
      resolveRateLimit({ AUTH_RATE_LIMIT_WINDOW_SECONDS: "soon" }),
    ).toEqual({});
  });

  it("raising the max also raises the four sensitive paths", () => {
    // Better Auth ships STRICTER built-in rules for these paths and those beat
    // the global `max`, so raising only the global ceiling still returns 429 on
    // sign-up — which is exactly what happened to the E2E suite, whose parallel
    // workers all share 127.0.0.1.
    const limit = resolveRateLimit({
      AUTH_RATE_LIMIT_MAX: "500",
      AUTH_RATE_LIMIT_WINDOW_SECONDS: "10",
    });

    expect(limit.max).toBe(500);
    expect(limit.window).toBe(10);
    expect(Object.keys(limit.customRules ?? {}).sort()).toEqual([
      "/forget-password",
      "/reset-password",
      "/sign-in/email",
      "/sign-up/email",
    ]);
    for (const rule of Object.values(limit.customRules ?? {})) {
      expect(rule).toEqual({ window: 10, max: 500 });
    }
  });

  it("defaults the per-rule window to 60 seconds when only a max is set", () => {
    const limit = resolveRateLimit({ AUTH_RATE_LIMIT_MAX: "500" });

    expect(limit.window).toBeUndefined();
    expect(limit.customRules?.["/sign-up/email"]).toEqual({
      window: 60,
      max: 500,
    });
  });

  it("a window alone yields no custom rules at all", () => {
    // Without a max there is nothing to raise, and inventing one here would be
    // this resolver loosening the limiter on its own.
    const limit = resolveRateLimit({ AUTH_RATE_LIMIT_WINDOW_SECONDS: "10" });

    expect(limit).toEqual({ window: 10 });
  });
});

// --- Passkeys: rpID and expected origins ---------------------------------

describe("passkey rpID and origins", () => {
  it("scopes to the configured apex, with all three production origins, under the apex", () => {
    // ONE passkey has to work on app., org. and suppliers., which is what an
    // apex rpID plus all three expected origins buys. Widening it later would
    // mean re-enrolling every user.
    const env: AuthEnv = withApex({
      BETTER_AUTH_URL: `https://app.${TEST_APEX}`,
    });

    expect(resolvePasskeyRpID(env)).toBe(TEST_APEX);
    expect(resolvePasskeyOrigins(env)?.sort()).toEqual(
      resolveProductionOrigins(env).sort(),
    );
  });

  it("is undefined off the apex, so the plugin derives it from the request", () => {
    // A browser rejects an rpID that is not a suffix of its own origin, so
    // handing localhost or a *.vercel.app preview the apex would break passkeys
    // outright rather than degrade them.
    for (const env of [
      withApex(),
      withApex({ BETTER_AUTH_URL: "http://localhost:3000" }),
      withApex({ VERCEL_URL: "preview.vercel.app" }),
    ]) {
      expect(resolvePasskeyRpID(env)).toBeUndefined();
      expect(resolvePasskeyOrigins(env)).toBeUndefined();
    }
  });

  it("is undefined with no apex configured at all, even under what would be the apex", () => {
    expect(
      resolvePasskeyRpID({ BETTER_AUTH_URL: `https://${TEST_APEX}` }),
    ).toBeUndefined();
    expect(
      resolvePasskeyOrigins({ BETTER_AUTH_URL: `https://${TEST_APEX}` }),
    ).toBeUndefined();
  });
});

describe("parseBoolEnv", () => {
  it("parses common truthy/falsey spellings, else undefined", () => {
    expect(parseBoolEnv("true")).toBe(true);
    expect(parseBoolEnv("1")).toBe(true);
    expect(parseBoolEnv("off")).toBe(false);
    expect(parseBoolEnv("0")).toBe(false);
    expect(parseBoolEnv(undefined)).toBeUndefined();
    expect(parseBoolEnv("maybe")).toBeUndefined();
  });
});

describe("resolveRequireEmailVerification (DERIVED, never a hardcoded weakening)", () => {
  it("is false with no provider — verification is impossible without a sender", () => {
    expect(resolveRequireEmailVerification({})).toBe(false);
    expect(
      resolveRequireEmailVerification({
        BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
      }),
    ).toBe(false);
  });

  it("is true once a provider exists (default)", () => {
    expect(resolveRequireEmailVerification({ RESEND_API_KEY: "re_x" })).toBe(
      true,
    );
  });

  it("honours an explicit opt-out only when a provider exists", () => {
    expect(
      resolveRequireEmailVerification({
        RESEND_API_KEY: "re_x",
        BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
      }),
    ).toBe(false);
  });
});

describe("resolveProductionOrigins", () => {
  it("is empty when no apex is configured — there is no fixed set to trust", () => {
    expect(resolveProductionOrigins({})).toEqual([]);
  });

  it("derives the three subdomain origins from the configured apex", () => {
    expect(resolveProductionOrigins(withApex()).sort()).toEqual(
      [
        `https://app.${TEST_APEX}`,
        `https://org.${TEST_APEX}`,
        `https://suppliers.${TEST_APEX}`,
      ].sort(),
    );
  });
});

describe("resolveTrustedOrigins", () => {
  it("includes the three production origins when an apex is configured, absolute, no wildcards", () => {
    const origins = resolveTrustedOrigins(withApex());
    for (const o of resolveProductionOrigins(withApex()))
      expect(origins).toContain(o);
    expect(origins.some((o) => o.includes("*"))).toBe(false);
  });

  it("is just this deployment's own origin when no apex is configured", () => {
    const origins = resolveTrustedOrigins({ VERCEL_URL: "preview.vercel.app" });
    expect(origins).toEqual(["https://preview.vercel.app"]);
  });

  it("adds this deployment's own origin when set, deduped", () => {
    const origins = resolveTrustedOrigins(
      withApex({ VERCEL_URL: "preview.vercel.app" }),
    );
    expect(origins).toContain("https://preview.vercel.app");
    expect(new Set(origins).size).toBe(origins.length);
  });
});

describe("isGoogleConfigured / isEmailProviderConfigured", () => {
  it("needs both Google id and secret", () => {
    expect(isGoogleConfigured({ GOOGLE_CLIENT_ID: "id" })).toBe(false);
    expect(
      isGoogleConfigured({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }),
    ).toBe(true);
  });

  it("email provider follows RESEND_API_KEY", () => {
    expect(isEmailProviderConfigured({})).toBe(false);
    expect(isEmailProviderConfigured({ RESEND_API_KEY: "re_x" })).toBe(true);
  });
});

describe("authConfigWarnings", () => {
  it("warns loudly when the secret is missing", () => {
    const w = authConfigWarnings({});
    expect(w.join(" ")).toMatch(/BETTER_AUTH_SECRET/);
  });

  it("warns that verification/reset are off when a secret exists but no provider", () => {
    const w = authConfigWarnings({ BETTER_AUTH_SECRET: "x" });
    expect(w.join(" ")).toMatch(/email verification is DISABLED/i);
  });

  it("warns when verification is explicitly disabled despite a provider", () => {
    const w = authConfigWarnings({
      BETTER_AUTH_SECRET: "x",
      RESEND_API_KEY: "re_x",
      BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
    });
    expect(w.join(" ")).toMatch(/not gated on email verification/i);
  });

  it("warns in production when an apex is configured but not served under it", () => {
    const env: AuthEnv = withApex({
      BETTER_AUTH_SECRET: "x",
      RESEND_API_KEY: "re_x",
      VERCEL_ENV: "production",
      BETTER_AUTH_URL: "https://app.example.vercel.app",
    });
    expect(authConfigWarnings(env).join(" ")).toMatch(/cross-subdomain SSO/i);
  });

  it("warns in production when no apex is configured at all", () => {
    const env: AuthEnv = {
      BETTER_AUTH_SECRET: "x",
      RESEND_API_KEY: "re_x",
      VERCEL_ENV: "production",
      BETTER_AUTH_URL: `https://app.${TEST_APEX}`,
    };
    expect(authConfigWarnings(env).join(" ")).toMatch(
      /AUTH_APEX_DOMAIN is not set/i,
    );
  });

  it("is silent when fully and correctly configured under the apex", () => {
    const env: AuthEnv = withApex({
      BETTER_AUTH_SECRET: "x",
      RESEND_API_KEY: "re_x",
      VERCEL_ENV: "production",
      BETTER_AUTH_URL: `https://app.${TEST_APEX}`,
    });
    expect(authConfigWarnings(env)).toEqual([]);
  });
});
