import "server-only";

/**
 * Unread-notification count for the header bell.
 *
 * The notifications backend (the `notifications` + `bulletins` tables and their
 * event hooks — see docs/notifications-spec.md) lands in a later wave. Until
 * then this is a single placeholder seam: it returns 0, so the bell renders in
 * the signed-in chrome without a badge. When the backend arrives, this is the
 * one function to swap for a real per-user unread query — every consumer reads
 * the count from here.
 */
export async function getUnreadNotificationCount(): Promise<number> {
  return 0;
}
