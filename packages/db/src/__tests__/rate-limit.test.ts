import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The limiter's ONE statement is replaced here. That is deliberate and it is
// also the limit of what this file proves: it pins the VERDICT logic — the
// boundary, the retry-after arithmetic, both driver result shapes, and the
// fail-open — not that Postgres accepts the data-modifying CTE. Whether the
// statement runs is e2e/live territory; a green run here is not evidence of it.
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../index", () => ({ createHttpDb: () => ({ execute }) }));

import { consumeRateLimit, rateLimitIp } from "../rate-limit";

const REAL_DATABASE_URL = process.env.DATABASE_URL;

/** Headers, as a Next `Request` hands them over. */
function headers(entries: Record<string, string>): {
  get(n: string): string | null;
} {
  return { get: (name) => entries[name] ?? null };
}

/** The row the RETURNING clause yields, in the neon-http (bare array) shape. */
function httpRows(count: number, windowStart: number) {
  return [{ count, window_start: windowStart }];
}

beforeEach(() => {
  execute.mockReset();
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
});

afterEach(() => {
  if (REAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = REAL_DATABASE_URL;
  vi.restoreAllMocks();
});

describe("rateLimitIp", () => {
  it("takes the FIRST entry of x-forwarded-for, trimmed", () => {
    // Vercel APPENDS its own proxies to this header. Taking the last entry
    // would bucket every caller in the world under one proxy address, and the
    // per-IP limit would silently become a global one.
    expect(
      rateLimitIp(headers({ "x-forwarded-for": " 198.51.100.7 , 10.0.0.1 " })),
    ).toBe("198.51.100.7");
  });

  it("falls back to x-real-ip, and prefers x-forwarded-for when both are present", () => {
    expect(rateLimitIp(headers({ "x-real-ip": "203.0.113.9" }))).toBe(
      "203.0.113.9",
    );
    expect(
      rateLimitIp(
        headers({
          "x-forwarded-for": "198.51.100.7",
          "x-real-ip": "203.0.113.9",
        }),
      ),
    ).toBe("198.51.100.7");
  });

  it("returns the literal string 'unknown' — never an empty key", () => {
    // The exact string matters. An empty key would let every unattributable
    // caller occupy its own bucket and escape the limit entirely; "unknown"
    // makes them share ONE. A blank x-forwarded-for must fall through too, not
    // be taken as a key.
    expect(rateLimitIp(headers({}))).toBe("unknown");
    expect(rateLimitIp(headers({ "x-forwarded-for": "  " }))).toBe("unknown");
    expect(rateLimitIp(headers({ "x-forwarded-for": "" }))).toBe("unknown");
  });
});

describe("consumeRateLimit", () => {
  const WINDOW = 15 * 60;
  const NOW = new Date("2026-08-04T12:00:00.000Z");

  it("allows without touching the driver when no DB is configured", async () => {
    // AGENTS.md rule 4: all three apps boot env-less. A limiter that reached for
    // a database during a DB-less build would crash the build it is running in.
    delete process.env.DATABASE_URL;
    await expect(
      consumeRateLimit({
        key: "forgot_password:1.2.3.4",
        max: 3,
        windowSeconds: WINDOW,
      }),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("allows the max'th attempt and refuses the one after it", async () => {
    // Both sides of `count <= max`. An off-by-one here is the difference
    // between three reset emails to somebody's inbox and four.
    execute.mockResolvedValueOnce(httpRows(3, NOW.getTime()));
    await expect(
      consumeRateLimit({ key: "k", max: 3, windowSeconds: WINDOW, now: NOW }),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });

    execute.mockResolvedValueOnce(httpRows(4, NOW.getTime()));
    const refused = await consumeRateLimit({
      key: "k",
      max: 3,
      windowSeconds: WINDOW,
      now: NOW,
    });
    expect(refused.allowed).toBe(false);
  });

  it("computes retryAfterSeconds from the row's window_start, not from now", async () => {
    // The window is FIXED: it started when the first attempt landed and it ends
    // `windowSeconds` later. Measuring from `now` instead would restart the
    // clock on every refused attempt and hold a caller out forever.
    const windowStart = NOW.getTime() - 300_000; // five minutes into a 15-minute window
    execute.mockResolvedValueOnce(httpRows(4, windowStart));
    await expect(
      consumeRateLimit({ key: "k", max: 3, windowSeconds: WINDOW, now: NOW }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 600 });
  });

  it("never returns a retry-after of 0 or less, even past the window's end", async () => {
    // A 0 tells the client to retry immediately, which is a hot loop against
    // the very endpoint being protected. `Math.max(1, ...)` is that floor.
    execute.mockResolvedValueOnce(
      httpRows(9, NOW.getTime() - WINDOW * 1000 - 60_000),
    );
    const verdict = await consumeRateLimit({
      key: "k",
      max: 3,
      windowSeconds: WINDOW,
      now: NOW,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(1);
  });

  it("reads BOTH driver result shapes — bare array and { rows }", async () => {
    // index.ts swaps neon-http for neon-serverless under NEON_LOCAL_PROXY, and
    // `execute()` is the one call whose return shape differs between them. If
    // only one shape were handled, flipping the transport would quietly disable
    // the limiter rather than fail.
    execute.mockResolvedValueOnce(httpRows(4, NOW.getTime()));
    const fromArray = await consumeRateLimit({
      key: "k",
      max: 3,
      windowSeconds: WINDOW,
      now: NOW,
    });

    execute.mockResolvedValueOnce({ rows: httpRows(4, NOW.getTime()) });
    const fromRows = await consumeRateLimit({
      key: "k",
      max: 3,
      windowSeconds: WINDOW,
      now: NOW,
    });

    expect(fromArray).toEqual({ allowed: false, retryAfterSeconds: WINDOW });
    expect(fromRows).toEqual(fromArray);
  });

  it("fails OPEN on an empty result", async () => {
    execute.mockResolvedValueOnce([]);
    await expect(
      consumeRateLimit({ key: "k", max: 3, windowSeconds: WINDOW, now: NOW }),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("fails OPEN and logs when the storage throws", async () => {
    // Deliberate: every caller sits in front of a flow that needs the same
    // database, so a limiter outage must not become a password-reset outage.
    // The log is the other half — failing open silently would hide it.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    execute.mockRejectedValueOnce(new Error("connection terminated"));
    await expect(
      consumeRateLimit({ key: "k", max: 3, windowSeconds: WINDOW, now: NOW }),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(logged).toHaveBeenCalledOnce();
    expect(String(logged.mock.calls[0]?.[0])).toContain("[rate-limit]");
  });

  it("issues exactly ONE statement per call", async () => {
    // One statement is what stops two concurrent lambdas interleaving a read and
    // a write and both concluding they are under the limit. A second round trip
    // would reintroduce that race.
    execute.mockResolvedValueOnce(httpRows(1, NOW.getTime()));
    await consumeRateLimit({
      key: "k",
      max: 3,
      windowSeconds: WINDOW,
      now: NOW,
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});
