"use client";

import * as React from "react";
import { initialsFromName } from "@quagga/core";
import { cn } from "@quagga/ui/lib/utils";

/**
 * A round profile avatar: the member's photo when the SERVER decided this
 * viewer may see it (`showPhoto`), otherwise their initials.
 *
 * The photo is loaded from `/api/avatar/[userId]`, which re-checks the same
 * @quagga/core predicate on every request — `showPhoto` only avoids asking for
 * a photo that would be refused; it is not the control. A plain <img> on
 * purpose: next/image's optimiser would fetch the photo server-side WITHOUT
 * the viewer's session (so it would always be refused) and could cache the
 * result across viewers, which is exactly what a per-viewer photo must never
 * be. If the photo fails to load for any reason, the initials come back.
 */
export function AvatarImage({
  userId,
  name,
  showPhoto,
  className,
  version,
}: {
  userId: string;
  name: string | null | undefined;
  showPhoto: boolean;
  className?: string;
  /** Changes when the photo does, so a replaced photo is re-requested. */
  version?: string | number;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [userId, version, showPhoto]);

  const base = cn(
    "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 font-semibold text-foreground",
    className,
  );

  if (showPhoto && !failed) {
    const src = `/api/avatar/${userId}${version != null ? `?v=${encodeURIComponent(String(version))}` : ""}`;
    return (
      <span className={base}>
        {/* A plain img on purpose — see the component note. */}
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return (
    <span className={base} aria-hidden>
      {initialsFromName(name)}
    </span>
  );
}
