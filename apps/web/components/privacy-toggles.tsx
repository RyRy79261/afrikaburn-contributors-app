"use client";

import * as React from "react";
import { Lock, Eye, EyeOff } from "lucide-react";
import type { BioPrivacyField } from "@quagga/core";
import { cn } from "@quagga/ui/lib/utils";

interface PrivacyTogglesProps {
  fields: readonly BioPrivacyField[];
  flags: Record<string, boolean>;
  onChange: (key: string, isPublic: boolean) => void;
}

/** Per-field privacy control (build-spec §`/onboarding`, §`/profile`). Locked
 * fields render as a disabled, always-private row with an explanation — the UI
 * mirror of the core hard-lock. */
export function PrivacyToggles({ fields, flags, onChange }: PrivacyTogglesProps) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {fields.map((field) => {
        const isPublic = !field.locked && flags[field.key] === true;
        return (
          <li
            key={field.key}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                {field.locked && (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                )}
                {field.label}
              </p>
              {field.locked ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {field.lockReason ?? "Always private."}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {isPublic
                    ? "Visible on your public profile."
                    : "Only you and camps you join can see this."}
                </p>
              )}
            </div>

            {field.locked ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" aria-hidden />
                Locked private
              </span>
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={isPublic}
                aria-label={`${field.label}: ${isPublic ? "public" : "private"}`}
                onClick={() => onChange(field.key, !isPublic)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  isPublic
                    ? "border-success/40 bg-success/15 text-success"
                    : "border-input bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                {isPublic ? (
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                )}
                {isPublic ? "Public" : "Private"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
