// Display-only formatting for the notification surfaces (canvas `X6YN3` /
// `qLjMS` / `UAc97`). Pure and dependency-free — no I/O, no state. Everything
// here runs on the SERVER for the rendered pages so the relative-time string is
// computed once and can never hydrate-mismatch.
//
// PRIVACY: these helpers only ever touch already-safe display text (titles the
// @quagga/core payload builders produced) — they never see private fields.

import type { NotificationKind } from "@quagga/types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "2 hours ago" / "Mon" / "12 Feb" — the canvas meta line's time half.
 * Recent items read relatively, this week's by weekday, older by date.
 */
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
  if (delta < 7 * DAY) {
    return at.toLocaleDateString("en-GB", { weekday: "short" });
  }
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Kinds AfrikaBurn itself sends get the "· AfrikaBurn" source half of the meta
 * line (canvas copy). Membership/security events have no single named sender,
 * so they show the time alone rather than inventing an attribution.
 */
const AFRIKABURN_SOURCED: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  "bulletin",
  "questionnaire",
  "registration",
  "wrangler",
  "supplier",
]);

/** Source label for the meta line, or null when there isn't an honest one. */
export function sourceLabel(kind: NotificationKind): string | null {
  return AFRIKABURN_SOURCED.has(kind) ? "AfrikaBurn" : null;
}

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

/**
 * A released questionnaire is blocking when the payload builder stamped the
 * spec's "REQUIRED, blocks registration" phrase into the title (see
 * `questionnaireReleasedNotification` in @quagga/core). The stored row carries
 * no separate flag, so this phrase IS the wire format — keep the two in sync.
 */
export const BLOCKING_MARKER = "REQUIRED, blocks registration";

/** True when this row is a blocking-questionnaire release (accent-flagged). */
export function isBlockingNotification(input: {
  kind: NotificationKind;
  title: string;
}): boolean {
  return input.kind === "questionnaire" && input.title.includes(BLOCKING_MARKER);
}

// --- Row projection ------------------------------------------------------

/** Already-projected, serializable row data (all display-safe strings). */
export interface NotificationRowItem {
  id: string;
  kind: NotificationKind;
  title: string;
  /** Pre-rendered meta line, e.g. "2 hours ago · AfrikaBurn". */
  meta: string | null;
  link: string | null;
  read: boolean;
  blocking: boolean;
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
    link: string | null;
    createdAt: Date;
    readAt: Date | null;
  },
  now: Date = new Date(),
): NotificationRowItem {
  const source = sourceLabel(view.kind);
  const meta = [relativeTime(view.createdAt, now), source]
    .filter(Boolean)
    .join(" · ");
  return {
    id: view.id,
    kind: view.kind,
    title: view.title,
    meta: meta || null,
    link: view.link,
    read: view.readAt !== null,
    blocking: isBlockingNotification(view),
  };
}
