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
 * Kinds ONLY AfrikaBurn ever sends get the "· AfrikaBurn" source half of the
 * meta line (canvas copy). Membership/security events have no single named
 * sender, so they show the time alone rather than inventing an attribution.
 *
 * `questionnaire` is deliberately absent: it has two possible senders, so it is
 * answered from the row's `origin` instead — see `sourceLabel`.
 */
const ALWAYS_ORG_SOURCED: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  "bulletin",
  "registration",
  "wrangler",
  "supplier",
]);

/**
 * Source label for the meta line, or null when there isn't an honest one.
 *
 * `origin` is the stored `notifications.origin` — a nullable TEXT column
 * carrying @quagga/core's `NotificationOrigin` (`org` / `camp` / `system`), so
 * a missing or unrecognised value has to be handled rather than assumed.
 *
 * WHAT WENT WRONG: this asked the KIND alone and `questionnaire` was on the
 * AfrikaBurn list. Camp leads release questionnaires too — those rows are
 * written with `origin: "camp"` (apps/web/lib/questionnaire-store.ts) and their
 * title reads "New questionnaire from <the camp>" — so a burner's inbox showed
 * "2 hours ago · AfrikaBurn" directly under a headline naming their own camp
 * lead. The meta line contradicted the title and credited a camp's form to
 * AfrikaBurn; `origin` exists precisely to answer this.
 *
 * With no origin recorded we now say nothing rather than guess. Nothing is lost
 * by that: `questionnaireReleasedNotification` already stamps the sender into
 * the title, for AfrikaBurn's own releases as much as a camp's.
 */
export function sourceLabel(
  kind: NotificationKind,
  origin?: string | null,
): string | null {
  if (origin === "org") return "AfrikaBurn";
  if (origin === "camp" || origin === "system") return null;
  return ALWAYS_ORG_SOURCED.has(kind) ? "AfrikaBurn" : null;
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
  /** The notification's own message, when it has one. */
  body: string | null;
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
    body?: string | null;
    link: string | null;
    createdAt: Date;
    readAt: Date | null;
    /**
     * Who sent it (`notifications.origin`). OPTIONAL because the reads that
     * feed this — `listNotificationGroups` / `recentNotifications` in
     * apps/web/lib/notifications.ts — do not project the column into their
     * `NotificationView` yet. Until they do, `sourceLabel` falls back to the
     * kind, which is now the honest fallback rather than a guess.
     */
    origin?: string | null;
  },
  now: Date = new Date(),
): NotificationRowItem {
  const source = sourceLabel(view.kind, view.origin);
  const meta = [relativeTime(view.createdAt, now), source]
    .filter(Boolean)
    .join(" · ");
  return {
    id: view.id,
    kind: view.kind,
    title: view.title,
    body: view.body?.trim() || null,
    meta: meta || null,
    link: view.link,
    read: view.readAt !== null,
    blocking: isBlockingNotification(view),
  };
}
