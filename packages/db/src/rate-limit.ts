// Rate limiting for SERVER ACTIONS.
//
// Better Auth's own limiter (configured in @quagga/auth, storage: "database")
// only sees traffic that arrives over HTTP at /api/auth/*. Our password-reset
// and sign-up surfaces are Next server actions that call `auth.api.*` in-process
// instead, which never touches that layer — so the endpoints with the strictest
// configured `customRules` were, in practice, unlimited. Measured during the
// 27 Jul 2026 audit: 3 direct HTTP POSTs got a 429, while 15/15 server-action
// calls were accepted and queued 15 reset emails.
//
// This is the missing counter.
//
// ## Why it has its own table (`action_rate_limit`), 29 Jul 2026
//
// It used to live in Better Auth's `rate_limit` table under an `action:` key
// namespace — "one place to look, one place to purge". That sharing quietly
// destroyed the limit it was implementing.
//
// Better Auth's database rate-limit storage prunes: after any successful window
// roll it runs `DELETE FROM rate_limit WHERE last_request < now - max(configured
// window, 10s, 60s)` — the whole table, not just its own keys (better-auth
// 1.6.25, dist/api/rate-limiter/index.mjs, `deleteExpiredRows`). With our config
// that cutoff is 60 seconds.
//
// Our rows put the WINDOW START in `last_request` and deliberately never move it
// while a window is open, so a forgot-password counter looked "60 seconds stale"
// for 14 of its 15 minutes and was deleted by the next piece of auth traffic to
// hit the table. The next attempt then inserted a fresh row with count = 1. The
// configured budget — 3 per 15 minutes across all three apps — behaved as 3 per
// minute, forever: enough to flood somebody's inbox with reset emails, which is
// the abuse this whole file exists to prevent.
//
// So: our own table, which nothing else writes to or sweeps. We do our own
// sweeping, in the same statement, on a horizon far longer than any window here
// (`STALE_ROW_HORIZON_MS`).

import { sql } from "drizzle-orm";
import { createHttpDb } from "./index";

/**
 * Forgot-password budget, shared by all three apps so the participant, org and
 * supplier front doors cannot be played off against each other. Mirrors the
 * `customRules` entry for /forget-password in @quagga/auth's env.ts — if you
 * change one, change both.
 */
export const FORGOT_PASSWORD_MAX_PER_WINDOW = 3;
export const FORGOT_PASSWORD_WINDOW_SECONDS = 15 * 60;

export interface RateLimitVerdict {
  allowed: boolean;
  /** Seconds until the window resets. 0 when allowed. */
  retryAfterSeconds: number;
}

const ALLOWED: RateLimitVerdict = { allowed: true, retryAfterSeconds: 0 };

/**
 * How long a row may sit untouched before the next `consumeRateLimit` deletes
 * it. Nothing else prunes this table now, and its keys are per-IP, so without a
 * sweep it grows one row per address that ever asked for a password reset.
 *
 * 24 hours, against a longest window of 15 minutes — generous by roughly two
 * orders of magnitude on purpose. The sweep runs with the CALLER'S clock and
 * knows nothing about other callers' window lengths, so a tight horizon could
 * let a short-window caller delete a long-window caller's live counter and hand
 * an attacker a reset. Deleting a row whose window ended is semantically free
 * (an expired counter and an absent one produce the same verdict); deleting a
 * live one is a hole.
 */
const STALE_ROW_HORIZON_MS = 24 * 60 * 60 * 1000;

/**
 * Count one attempt against a fixed window and say whether it may proceed.
 *
 * FAILS OPEN on a storage error, deliberately: every caller sits in front of a
 * flow that needs the same database, so a limiter outage would turn into a hard
 * outage of password reset rather than into abuse. The failure is logged.
 *
 * @param key   Namespaced by the caller, e.g. `forgot_password:198.51.100.7`.
 * @param max   Attempts permitted per window.
 */
export async function consumeRateLimit(input: {
  key: string;
  max: number;
  windowSeconds: number;
  now?: Date;
}): Promise<RateLimitVerdict> {
  const { key, max, windowSeconds } = input;
  const now = input.now ?? new Date();
  if (!process.env.DATABASE_URL) return ALLOWED;

  const nowMs = now.getTime();
  const windowStartCutoff = nowMs - windowSeconds * 1000;
  const staleCutoff = nowMs - STALE_ROW_HORIZON_MS;

  try {
    // One statement, so concurrent lambdas cannot interleave a read and a write
    // and both conclude they are under the limit. `window_start` is exactly
    // that: when it falls outside the window the counter restarts, otherwise it
    // increments and the start is left alone.
    //
    // The sweep rides along as a data-modifying CTE rather than a second round
    // trip. It EXCLUDES this call's own key — a CTE delete and the INSERT share
    // one snapshot, so a row deleted here and conflicted on below would be the
    // same tuple touched twice in one command.
    const rows = (await createHttpDb().execute(sql`
      WITH swept AS (
        DELETE FROM action_rate_limit
         WHERE window_start < ${staleCutoff}
           AND key <> ${key}
      )
      INSERT INTO action_rate_limit (key, count, window_start)
      VALUES (${key}, 1, ${nowMs})
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN action_rate_limit.window_start < ${windowStartCutoff} THEN 1
          ELSE action_rate_limit.count + 1
        END,
        window_start = CASE
          WHEN action_rate_limit.window_start < ${windowStartCutoff} THEN ${nowMs}
          ELSE action_rate_limit.window_start
        END
      RETURNING count, window_start
    `)) as unknown as { rows?: { count: number; window_start: number }[] };

    const row = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
    if (!row) return ALLOWED;

    const count = Number(row.count);
    if (count <= max) return ALLOWED;

    const windowEndsAt = Number(row.window_start) + windowSeconds * 1000;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowEndsAt - nowMs) / 1000)),
    };
  } catch (err) {
    console.error("[rate-limit] storage failure, allowing request", err);
    return ALLOWED;
  }
}

/**
 * The client IP as seen behind Vercel's proxy, for use as a limiter key.
 * Returns a stable fallback when there is no forwarded header, so an
 * unattributable caller shares one bucket rather than escaping the limit.
 */
export function rateLimitIp(headers: {
  get(name: string): string | null;
}): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}
