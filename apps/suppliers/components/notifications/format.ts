import type { NotificationKind } from "@quagga/types";

// Display-only formatting for the portal inbox (canvas `swSq4` desktop /
// `OSqoc` mobile). Pure and dependency-free — no I/O, no state. Everything runs
// on the SERVER so the relative-time string is computed once and can never
// hydrate-mismatch.
//
// PRIVACY: these helpers only touch text the @quagga/core payload builders
// already produced. A supplier's inbox carries their own step confirmations,
// their own STANDING VALUE changes, and org bulletins — never the org-internal
// notes timeline (docs/supplier-spec.md: notes are org-only, and the standing
// hook writes the label only).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2 hours ago" / "Mon" / "12 Feb" — the canvas meta line's time half. */
export function relativeTime(at: Date, now: Date = new Date()): string {
  const delta = now.getTime() - at.getTime();
  if (delta < MINUTE) return "Just now";
  if (delta < HOUR) {
    const mins = Math.floor(delta / MINUTE);
    return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  }
  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (delta < 2 * DAY) return "Yesterday";
  if (delta < 7 * DAY) return at.toLocaleDateString("en-GB", { weekday: "short" });
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Everything in a supplier's inbox comes from AfrikaBurn — step confirmations,
 * standing changes, and depot bulletins are all sent by the org. The canvas
 * meta line says so explicitly ("2 hours ago · AfrikaBurn").
 */
export const PORTAL_SOURCE = "AfrikaBurn";

/**
 * The day-group heading ("TODAY" / "YESTERDAY" / "MON 20 JUL"). `label` is what
 * @quagga/core's `groupNotificationsByDay` produced: "Today", "Yesterday", or
 * the raw YYYY-MM-DD key.
 */
export function dayGroupHeading(label: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (!match) return label.toUpperCase();
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date
    .toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
    .toUpperCase();
}

/** Already-projected, serializable row data (all display-safe strings). */
export interface NotificationRowItem {
  id: string;
  kind: NotificationKind;
  title: string;
  /** The notification's own body copy, when it carries one. */
  body: string | null;
  /** Pre-rendered meta line, e.g. "2 hours ago · AfrikaBurn". */
  meta: string;
  link: string | null;
  read: boolean;
}

/**
 * Project a stored notification into the row the UI renders. Done on the server
 * so the relative time is stable across hydration, and so the client only ever
 * receives display text (never the raw row).
 */
export function toRowItem(
  view: {
    id: string;
    kind: NotificationKind;
    title: string;
    body: string | null;
    link: string | null;
    createdAt: Date;
    readAt: Date | null;
  },
  now: Date = new Date(),
): NotificationRowItem {
  return {
    id: view.id,
    kind: view.kind,
    title: view.title,
    body: view.body,
    meta: `${relativeTime(view.createdAt, now)} · ${PORTAL_SOURCE}`,
    link: view.link,
    read: view.readAt !== null,
  };
}
