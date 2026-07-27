import { describe, it, expect } from "vitest";

import {
  deriveSystemStatus,
  humanDuration,
  redactSecrets,
  type DatabaseProbe,
  type SystemCheck,
  type SystemEnv,
} from "../system-status";

// The System panel's derivation, tested where it is decided.
//
// The first describe block is the one that matters most: NO SECRET IS EVER
// PRINTED. Every other property of this page is a convenience; that one is a
// promise, and it is made to a rank (engineer) that is specifically not trusted
// with personal information. So it is proved by construction — seed every secret
// env var with a marker, render the whole page's worth of strings, assert no
// marker survives — rather than by reading the source and believing it.

/** A marker that cannot occur naturally in any of this module's prose. */
const SECRET = "zzQUAGGA-SECRET-MARKERzz";

/** An env bag where EVERY credential is the marker, one way or another. */
function secretiveEnv(): SystemEnv {
  return {
    DATABASE_URL: `postgres://dbuser:${SECRET}@db.example.com:5432/quagga?sslmode=require`,
    DATABASE_URL_UNPOOLED: `postgres://dbuser:${SECRET}@db.example.com:5432/quagga?sslmode=require`,
    BETTER_AUTH_SECRET: `auth-${SECRET}`,
    BETTER_AUTH_URL: "https://org.quagga.ryanjnoble.dev",
    RESEND_API_KEY: `re_${SECRET}`,
    BLOB_READ_WRITE_TOKEN: `blob_${SECRET}`,
    GOOGLE_CLIENT_ID: `gid-${SECRET}`,
    GOOGLE_CLIENT_SECRET: `gsec-${SECRET}`,
    PGCRYPTO_KEY: `pg-${SECRET}`,
    GOD_EMAILS: `${SECRET}@example.com, second-${SECRET}@example.com`,
    AUTH_RATE_LIMIT_MAX: "500",
    AUTH_RATE_LIMIT_WINDOW_SECONDS: "60",
    VERCEL_ENV: "production",
  };
}

/** Every string this page would put on screen, flattened. */
function renderedStrings(
  env: SystemEnv,
  probe: DatabaseProbe,
): string[] {
  const status = deriveSystemStatus(env, probe);
  const checks = [...status.health, ...status.security];
  return [
    status.headline.summary,
    ...checks.flatMap((c) => [c.label, c.value, c.detail, ...(c.env ?? [])]),
  ];
}

function check(
  env: SystemEnv,
  probe: DatabaseProbe,
  id: string,
): SystemCheck {
  const status = deriveSystemStatus(env, probe);
  const found = [...status.health, ...status.security].find((c) => c.id === id);
  expect(found, `no check with id ${id}`).toBeDefined();
  return found as SystemCheck;
}

const OK_PROBE: DatabaseProbe = {
  kind: "ok",
  latencyMs: 12,
  edition: { name: "AfrikaBurn 2027", year: 2027 },
};

describe("no secret is ever printed", () => {
  it("survives a fully-populated environment of credentials", () => {
    for (const text of renderedStrings(secretiveEnv(), OK_PROBE)) {
      expect(text).not.toContain(SECRET);
    }
  });

  it("survives every probe outcome, including a driver error quoting the URL", () => {
    const env = secretiveEnv();
    const probes: DatabaseProbe[] = [
      { kind: "not_configured" },
      OK_PROBE,
      { kind: "ok", latencyMs: 3, edition: null },
      {
        // Exactly what a failing driver hands back: the connection string it
        // tried, password and all.
        kind: "unreachable",
        message: `connect ECONNREFUSED for ${env.DATABASE_URL}`,
      },
    ];
    for (const probe of probes) {
      for (const text of renderedStrings(env, probe)) {
        expect(text).not.toContain(SECRET);
      }
    }
  });

  it("survives the configurations that make planMigration THROW", () => {
    // The refusal message is rendered verbatim, and it names a host — so the
    // path most likely to leak a connection string is the error path.
    const pooled = `postgres://u:${SECRET}@ep-x-pooler.eu-central-1.aws.neon.tech/db`;
    for (const env of [
      { ...secretiveEnv(), DATABASE_URL_UNPOOLED: undefined, DATABASE_URL: pooled },
      { DATABASE_URL: pooled, VERCEL_ENV: "production" },
      { VERCEL_ENV: "production" }, // production with no database at all
    ]) {
      for (const text of renderedStrings(env, { kind: "not_configured" })) {
        expect(text).not.toContain(SECRET);
      }
    }
  });

  it("reports GOD_EMAILS as a count, never as addresses", () => {
    const bootstrap = check(secretiveEnv(), OK_PROBE, "god-emails");
    expect(bootstrap.value).toBe("2 addresses configured");
    expect(bootstrap.value).not.toContain("@");
    expect(bootstrap.detail).not.toContain("@example.com");
  });

  it("DOES show the database host — deliberately, and without its credentials", () => {
    // The one exception, asserted so that removing it is a decision rather than
    // an accident: "which database am I actually on" is what this page is for.
    const database = check(secretiveEnv(), OK_PROBE, "database");
    expect(database.detail).toContain("db.example.com");
    expect(database.detail).not.toContain("dbuser");
    expect(database.detail).not.toContain(SECRET);
  });
});

describe("redactSecrets", () => {
  const env: SystemEnv = {
    DATABASE_URL: "postgres://u:hunter2hunter2@host/db",
    RESEND_API_KEY: "re_abcdefghijklmnop",
  };

  it("replaces a whole connection string, credentials and all", () => {
    expect(redactSecrets("failed on postgres://u:hunter2hunter2@host/db", env)).toBe(
      "failed on [connection string redacted]",
    );
  });

  it("replaces a bare secret value with no URL around it", () => {
    expect(redactSecrets("key re_abcdefghijklmnop rejected", env)).toBe(
      "key [RESEND_API_KEY redacted] rejected",
    );
  });

  it("leaves ordinary prose alone", () => {
    expect(redactSecrets("The database did not answer.", env)).toBe(
      "The database did not answer.",
    );
  });

  it("does not blank out prose for a short secret", () => {
    // Replacing a 2-character secret would mangle every word containing it and
    // protect nothing — the value is not recoverable from prose anyway.
    const short = { PGCRYPTO_KEY: "ab" };
    expect(redactSecrets("a stable database", short)).toBe("a stable database");
  });
});

describe("health checks read the real configuration", () => {
  it("distinguishes an absent database from an unreachable one", () => {
    expect(check({}, { kind: "not_configured" }, "database").tone).toBe(
      "degraded",
    );
    expect(
      check({ DATABASE_URL: "postgres://u:p@h/d" }, { kind: "unreachable", message: "boom" }, "database")
        .tone,
    ).toBe("attention");
  });

  it("reports a migrated-but-unseeded database as needing attention", () => {
    // The state that reads as a broken env var when the environment is correct.
    const unseeded = check(
      { DATABASE_URL: "postgres://u:p@h/d" },
      { kind: "ok", latencyMs: 4, edition: null },
      "reference-data",
    );
    expect(unseeded.tone).toBe("attention");
    expect(unseeded.detail).toMatch(/seeds reference data/i);
  });

  it("renders the migration refusal the BUILD would fail with", () => {
    const refused = check(
      {
        DATABASE_URL: "postgres://u:p@ep-x-pooler.eu.aws.neon.tech/db",
        VERCEL_ENV: "production",
      },
      { kind: "not_configured" },
      "migrations",
    );
    expect(refused.value).toBe("Would refuse to run");
    expect(refused.tone).toBe("attention");
    expect(refused.detail).toMatch(/advisory locks/i);
  });

  it("is happy about the unpooled endpoint and wary of the fallback", () => {
    expect(
      check(
        { DATABASE_URL_UNPOOLED: "postgres://u:p@direct.neon.tech/db" },
        OK_PROBE,
        "migrations",
      ).tone,
    ).toBe("ok");
    expect(
      check(
        { DATABASE_URL: "postgres://u:p@localhost:5432/db" },
        OK_PROBE,
        "migrations",
      ).tone,
    ).toBe("degraded");
  });

  it("calls a too-short encryption key out rather than calling it set", () => {
    expect(check({ PGCRYPTO_KEY: "short" }, OK_PROBE, "encryption-key").value).toBe(
      "Set but too short",
    );
    expect(
      check({ PGCRYPTO_KEY: "a-perfectly-long-key" }, OK_PROBE, "encryption-key")
        .tone,
    ).toBe("ok");
  });
});

describe("security checks explain WHY, not just what", () => {
  it("attributes email verification being off to the missing sender", () => {
    const off = check({}, OK_PROBE, "email-verification");
    expect(off.value).toBe("Off — no email sender");
    expect(off.tone).toBe("degraded");
    // The whole point: someone reading this must not go looking for a switch.
    expect(off.detail).toMatch(/derived from provider presence/i);
  });

  it("separates 'no provider' from 'provider, but deliberately overridden'", () => {
    const overridden = check(
      {
        RESEND_API_KEY: "re_key",
        BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
      },
      OK_PROBE,
      "email-verification",
    );
    expect(overridden.value).toBe("Off — explicitly overridden");
    expect(overridden.tone).toBe("attention");

    const on = check({ RESEND_API_KEY: "re_key" }, OK_PROBE, "email-verification");
    expect(on.value).toBe("Required");
    expect(on.tone).toBe("ok");
  });

  it("treats a raised rate-limit ceiling as something to notice", () => {
    expect(check({}, OK_PROBE, "rate-limit").value).toBe("Library defaults");
    const raised = check(
      { AUTH_RATE_LIMIT_MAX: "500", AUTH_RATE_LIMIT_WINDOW_SECONDS: "60" },
      OK_PROBE,
      "rate-limit",
    );
    expect(raised.value).toBe("500 per 1 minute");
    expect(raised.tone).toBe("attention");
  });

  it("reports the session lifetime the auth stack actually uses", () => {
    // Read from @quagga/auth's AUTH_SESSION, which config.ts also consumes — so
    // this asserts the two cannot drift, not that 7 is 7.
    const session = check({}, OK_PROBE, "session");
    expect(session.value).toBe("7 days");
    expect(session.detail).toMatch(/revoked session can still be honoured/i);
  });

  it("names the passkey scope, because widening it later re-enrols everyone", () => {
    const apex = check(
      { BETTER_AUTH_URL: "https://org.quagga.ryanjnoble.dev" },
      OK_PROBE,
      "passkeys",
    );
    expect(apex.value).toMatch(/quagga\.ryanjnoble\.dev/);
    expect(check({}, OK_PROBE, "passkeys").value).toMatch(/this host/i);
  });

  it("flags cookies issued without the Secure flag", () => {
    expect(
      check({ BETTER_AUTH_URL: "http://localhost:3001" }, OK_PROBE, "secure-cookies")
        .tone,
    ).toBe("attention");
    expect(
      check(
        { BETTER_AUTH_URL: "https://org.quagga.ryanjnoble.dev" },
        OK_PROBE,
        "secure-cookies",
      ).tone,
    ).toBe("ok");
  });

  it("flags an empty GOD_EMAILS — nobody could then grant anything", () => {
    const none = check({}, OK_PROBE, "god-emails");
    expect(none.value).toBe("No addresses configured");
    expect(none.tone).toBe("attention");
  });
});

describe("the headline", () => {
  it("names what needs attention rather than counting it", () => {
    const { headline } = deriveSystemStatus({}, { kind: "not_configured" });
    expect(headline.tone).toBe("attention");
    // A count sends the reader hunting; a name is sometimes the whole answer.
    expect(headline.summary).toMatch(/needs attention:/i);
    expect(headline.summary).toMatch(/auth signing secret/i);
  });

  it("says 'degraded, on purpose' when nothing is actually wrong", () => {
    const env: SystemEnv = {
      DATABASE_URL_UNPOOLED: "postgres://u:p@direct.neon.tech/db",
      DATABASE_URL: "postgres://u:p@direct.neon.tech/db",
      BETTER_AUTH_SECRET: "a-real-secret-value-here",
      BETTER_AUTH_URL: "https://org.quagga.ryanjnoble.dev",
      RESEND_API_KEY: "re_key",
      PGCRYPTO_KEY: "a-perfectly-long-key",
      GOD_EMAILS: "someone@example.com",
    };
    const { headline } = deriveSystemStatus(env, OK_PROBE);
    expect(headline.tone).toBe("degraded");
    expect(headline.summary).toMatch(/degrades honestly/i);
    // Blob and Google are the two left unset here.
    expect(headline.summary).toMatch(/file uploads/i);
  });

  it("is clean when everything this page can check is configured", () => {
    const env: SystemEnv = {
      DATABASE_URL_UNPOOLED: "postgres://u:p@direct.neon.tech/db",
      DATABASE_URL: "postgres://u:p@direct.neon.tech/db",
      BETTER_AUTH_SECRET: "a-real-secret-value-here",
      BETTER_AUTH_URL: "https://org.quagga.ryanjnoble.dev",
      RESEND_API_KEY: "re_key",
      BLOB_READ_WRITE_TOKEN: "blob_token",
      GOOGLE_CLIENT_ID: "gid",
      GOOGLE_CLIENT_SECRET: "gsecret",
      PGCRYPTO_KEY: "a-perfectly-long-key",
      GOD_EMAILS: "someone@example.com, another@example.com",
    };
    const { headline } = deriveSystemStatus(env, OK_PROBE);
    expect(headline.tone).toBe("ok");
  });
});

describe("humanDuration", () => {
  it("prefers the largest whole unit", () => {
    expect(humanDuration(60 * 60 * 24 * 7)).toBe("7 days");
    expect(humanDuration(60 * 60 * 24)).toBe("1 day");
    expect(humanDuration(60 * 60 * 2)).toBe("2 hours");
    expect(humanDuration(300)).toBe("5 minutes");
    expect(humanDuration(60)).toBe("1 minute");
    expect(humanDuration(45)).toBe("45 seconds");
    expect(humanDuration(90)).toBe("90 seconds");
  });
});
