import "server-only";

import { desc, eq } from "drizzle-orm";
import { describeSecurityEvent } from "@quagga/core";

import { db, schema } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/config";
import { deviceLabel } from "@/lib/account";

// The "recent security events" feed (canvas G35eq §"Recent security events").
//
// This reads the real `security_events` LOG — an append-only record written at
// the moment each account action succeeds (password change/reset, single-session
// revoke, sign-out-everywhere, the three email-change steps, deletion
// request/cancel), recorded thinly and best-effort by `recordSecurityEvent` in
// lib/account-actions.ts. It REPLACES the earlier stopgap that derived the feed
// from `notifications` (which conflated inbox messages with the event record).
//
// The display title comes from @quagga/core `describeSecurityEvent` (no strings
// stored in the DB); the body is composed here from the request context
// (device + IP) the log captured. What this feed still does NOT contain:
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
  if (!isDatabaseConfigured()) return [];
  try {
    const rows = await db()
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
    return rows.map((r) => ({
      id: r.id,
      title: describeSecurityEvent(r.kind),
      body: eventBody(r.userAgent, r.ip),
      createdAt: r.createdAt,
    }));
  } catch {
    // A failed read must degrade the card, never break the security page.
    return [];
  }
}
