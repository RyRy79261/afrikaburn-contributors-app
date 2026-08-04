import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isAuthConfigured,
  isDatabaseConfigured,
  missingConfig,
  participantAppUrl,
} from "@/lib/config";

// The boot probes the whole env-less rule rests on (lib/config.ts).
//
// Small, but hard engineering rule 4 — all three apps must boot env-less to a
// graceful "not configured" state — is enforced by exactly these four
// functions. And `participantAppUrl`'s fallback is what makes the account
// Delete tab's link work with no env set: deletion is requested on the
// participant app, which owns the eligibility checks, the grace period and the
// sweeper. A wrong fallback sends a supplier to a dead link at the exact moment
// they are trying to delete their account.

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "");
  vi.stubEnv("DATABASE_URL", "");
  // UNSET, not blank. `participantAppUrl` falls back with `??`, so a var set to
  // the empty string is "configured" as far as it is concerned — worth knowing
  // when reading a Vercel env list, and not what this case is about.
  vi.stubEnv("NEXT_PUBLIC_PARTICIPANT_APP_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the two service probes", () => {
  it("are false with the vars unset", () => {
    expect(isAuthConfigured()).toBe(false);
    expect(isDatabaseConfigured()).toBe(false);
  });

  it("are true once each var is set", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "shared-across-all-three-apps");
    vi.stubEnv("DATABASE_URL", "postgres://neon/quagga");

    expect(isAuthConfigured()).toBe(true);
    expect(isDatabaseConfigured()).toBe(true);
  });
});

describe("participantAppUrl", () => {
  it("falls back to the participant app's dev port when unset", () => {
    // Port 3000 is apps/web. Getting this wrong points the Delete tab at this
    // app (3002) or the console (3001), neither of which owns deletion.
    expect(participantAppUrl()).toBe("http://localhost:3000");
  });

  it("honours the configured value when it is set", () => {
    vi.stubEnv("NEXT_PUBLIC_PARTICIPANT_APP_URL", "https://quagga.example.org");

    expect(participantAppUrl()).toBe("https://quagga.example.org");
  });
});

describe("missingConfig", () => {
  it("names both backing services when neither is configured", () => {
    expect(missingConfig()).toEqual([
      "Better Auth (sign-in)",
      "Neon Postgres (database)",
    ]);
  });

  it("shrinks as each service is configured", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "shared-across-all-three-apps");

    expect(missingConfig()).toEqual(["Neon Postgres (database)"]);
  });

  it("is empty once both are configured", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "shared-across-all-three-apps");
    vi.stubEnv("DATABASE_URL", "postgres://neon/quagga");

    expect(missingConfig()).toEqual([]);
  });
});
