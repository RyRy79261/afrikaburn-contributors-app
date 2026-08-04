import * as React from "react";
import { Bell } from "lucide-react";
import { cn } from "../lib/utils";

// NotificationBell — bell glyph with an unread-count badge pinned top-right
// (canvas `H9bn7` header slot; lives in AppShell + mobile headers). Dumb and
// stateless: it renders the `count` it is given and delegates opening the
// notification surface to the parent's `onClick`. No hooks → server-safe.

export interface NotificationBellProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Unread count; 0 (or negative) hides the badge. */
  count?: number;
  /** Cap the displayed number ("99+" past this). Default 99. */
  max?: number;
}

const NotificationBell = React.forwardRef<
  HTMLButtonElement,
  NotificationBellProps
>(({ count = 0, max = 99, className, ...props }, ref) => {
  const unread = Math.max(0, Math.floor(count));
  const display = unread > max ? `${max}+` : String(unread);
  const label =
    unread > 0
      ? `Notifications, ${unread} unread`
      : "Notifications, none unread";

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        "relative inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      {...props}
    >
      <Bell className="h-5 w-5" aria-hidden />
      {unread > 0 ? (
        <span
          aria-hidden
          className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
        >
          {display}
        </span>
      ) : null}
    </button>
  );
});
NotificationBell.displayName = "NotificationBell";

export { NotificationBell };
