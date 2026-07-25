import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/config";

// The "recent security events" feed (canvas G35eq §"Recent security events").
//
// THERE IS NO security_events TABLE, and we are not inventing one here. What
// exists is the `notifications` table, into which every security-relevant action
// already writes a `security`-kind row via `notifySecurity` in
// lib/account-actions.ts — password changed, password reset completed, email
// change requested/revoked, deletion requested/cancelled/completed. That IS the
// record of what happened to the account, written at the moment it happened, so
// it is what the feed reads.
//
// What this feed therefore does NOT contain, and what the surface says out loud:
//  • new-device sign-ins — the builder exists but is unwired (no per-account
//    device-fingerprint column, so it would fire on every session or on none;
//    it fires on none). The active-session list above it is the reliable check.
//  • anything that happened before this table started being written to.
//
// Scoped to the caller's own user id server-side; a caller can never read
// another account's history.

export interface SecurityEvent {
  id: string;
  title: string;
  body: string | null;
  createdAt: Date;
}

/** The account's security-kind notifications, newest first. */
export async function listSecurityEvents(
  userId: string,
  limit = 10,
): Promise<SecurityEvent[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const rows = await db()
      .select({
        id: schema.notifications.id,
        title: schema.notifications.title,
        body: schema.notifications.body,
        createdAt: schema.notifications.createdAt,
      })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.kind, "security"),
        ),
      )
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit);
    return rows;
  } catch {
    // A failed read must degrade the card, never break the security page.
    return [];
  }
}
