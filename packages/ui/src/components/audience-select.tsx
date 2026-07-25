"use client";

import * as React from "react";
import { Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { cn } from "../lib/utils";

// AudienceSelect — the questionnaire/bulletin audience picker (notifications-
// spec: "same component as questionnaire audiences"). A DUMB variant of Select:
// it renders the given options and a "Resolves to ~N burners" line. It does NOT
// resolve anything itself — the parent server action runs @quagga/core's
// resolveAudience and feeds `resolvedCount` down (one resolver, one display).

export interface AudienceOption {
  value: string;
  label: string;
}

export interface AudienceSelectProps {
  options: readonly AudienceOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  /** Live resolved recipient count from the parent (via resolveAudience).
   * `null`/`undefined` → the line is hidden (e.g. before a selection). */
  resolvedCount?: number | null;
  /** Noun for the count line. Default "burners". */
  countNoun?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** "Resolves to ~N burners" — approximate, live from the resolver. */
function resolveLine(count: number, noun: string): string {
  if (count === 0) return `Resolves to no ${noun} yet`;
  if (count === 1) return `Resolves to ~1 ${noun.replace(/s$/, "")}`;
  return `Resolves to ~${count} ${noun}`;
}

export function AudienceSelect({
  options,
  value,
  onValueChange,
  resolvedCount,
  countNoun = "burners",
  placeholder = "Choose an audience",
  disabled,
  id,
  className,
}: AudienceSelectProps) {
  const showCount = resolvedCount !== null && resolvedCount !== undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showCount ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" aria-hidden />
          <span>{resolveLine(resolvedCount, countNoun)}</span>
        </p>
      ) : null}
    </div>
  );
}
