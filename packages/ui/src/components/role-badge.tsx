import * as React from "react";
import type { RoleColor } from "@quagga/types";
import { cn } from "../lib/utils";

// Curated palette keys → brand-ramp hex (build-spec §UI). Rendered as a
// translucent tint over the theme background with a solid border + swatch dot,
// so a role chip stays legible in BOTH light and dark without per-theme classes.
export const ROLE_COLOR_HEX: Record<RoleColor, string> = {
  teal: "#2D7696",
  teal_deep: "#235C75",
  apricot: "#F4B672",
  peach: "#FFBC7D",
  sage: "#B6D090",
  olive: "#7D9953",
  rust: "#C24438",
  neutral: "#ADB6B3",
};

export const ROLE_COLOR_LABELS: Record<RoleColor, string> = {
  teal: "Teal",
  teal_deep: "Deep teal",
  apricot: "Apricot",
  peach: "Peach",
  sage: "Sage",
  olive: "Olive",
  rust: "Rust",
  neutral: "Neutral",
};

/** A small color dot for the palette picker + collapsed rows. */
export function RoleSwatch({
  color,
  className,
  selected,
}: {
  color: RoleColor;
  className?: string;
  selected?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 shrink-0 rounded-full border",
        selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        className,
      )}
      style={{
        backgroundColor: ROLE_COLOR_HEX[color],
        borderColor: "rgba(0,0,0,0.2)",
      }}
      aria-hidden
    />
  );
}

/** A role/officer chip: emoji + name, tinted to the role's color. */
export function RoleBadge({
  name,
  color = "neutral",
  emoji,
  className,
}: {
  name: string;
  color?: RoleColor;
  emoji?: string | null;
  className?: string;
}) {
  const hex = ROLE_COLOR_HEX[color];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={{ backgroundColor: `${hex}22`, borderColor: `${hex}99` }}
    >
      {emoji && <span aria-hidden>{emoji}</span>}
      {name}
    </span>
  );
}
