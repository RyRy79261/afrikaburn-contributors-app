"use client";

import * as React from "react";
import {
  PinnedBulletinBanner,
  type PinnedBulletinBannerProps,
} from "./pinned-bulletin-banner";

// Client wrapper that gives PinnedBulletinBanner local dismiss state — the base
// banner stays server-safe; this file owns the only "use client" for it. Once
// dismissed it renders nothing (dismissal is view-local; persisting it across
// sessions is the caller's concern).

export interface DismissiblePinnedBulletinBannerProps
  extends Omit<PinnedBulletinBannerProps, "onDismiss"> {
  /** Fired after the banner is dismissed (e.g. to persist the choice). */
  onDismiss?: () => void;
}

export function DismissiblePinnedBulletinBanner({
  onDismiss,
  ...props
}: DismissiblePinnedBulletinBannerProps) {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;

  return (
    <PinnedBulletinBanner
      {...props}
      onDismiss={() => {
        setDismissed(true);
        onDismiss?.();
      }}
    />
  );
}
