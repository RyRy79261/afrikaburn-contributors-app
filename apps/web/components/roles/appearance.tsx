"use client";

import * as React from "react";
import type { RoleColor } from "@quagga/types";
import { ROLE_COLORS } from "@quagga/types";
import { Input } from "@quagga/ui/components/input";
import {
  RoleSwatch,
  ROLE_COLOR_LABELS,
} from "@quagga/ui/components/role-badge";

// Icon + colour picker (canvas ZyKzw "Icon & Colour"). Role colours are DATA
// colours — the curated `RoleColor` palette enum from @quagga/types, rendered by
// the shared RoleSwatch/RoleBadge (never freeform hex, never theme tokens).

/** A short, camp-flavoured emoji shortlist; free text still accepted. */
const EMOJI_SUGGESTIONS = [
  "🔧",
  "🎩",
  "🔥",
  "🧙",
  "🍳",
  "🎨",
  "🎧",
  "🛠️",
  "🚿",
  "☕",
  "🚚",
  "⚡",
] as const;

export function AppearancePicker({
  emoji,
  color,
  disabled,
  onEmojiChange,
  onColorChange,
  idPrefix,
}: {
  emoji: string;
  color: RoleColor;
  disabled?: boolean;
  onEmojiChange: (emoji: string) => void;
  onColorChange: (color: RoleColor) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Icon &amp; colour
      </span>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col gap-1.5">
          <Input
            id={`${idPrefix}-emoji`}
            value={emoji}
            onChange={(e) => onEmojiChange(e.target.value)}
            disabled={disabled}
            maxLength={4}
            aria-label="Role icon"
            placeholder="🙂"
            className="h-10 w-14 text-center text-lg"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_SUGGESTIONS.map((e) => (
              <button
                key={`${idPrefix}-sug-${e}`}
                type="button"
                disabled={disabled}
                onClick={() => onEmojiChange(e)}
                aria-label={`Use ${e}`}
                className="rounded-md border border-border px-1.5 py-0.5 text-sm transition-colors hover:bg-muted/60 disabled:opacity-50"
              >
                {e}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {ROLE_COLORS.map((c) => (
              <button
                key={`${idPrefix}-col-${c}`}
                type="button"
                aria-label={ROLE_COLOR_LABELS[c]}
                aria-pressed={c === color}
                disabled={disabled}
                onClick={() => onColorChange(c)}
                className="rounded-full p-0.5 disabled:opacity-50"
              >
                <RoleSwatch color={c} selected={c === color} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
