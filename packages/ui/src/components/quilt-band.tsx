import * as React from "react";

import { cn } from "../lib/utils";

export interface QuiltBandProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whole-band opacity, 0–1. Lower it for a subtler divider. Default 0.9. */
  opacity?: number;
}

/**
 * QuiltBand — an original decorative band echoing AfrikaBurn's geometric quilt
 * of diamonds. A seamless, repeating row of diamonds in the brand triad
 * (teal · apricot · sage) separated by transparent interstitials, ~10px tall
 * and full width. Purely decorative (aria-hidden). Original geometry — this is
 * NOT the AfrikaBurn logo or the San-hand emblem, only the quilt motif.
 *
 * Used along the top edge of each app shell header and as a divider on the
 * landing and auth pages.
 */
export function QuiltBand({
  opacity = 0.9,
  className,
  style,
  ...props
}: QuiltBandProps) {
  const reactId = React.useId();
  // useId embeds colons, invalid in an SVG url(#id) reference — strip them.
  const patternId = `quilt-${reactId.replace(/:/g, "")}`;

  return (
    <div
      aria-hidden
      className={cn("h-2.5 w-full overflow-hidden", className)}
      style={{ opacity, ...style }}
      {...props}
    >
      <svg
        width="100%"
        height="10"
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <defs>
          {/* One 30×10 tile: three edge-touching diamonds, transparent
              interstitials. The right vertex of the sage diamond meets the
              left vertex of the next tile's teal diamond, so it tiles seamlessly. */}
          <pattern
            id={patternId}
            width="30"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <polygon points="5,0 10,5 5,10 0,5" fill="var(--color-ab-teal)" />
            <polygon
              points="15,0 20,5 15,10 10,5"
              fill="var(--color-ab-apricot)"
            />
            <polygon
              points="25,0 30,5 25,10 20,5"
              fill="var(--color-ab-sage)"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
