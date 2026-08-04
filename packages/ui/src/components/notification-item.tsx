import * as React from "react";
import {
  ClipboardList,
  Compass,
  type LucideIcon,
  Megaphone,
  Package,
  PartyPopper,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import { cn } from "../lib/utils";

// NotificationItem — one row in the notification stream (canvas `H9bn7`/`IDy9A`;
// panel dropdown + /notifications pages across all three apps). Presentational
// and stateless (no hooks) → server-component-safe; it renders inside a parent's
// <li> (li-friendly: the row owns no list styling and spreads div attributes so
// a client parent can attach onClick).
//
// One inbox, two origins (notifications-spec): personal event notifications and
// org `bulletin` broadcasts share this row. `kind` selects the leading glyph;
// `blocking` accent-flags a required questionnaire ("REQUIRED, blocks
// registration"). Never render private fields in previews (privacy law) — the
// caller supplies already-safe title/meta text.

export type NotificationKind =
  | "registration"
  | "wrangler"
  | "role"
  | "questionnaire"
  | "supplier"
  | "security"
  | "bulletin";

/** kind → leading glyph. Exhaustive over NotificationKind by construction. */
export const NOTIFICATION_KIND_ICON: Record<NotificationKind, LucideIcon> = {
  registration: PartyPopper, // 🎉 status changes (approved/under review/…)
  wrangler: Compass, // 🧭 wrangler assigned
  role: UserCheck, // 🧑‍🚒 role/officer assignment + acceptance
  questionnaire: ClipboardList, // 📋 questionnaire released (blocking → flagged)
  supplier: Package, // 📦 supplier onboarding confirmations
  security: ShieldAlert, // account security events
  bulletin: Megaphone, // 📣 org broadcast
};

export interface NotificationItemProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  kind: NotificationKind;
  /** Title copy (wraps freely). */
  title: React.ReactNode;
  /**
   * The notification's own words, under the title. Some notifications carry
   * text that IS the message rather than a pointer to it — a reviewer's reason
   * for rejecting a registration, above all — and a row that shows only the
   * title silently discards it.
   */
  body?: React.ReactNode;
  /** Full meta line; overrides the derived `timeAgo · source` line. */
  meta?: React.ReactNode;
  /** Relative time, e.g. "2 hours ago". Joined with `source` when no `meta`. */
  timeAgo?: string;
  /** Source label, e.g. "AfrikaBurn". Joined with `timeAgo` when no `meta`. */
  source?: string;
  /** Unread → shows the dot and full-strength text. Read → muted. */
  read?: boolean;
  /** Questionnaire that hard-gates registration — accent-flagged per spec. */
  blocking?: boolean;
}

export function NotificationItem({
  kind,
  title,
  body,
  meta,
  timeAgo,
  source,
  read = false,
  blocking = false,
  className,
  ...props
}: NotificationItemProps) {
  const Icon = NOTIFICATION_KIND_ICON[kind];
  const metaLine =
    meta ?? ([timeAgo, source].filter(Boolean).join(" · ") || null);
  const isBlocking = blocking && kind === "questionnaire";

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-3 py-3 text-left transition-colors",
        read ? "opacity-70" : undefined,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          isBlocking
            ? "bg-destructive/15 text-destructive"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1 space-y-0.5">
        <p
          className={cn(
            "text-sm leading-snug",
            read
              ? "font-normal text-muted-foreground"
              : "font-medium text-foreground",
          )}
        >
          {title}
        </p>
        {body ? (
          <p className="whitespace-pre-line text-sm text-muted-foreground">
            {body}
          </p>
        ) : null}
        {isBlocking ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
            Required · blocks registration
          </p>
        ) : null}
        {metaLine ? (
          <p className="text-xs text-muted-foreground">{metaLine}</p>
        ) : null}
      </div>

      {read ? null : (
        <span
          aria-label="Unread"
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
        />
      )}
    </div>
  );
}
