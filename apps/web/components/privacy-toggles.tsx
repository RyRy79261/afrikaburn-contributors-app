"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import {
  readFieldVisibility,
  type BioPrivacyField,
  type FieldVisibility,
  type PrivacyFlags,
} from "@quagga/core";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";

interface PrivacyTogglesProps {
  fields: readonly BioPrivacyField[];
  flags: PrivacyFlags;
  onChange: (key: string, level: FieldVisibility) => void;
}

const LEVEL_LABEL: Record<FieldVisibility, string> = {
  private: "Only me",
  camp_mates: "Camp mates",
  public: "Public",
};

const LEVEL_HELP: Record<FieldVisibility, string> = {
  private: "Only you can see this.",
  camp_mates: "People in your theme camp can see this.",
  public: "Visible on your public profile.",
};

/** Per-field privacy control (build-spec §`/onboarding`, §`/profile`; epic #68
 * adds the camp-mates level). Locked fields render as a disabled, always-private
 * row with an explanation — the UI mirror of the core hard-lock, which is what
 * actually refuses them (a locked field is forced private on every write). */
export function PrivacyToggles({
  fields,
  flags,
  onChange,
}: PrivacyTogglesProps) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {fields.map((field) => {
        const level: FieldVisibility = field.locked
          ? "private"
          : readFieldVisibility(flags[field.key]);
        return (
          <li
            key={field.key}
            className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                {field.locked && (
                  <Lock
                    className="h-3.5 w-3.5 text-muted-foreground"
                    aria-hidden
                  />
                )}
                {field.label}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {field.locked
                  ? (field.lockReason ?? "Always private.")
                  : LEVEL_HELP[level]}
              </p>
            </div>

            {field.locked ? (
              <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground sm:self-auto">
                <Lock className="h-3 w-3" aria-hidden />
                Locked private
              </span>
            ) : (
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={level}
                // Radix emits "" when the pressed item is clicked again; a field
                // always has a level, so that click is ignored.
                onValueChange={(v) => {
                  if (v === "private" || v === "camp_mates" || v === "public") {
                    onChange(field.key, v);
                  }
                }}
                aria-label={`${field.label} — who can see this`}
                className="shrink-0"
              >
                {(["private", "camp_mates", "public"] as const).map((l) => (
                  <ToggleGroupItem
                    key={l}
                    value={l}
                    aria-label={`${field.label}: ${LEVEL_LABEL[l]}`}
                    className="text-xs"
                  >
                    {LEVEL_LABEL[l]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </li>
        );
      })}
    </ul>
  );
}
