import "server-only";

import { describeSecurityEvent } from "@quagga/core";
import {
  deviceLabel,
  listSecurityEvents as readSecurityEvents,
} from "@quagga/auth/account";

// The "recent security events" feed (canvas G35eq §"Recent security events").
//
// This reads the real `security_events` LOG — an append-only record written at
// the moment each account action succeeds (password change/reset, single-session
// revoke, sign-out-everywhere, the three email-change steps, deletion
// request/cancel), recorded thinly and best-effort by `recordSecurityEvent`.
//
// The ROW READ moved to @quagga/auth/account (roadmap M4-21) so the org console
// and the supplier portal show the same history for the same account; what stays
// here is the PRESENTATION: the display title comes from @quagga/core
// `describeSecurityEvent` (no strings stored in the DB) and the body is composed
// from the request context the log captured.
//
// What this feed still does NOT contain:
//  • new-device sign-ins — no per-account device-fingerprint record exists, so
//    the builder fires on nothing; the active-session list above is the check.
//  • anything from before this table started being written to.
//
// Scoped to the caller's own user id server-side; a caller can never read
// another account's history.

export interface SecurityEvent {
  id: string;
  title: string;
  body: string | null;
  createdAt: Date;
}

/** Compose the one-line detail from the captured request context. */
function eventBody(userAgent: string | null, ip: string | null): string | null {
  const parts: string[] = [];
  if (userAgent) parts.push(deviceLabel(userAgent));
  if (ip) parts.push(ip);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The account's security events, newest first. */
export async function listSecurityEvents(
  userId: string,
  limit = 10,
): Promise<SecurityEvent[]> {
  const rows = await readSecurityEvents(userId, limit);
  return rows.map((r) => ({
    id: r.id,
    title: describeSecurityEvent(r.kind),
    body: eventBody(r.userAgent, r.ip),
    createdAt: r.createdAt,
  }));
}
