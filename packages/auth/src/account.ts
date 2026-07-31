import { desc, eq } from "drizzle-orm";
import { createHttpDb, schema } from "@quagga/db";
import { isSanitized } from "@quagga/core";
import type { SecurityEventLogKind } from "@quagga/types";

import { auth } from "./config";
import { isAuthConfigured } from "./env";

// THE READ SIDE OF ACCOUNT SECURITY, for all three apps (roadmap M4-21).
//
// Every function here answers a question about ONE Better Auth identity —
// "where am I signed in?", "what passkeys do I have?", "is 2FA on?", "how do I
// sign in at all?" — and none of them knows or cares whether the asker is a
// burner, an organiser or a supplier. They lived in `apps/web/lib/account.ts`
// while the participant app was the only door; org and suppliers are doors too,
// and three copies of a security read is how the three drift apart. One copy,
// here, next to the auth server that answers them.
//
// FRAMEWORK-FREE ON PURPOSE. The app passes its own `await headers()` rather
// than this module importing `next/headers`: @quagga/auth is used by scripts and
// tests that have no request, and a package that reaches for the request context
// itself cannot be called from them.
//
// EVERY READ DEGRADES, NONE THROWS. An unreachable database or auth server must
// leave the security page rendering with an honest empty state — a blank page
// tells the reader nothing about their account, which on a security surface is
// worse than "we couldn't load this".

function authReady(): boolean {
  return isAuthConfigured(process.env);
}

function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- Cookies a server action must hand back -------------------------------

/** One `Set-Cookie`, in the shape Next's cookie store takes. */
export interface ParsedSetCookie {
  name: string;
  value: string;
  options: {
    path?: string;
    domain?: string;
    maxAge?: number;
    expires?: Date;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
  };
}

/**
 * Turn Better Auth's response `Set-Cookie` headers into something a Next server
 * action can put in the cookie store.
 *
 * WHY THIS HAS TO EXIST. Calling `auth.api.*` from a server action bypasses the
 * `/api/auth/*` route handler, so nothing is listening for the headers Better
 * Auth wants to send back — Next discards them. That is invisible for the calls
 * that only read, and it silently breaks the one that ROTATES THE SESSION:
 *
 *   Measured: change a password with "sign out my other devices" on. Better Auth
 *   deletes every session including the caller's, issues a fresh one, and hands
 *   back the new cookie. It goes nowhere. The browser keeps the old cookie,
 *   which now names a row that no longer exists, and stays "signed in" only for
 *   as long as the 5-minute session cookie CACHE lasts — after which the person
 *   who just secured their account is signed out with no explanation. Until
 *   then, the security page cannot find their session in the list and offers to
 *   revoke every row on it, including the one they are sitting on.
 *
 * Parsing lives here, next to the auth server, rather than in three apps.
 * APPLYING it stays in each app, because `next/headers` is a dependency
 * @quagga/auth deliberately does not take (it is also imported by scripts that
 * have no request).
 *
 * Unknown attributes are ignored rather than guessed at: a cookie set with an
 * attribute we do not model is still set, just without it.
 */
export function parseSetCookies(headers: Headers): ParsedSetCookie[] {
  const raw =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const parsed: ParsedSetCookie[] = [];

  for (const line of raw) {
    const parts = line.split(";");
    const first = parts.shift();
    if (!first) continue;
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = decodeURIComponent(first.slice(eq + 1).trim());
    if (!name) continue;

    const options: ParsedSetCookie["options"] = {};
    for (const attr of parts) {
      const at = attr.indexOf("=");
      const key = (at === -1 ? attr : attr.slice(0, at)).trim().toLowerCase();
      const val = at === -1 ? "" : attr.slice(at + 1).trim();
      switch (key) {
        case "path":
          options.path = val;
          break;
        case "domain":
          options.domain = val;
          break;
        case "max-age": {
          const n = Number(val);
          if (Number.isFinite(n)) options.maxAge = n;
          break;
        }
        case "expires": {
          const d = new Date(val);
          if (!Number.isNaN(d.getTime())) options.expires = d;
          break;
        }
        case "httponly":
          options.httpOnly = true;
          break;
        case "secure":
          options.secure = true;
          break;
        case "samesite": {
          const s = val.toLowerCase();
          if (s === "lax" || s === "strict" || s === "none") {
            options.sameSite = s;
          }
          break;
        }
      }
    }
    parsed.push({ name, value, options });
  }

  return parsed;
}

// --- Who is asking --------------------------------------------------------

/**
 * The account identity behind a request, resolved WITHOUT any app's own gate.
 *
 * This is the deliberate difference between the account suite and every other
 * screen in the three apps. `resolveOrgSession` refuses anyone without a console
 * role; `resolveSupplierSession` refuses anyone whose email has not claimed a
 * supplier listing. Both are right for what they guard, and both are wrong here:
 * an organiser whose role was revoked this morning, and a supplier whose listing
 * was never matched, still have a password, a 2FA secret and a list of live
 * sessions — and are exactly the people with a reason to change them. A door
 * that shuts on the way out is how an account becomes unsecurable.
 *
 * So the only questions asked are the two that are about the ACCOUNT rather than
 * about any app's business: is there a signed-in identity, and is that identity
 * still live? Sanitized (deleted) accounts resolve to null — their Better Auth
 * identity is already gone, and this stops a stale cookie-cache session (up to
 * five minutes) reaching a surface that would let it change credentials.
 *
 * Returns null — never throws — when the DB is unconfigured or unreachable, so
 * the caller renders a degraded state rather than a crash.
 */
export interface AccountUser {
  /** Our `users.id` (the join row) — the audit and notification actor. */
  id: string;
  /** The Better Auth `user.id`. */
  authUserId: string;
  email: string | null;
}

export async function resolveAccountUser(
  authUserId: string,
  email: string | null,
): Promise<AccountUser | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const db = createHttpDb();
    // Idempotent, and deliberately NOT onConflictDoUpdate: a sanitized account
    // keeps its `users` row with `email` nulled, and clobbering it with the
    // incoming email would un-erase the PII the deletion removed.
    await db
      .insert(schema.users)
      .values({ authUserId, email })
      .onConflictDoNothing({ target: schema.users.authUserId });
    const [row] = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        sanitizedAt: schema.users.sanitizedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.authUserId, authUserId))
      .limit(1);
    if (!row) return null;
    if (isSanitized(row)) return null;
    return { id: row.id, authUserId, email: row.email };
  } catch {
    return null;
  }
}

// --- The security log -----------------------------------------------------

/**
 * Best-effort append to `security_events` — the feed the security page shows
 * under "Recent security events". THIN: it records the request context (IP +
 * user agent) at the moment an account action succeeds.
 *
 * It must NEVER break or roll back the primary action. A failed insert, or a
 * request with no context, is swallowed: the change already happened, and the
 * log is a record rather than a gate. The inverse — refusing a completed
 * password change because its log line would not write — protects nobody.
 */
export async function recordSecurityEvent(
  headers: Headers,
  userId: string,
  kind: SecurityEventLogKind,
): Promise<void> {
  try {
    const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || headers.get("x-real-ip") || null;
    const userAgent = headers.get("user-agent") || null;
    await createHttpDb()
      .insert(schema.securityEvents)
      .values({ userId, kind, ip, userAgent });
  } catch {
    // The change already happened; the log is a record, never a gate.
  }
}

/** One row of the security feed, as the shared card renders it. */
export interface SecurityEventView {
  id: string;
  kind: SecurityEventLogKind;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

/**
 * The account's security events, newest first. Scoped to the caller's own user
 * id by the caller passing it — a caller can never read another account's
 * history, because nothing here takes a foreign id from a request.
 *
 * Titles are NOT stored: they come from @quagga/core `describeSecurityEvent` at
 * render time, so the log holds the fact and the product holds the wording.
 */
export async function listSecurityEvents(
  userId: string,
  limit = 10,
): Promise<SecurityEventView[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    return await createHttpDb()
      .select({
        id: schema.securityEvents.id,
        kind: schema.securityEvents.kind,
        ip: schema.securityEvents.ip,
        userAgent: schema.securityEvents.userAgent,
        createdAt: schema.securityEvents.createdAt,
      })
      .from(schema.securityEvents)
      .where(eq(schema.securityEvents.userId, userId))
      .orderBy(desc(schema.securityEvents.createdAt))
      .limit(limit);
  } catch {
    // A failed read must degrade the card, never break the security page.
    return [];
  }
}

// --- Sessions -------------------------------------------------------------

/** One active session as the security page shows it. */
export interface AccountSession {
  id: string;
  token: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  expiresAt: Date | null;
  /** Raw user-agent from the provider; humanised for display. */
  userAgent: string | null;
  ipAddress: string | null;
  /** True for the session making this request. */
  current: boolean;
}

type ProviderSession = {
  id?: string | null;
  token?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  userAgent?: string | null;
  ipAddress?: string | null;
};

/**
 * The account's active sessions, newest first, with the caller's own session
 * flagged. Backed by Better Auth's `list-sessions`.
 *
 * Returns [] rather than throwing when auth is unconfigured or the call fails —
 * an unreachable provider must degrade the security page, not break it.
 */
export async function listAccountSessions(
  headers: Headers,
): Promise<AccountSession[]> {
  if (!authReady()) return [];
  try {
    const [sessions, current] = await Promise.all([
      auth.api.listSessions({ headers }),
      // PLAIN `getSession`, answering from the 5-minute session cookie cache.
      //
      // This deliberately does NOT pass `disableCookieCache`. It did for a
      // while: the security page marks a row "This device" by matching the
      // cached token against the live rows, and when a password change rotated
      // the session those two disagreed — the survivor rendered with a Revoke
      // button and no badge, one click from signing yourself out of the account
      // you were securing. Forcing a database read hid that.
      //
      // It hid it by treating the symptom. The cause was the rotated cookie
      // never reaching the browser at all (see `parseSetCookies`); once the
      // browser holds the current token, the cache and the rows agree and the
      // badge is right without a per-render database round trip on a page that
      // already makes five calls.
      //
      // Measured both ways: with the forced read, the passkey spec failed 3 runs
      // in 10 — a second session query on every render, racing the passkey list
      // it shares a Promise.all with. Without it, 0 in 10, and the three-session
      // password-change guard still passes 5 in 5.
      auth.api.getSession({ headers }),
    ]);
    const rows = (sessions ?? []) as ProviderSession[];
    const currentToken = current?.session?.token ?? null;

    return rows
      .map((s) => ({
        id: s.id ?? s.token ?? "",
        token: s.token ?? "",
        createdAt: toDate(s.createdAt),
        updatedAt: toDate(s.updatedAt),
        expiresAt: toDate(s.expiresAt),
        userAgent: s.userAgent ?? null,
        ipAddress: s.ipAddress ?? null,
        current: Boolean(currentToken) && s.token === currentToken,
      }))
      .filter((s) => s.token !== "")
      .sort(
        (a, b) =>
          (b.updatedAt?.getTime() ?? b.createdAt?.getTime() ?? 0) -
          (a.updatedAt?.getTime() ?? a.createdAt?.getTime() ?? 0),
      );
  } catch {
    return [];
  }
}

/**
 * A short device label from a user-agent string. Deliberately coarse — the point
 * is "is this me?", and a full UA string in a security list is noise nobody can
 * act on.
 */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent.toLowerCase();
  const os = ua.includes("android")
    ? "Android"
    : ua.includes("iphone") || ua.includes("ipad")
      ? "iOS"
      : ua.includes("mac os")
        ? "macOS"
        : ua.includes("windows")
          ? "Windows"
          : ua.includes("linux")
            ? "Linux"
            : "Unknown OS";
  // Order matters: Edge and Chrome both claim Safari, Chrome claims Safari.
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("firefox")
      ? "Firefox"
      : ua.includes("chrome")
        ? "Chrome"
        : ua.includes("safari")
          ? "Safari"
          : "browser";
  return `${browser} on ${os}`;
}

// --- Two-factor + passkeys (self-hosted plugins, migration 0015) ----------

/**
 * Whether TOTP two-factor is switched ON for this auth identity. Read straight
 * from `user.two_factor_enabled` (the flag the twoFactor plugin flips after the
 * first successful TOTP verify). Returns false — never throws — when the DB is
 * unconfigured or the row is missing.
 */
export async function getTwoFactorEnabled(
  authUserId: string,
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  try {
    const [row] = await createHttpDb()
      .select({ enabled: schema.user.twoFactorEnabled })
      .from(schema.user)
      .where(eq(schema.user.id, authUserId))
      .limit(1);
    return row?.enabled === true;
  } catch {
    return false;
  }
}

/** One registered passkey, as the security page shows it. */
export interface AccountPasskey {
  id: string;
  name: string | null;
  deviceType: string | null;
  createdAt: string | null;
}

/**
 * The account's registered passkeys. Returns [] (never throws) when auth is
 * unconfigured or the call fails.
 */
export async function listAccountPasskeys(
  headers: Headers,
): Promise<AccountPasskey[]> {
  if (!authReady()) return [];
  try {
    const data = await auth.api.listPasskeys({ headers });
    const rows = (data ?? []) as {
      id?: string | null;
      name?: string | null;
      deviceType?: string | null;
      createdAt?: string | Date | null;
    }[];
    return rows
      .map((p) => ({
        id: p.id ?? "",
        name: p.name ?? null,
        deviceType: p.deviceType ?? null,
        createdAt: toDate(p.createdAt)?.toISOString() ?? null,
      }))
      .filter((p) => p.id !== "");
  } catch {
    return [];
  }
}

// --- Linked sign-in methods ----------------------------------------------

export interface LinkedAccount {
  id: string;
  providerId: string;
  createdAt: Date | null;
}

/**
 * The account's linked sign-in methods (a password counts as the `credential`
 * provider). Powers both the sign-in-methods list and the last-method guard.
 */
export async function listLinkedAccounts(
  headers: Headers,
): Promise<LinkedAccount[]> {
  if (!authReady()) return [];
  try {
    const data = await auth.api.listUserAccounts({ headers });
    const rows = (data ?? []) as {
      id?: string | null;
      providerId?: string | null;
      provider?: string | null;
      createdAt?: string | Date | null;
    }[];
    return rows
      .map((a) => ({
        id: a.id ?? "",
        providerId: a.providerId ?? a.provider ?? "unknown",
        createdAt: toDate(a.createdAt),
      }))
      .filter((a) => a.id !== "");
  } catch {
    return [];
  }
}

/** Human labels for the provider ids the app can actually issue. */
const SIGN_IN_METHOD_LABELS: Record<string, string> = {
  credential: "Email",
  google: "Google",
};

/**
 * Human-readable sign-in method(s) for a set of linked accounts, in a stable
 * order (Email, then Google, then anything else), de-duplicated. Returns null
 * when nothing determinable is linked so callers can render an honest fallback
 * ("Not available") rather than a wrong literal. Single source of truth for any
 * surface that names the sign-in method.
 */
export function describeSignInMethods(
  accounts: LinkedAccount[],
): string | null {
  const labels: string[] = [];
  for (const a of accounts) {
    const known = SIGN_IN_METHOD_LABELS[a.providerId];
    if (known) {
      labels.push(known);
    } else if (a.providerId && a.providerId !== "unknown") {
      labels.push(a.providerId.charAt(0).toUpperCase() + a.providerId.slice(1));
    }
  }
  const unique = [...new Set(labels)];
  if (unique.length === 0) return null;
  const order = ["Email", "Google"];
  const rank = (label: string) => {
    const i = order.indexOf(label);
    return i === -1 ? order.length : i;
  };
  unique.sort((a, b) => rank(a) - rank(b));
  return unique.join(", ");
}
