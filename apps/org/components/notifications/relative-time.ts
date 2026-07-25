import type { NotificationKind } from "@quagga/types";

// Presentation helpers for the console inbox. Pure + dependency-free: the page
// renders the strings on the server so a row is readable before hydration.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Just now" / "2 hours ago" / "3 days ago" — coarse on purpose. */
export function timeAgo(value: Date, now: Date = new Date()): string {
  const diff = now.getTime() - value.getTime();
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) {
    const mins = Math.floor(diff / MINUTE);
    return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(diff / DAY);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return value.toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** kind → the console-flavoured source label on a row's meta line. */
export const NOTIFICATION_SOURCE_LABELS: Record<NotificationKind, string> = {
  registration: "Registrations",
  wrangler: "Wranglers",
  role: "Officers",
  questionnaire: "Questionnaires",
  supplier: "Suppliers",
  security: "Security",
  bulletin: "Bulletins",
};
