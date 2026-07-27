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
// This is the missing counter. It shares Better Auth's `rate_limit` table (one
// place to look, one place to purge) under an `action:` key namespace so the two
// can never collide.

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

  const namespaced = `action:${key}`;
  const nowMs = now.getTime();
  const windowStartCutoff = nowMs - windowSeconds * 1000;

  try {
    // One statement, so concurrent lambdas cannot interleave a read and a write
    // and both conclude they are under the limit. `last_request` holds the
    // WINDOW START for our rows: when it falls outside the window the counter
    // restarts, otherwise it increments and the start is left alone.
    const rows = (await createHttpDb().execute(sql`
      INSERT INTO rate_limit (id, key, count, last_request)
      VALUES (${namespaced}, ${namespaced}, 1, ${nowMs})
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limit.last_request < ${windowStartCutoff} THEN 1
          ELSE rate_limit.count + 1
        END,
        last_request = CASE
          WHEN rate_limit.last_request < ${windowStartCutoff} THEN ${nowMs}
          ELSE rate_limit.last_request
        END
      RETURNING count, last_request
    `)) as unknown as { rows?: { count: number; last_request: number }[] };

    const row = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
    if (!row) return ALLOWED;

    const count = Number(row.count);
    if (count <= max) return ALLOWED;

    const windowEndsAt = Number(row.last_request) + windowSeconds * 1000;
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
