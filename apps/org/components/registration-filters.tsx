"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { RegistrationStatus } from "@quagga/types";
import { SOUND_LEVELS, SOUND_LEVEL_LABELS } from "@/lib/org-logic";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const ALL = "all";

function FilterSelect({
  label,
  param,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  param: string;
  value: string;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (param: string, value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs">
      <span className="font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Select value={value} onValueChange={(v) => onChange(param, v)}>
        <SelectTrigger className="h-9 w-[13rem] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/**
 * Status / sound Selects + a new-vs-returning ("Camp type") toggle that drive
 * the registrations table via URL search params (canvas StJXH filters row).
 */
export function RegistrationFilters({
  status,
  sound,
  cohort,
}: {
  status: string;
  sound: string;
  cohort: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const update = useCallback(
    (param: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (!value || value === ALL) next.delete(param);
      else next.set(param, value);
      // Any filter change resets to page 1.
      next.delete("page");
      const qs = next.toString();
      router.push(qs ? `/registrations?${qs}` : "/registrations");
    },
    [router, searchParams],
  );

  return (
    <div className="mb-5 flex flex-wrap items-end gap-6">
      <FilterSelect
        label="Status"
        param="status"
        value={status}
        allLabel="All statuses"
        onChange={update}
        options={RegistrationStatus.options.map((s) => ({
          value: s,
          label: STATUS_LABELS[s] ?? s,
        }))}
      />
      <FilterSelect
        label="Sound level"
        param="sound"
        value={sound}
        allLabel="All levels"
        onChange={update}
        options={SOUND_LEVELS.map((s) => ({
          value: s,
          label: SOUND_LEVEL_LABELS[s],
        }))}
      />
      <div className="flex flex-col gap-1.5 text-xs">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">
          Camp type
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={cohort === ALL ? ALL : cohort}
          onValueChange={(v) => update("cohort", v || ALL)}
          className="gap-0 [&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none"
        >
          <ToggleGroupItem value={ALL}>All</ToggleGroupItem>
          <ToggleGroupItem value="new">New</ToggleGroupItem>
          <ToggleGroupItem value="returning">Returning</ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}
