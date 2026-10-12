"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Hourglass } from "lucide-react";
import { WAP_LIST_STATUS_LABELS } from "@quagga/core";
import { WapListStatus } from "@quagga/types";
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

// The overview's filters (frame W3): list status, project type, pending only.
// URL search params, so a filtered view is a link the reviewer can share.

const ALL = "all";
const BASE = "/registrations/passes";

export function WapOverviewFilters({
  status,
  kind,
  pendingOnly,
  pendingCount,
}: {
  status: string;
  kind: string;
  pendingOnly: boolean;
  pendingCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const update = useCallback(
    (param: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (!value || value === ALL) next.delete(param);
      else next.set(param, value);
      const qs = next.toString();
      router.push(qs ? `${BASE}?${qs}` : BASE);
    },
    [router, searchParams],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={status} onValueChange={(v) => update("status", v)}>
        <SelectTrigger
          className="h-9 w-full text-sm sm:w-[13rem]"
          aria-label="List status"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All list statuses</SelectItem>
          {WapListStatus.options.map((s) => (
            <SelectItem key={s} value={s}>
              {WAP_LIST_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={kind}
        onValueChange={(v) => update("kind", v || ALL)}
        aria-label="Project type"
        className="flex-wrap justify-start"
      >
        <ToggleGroupItem value={ALL}>All projects</ToggleGroupItem>
        <ToggleGroupItem value="theme_camp">Theme camps</ToggleGroupItem>
        <ToggleGroupItem value="artwork">Artworks</ToggleGroupItem>
        <ToggleGroupItem value="mutant_vehicle">
          Mutant vehicles
        </ToggleGroupItem>
      </ToggleGroup>
      {/* A one-item group is the prebuilt on/off toggle this design system
          ships (no separate Toggle primitive). */}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={pendingOnly ? "pending" : ""}
        onValueChange={(v) => update("pending", v === "pending" ? "1" : null)}
      >
        <ToggleGroupItem value="pending">
          <Hourglass className="h-4 w-4" aria-hidden />
          Pending requests only
          <span className="rounded bg-muted px-1.5 text-xs tabular-nums">
            {pendingCount}
          </span>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
