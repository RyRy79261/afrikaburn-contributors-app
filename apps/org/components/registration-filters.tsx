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
import { Button } from "@quagga/ui/components/button";
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

function Filter({
  label,
  param,
  value,
  options,
  onChange,
}: {
  label: string;
  param: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (param: string, value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Select value={value} onValueChange={(v) => onChange(param, v)}>
        <SelectTrigger className="h-9 w-[11rem] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
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

/** Status / sound / cohort filters that drive the registrations table via URL. */
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
      if (value === ALL) next.delete(param);
      else next.set(param, value);
      const qs = next.toString();
      router.push(qs ? `/registrations?${qs}` : "/registrations");
    },
    [router, searchParams],
  );

  const anyActive = status !== ALL || sound !== ALL || cohort !== ALL;

  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <Filter
        label="Status"
        param="status"
        value={status}
        onChange={update}
        options={RegistrationStatus.options.map((s) => ({
          value: s,
          label: STATUS_LABELS[s] ?? s,
        }))}
      />
      <Filter
        label="Sound level"
        param="sound"
        value={sound}
        onChange={update}
        options={SOUND_LEVELS.map((s) => ({
          value: s,
          label: SOUND_LEVEL_LABELS[s],
        }))}
      />
      <Filter
        label="Cohort"
        param="cohort"
        value={cohort}
        onChange={update}
        options={[
          { value: "new", label: "New" },
          { value: "returning", label: "Returning" },
        ]}
      />
      {anyActive && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/registrations")}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}
