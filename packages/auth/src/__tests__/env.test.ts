import { describe, it, expect } from "vitest";
import {
  AUTH_APEX_DOMAIN,
  AUTH_COOKIE_DOMAIN,
  PRODUCTION_ORIGINS,
  authConfigWarnings,
  isAuthConfigured,
  isEmailProviderConfigured,
  isGoogleConfigured,
  isUnderApex,
  parseBoolEnv,
  resolveBaseURL,
  resolveCookieDomain,
  resolveRequireEmailVerification,
  resolveTrustedOrigins,
  type AuthEnv,
} from "../env";

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
        BETTER_AUTH_URL: "https://app.quagga.ryanjnoble.dev",
        VERCEL_URL: "preview.vercel.app",
      }),
    ).toBe("https://app.quagga.ryanjnoble.dev");
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

describe("cross-subdomain cookie scoping", () => {
  it("scopes to the apex only when served under the apex", () => {
    expect(
      resolveCookieDomain({ BETTER_AUTH_URL: "https://org.quagga.ryanjnoble.dev" }),
    ).toBe(AUTH_COOKIE_DOMAIN);
    expect(isUnderApex({ BETTER_AUTH_URL: `https://${AUTH_APEX_DOMAIN}` })).toBe(true);
  });

  it("does NOT scope on a *.vercel.app preview or localhost", () => {
    expect(resolveCookieDomain({ VERCEL_URL: "preview.vercel.app" })).toBeUndefined();
    expect(resolveCookieDomain({ BETTER_AUTH_URL: "http://localhost:3000" })).toBeUndefined();
    expect(resolveCookieDomain({})).toBeUndefined();
  });

  it("is not fooled by an apex-suffix lookalike host", () => {
    expect(
      resolveCookieDomain({ BETTER_AUTH_URL: "https://quagga.ryanjnoble.dev.evil.com" }),
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
    expect(resolveRequireEmailVerification({ RESEND_API_KEY: "re_x" })).toBe(true);
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

describe("resolveTrustedOrigins", () => {
  it("always includes the three production origins, absolute, no wildcards", () => {
    const origins = resolveTrustedOrigins({});
    for (const o of PRODUCTION_ORIGINS) expect(origins).toContain(o);
    expect(origins.some((o) => o.includes("*"))).toBe(false);
  });

  it("adds this deployment's own origin when set, deduped", () => {
    const origins = resolveTrustedOrigins({ VERCEL_URL: "preview.vercel.app" });
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

  it("warns in production when not served under the apex", () => {
    const env: AuthEnv = {
      BETTER_AUTH_SECRET: "x",
      RESEND_API_KEY: "re_x",
      VERCEL_ENV: "production",
      BETTER_AUTH_URL: "https://app.example.vercel.app",
    };
    expect(authConfigWarnings(env).join(" ")).toMatch(/cross-subdomain SSO/i);
  });

  it("is silent when fully and correctly configured under the apex", () => {
    const env: AuthEnv = {
      BETTER_AUTH_SECRET: "x",
      RESEND_API_KEY: "re_x",
      VERCEL_ENV: "production",
      BETTER_AUTH_URL: "https://app.quagga.ryanjnoble.dev",
    };
    expect(authConfigWarnings(env)).toEqual([]);
  });
});
