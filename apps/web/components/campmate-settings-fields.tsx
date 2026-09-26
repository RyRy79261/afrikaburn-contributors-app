"use client";

import { type CampmateSettings, type Contactability } from "@quagga/core";
import { Switch } from "@quagga/ui/components/switch";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";

// --- Camp-mate settings (epic #68) ----------------------------------------

const CONTACT_OPTIONS: { value: Contactability; label: string }[] = [
  { value: "nobody", label: "Nobody" },
  { value: "camp_mates", label: "Camp mates" },
  { value: "anyone", label: "Anyone" },
];

/** Contactability + the camp "people" opt-in. Both default to the private
 * choice and neither is required — pressing on without touching them keeps
 * them private (fewer-forms law). Shared by the bio flow's Privacy step and
 * the profile card. NEEDS DESIGN REVIEW (no canvas frame yet). */
export function CampmateSettingsFields({
  value,
  onChange,
  disabled,
}: {
  value: CampmateSettings;
  onChange: (next: CampmateSettings) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p id="campmate-contactable-label" className="text-sm font-medium">
            Who can contact you
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            For messages inside the app, when they arrive. Nobody, until you
            choose otherwise.
          </p>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={value.contactable}
          disabled={disabled}
          onValueChange={(v) => {
            const next = CONTACT_OPTIONS.find((o) => o.value === v);
            if (next) onChange({ ...value, contactable: next.value });
          }}
          aria-labelledby="campmate-contactable-label"
          className="shrink-0"
        >
          {CONTACT_OPTIONS.map((o) => (
            <ToggleGroupItem
              key={o.value}
              value={o.value}
              aria-label={`Who can contact you: ${o.label}`}
              className="text-xs"
            >
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            Show me in my camp&apos;s people list
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Only members of your theme camp see the list, and only what you
            share with camp mates. Off unless you turn it on.
          </p>
        </div>
        <Switch
          checked={value.listedInCampPeople}
          disabled={disabled}
          onCheckedChange={(v) => onChange({ ...value, listedInCampPeople: v })}
          aria-label="Show me in my camp's people list"
        />
      </div>
    </div>
  );
}
