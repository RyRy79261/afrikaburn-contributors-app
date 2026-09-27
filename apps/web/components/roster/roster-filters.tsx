"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@quagga/ui/components/input";
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

// Roster search + filter (epic #55, CDB-031..033). NEEDS DESIGN REVIEW — built
// from existing components without a canvas frame.
//
// URL-DRIVEN: every change replaces the query string and the SERVER re-runs
// the filter (@quagga/core `parseRosterFilter` → `buildCampRoster`), so a
// filtered roster is a link a lead can share with a co-lead. This component
// holds no roster data and decides nothing.

const ALL = "all";

export interface RosterFilterValues {
  q: string;
  /** The `role` param value, or "" for every role. */
  role: string;
  /** "complete" | "incomplete" | "" */
  bio: string;
}

export function RosterFilters({
  initial,
  roleOptions,
}: {
  initial: RosterFilterValues;
  roleOptions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();
  const [q, setQ] = React.useState(initial.q);

  const navigate = React.useCallback(
    (next: RosterFilterValues) => {
      const params = new URLSearchParams();
      if (next.q.trim()) params.set("q", next.q.trim());
      if (next.role) params.set("role", next.role);
      if (next.bio) params.set("bio", next.bio);
      const query = params.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      });
    },
    [pathname, router],
  );

  return (
    <form
      role="search"
      aria-label="Filter the roster"
      aria-busy={pending}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        navigate({ ...initial, q });
      }}
    >
      <div className="relative min-w-0 flex-1 sm:min-w-56">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          name="q"
          aria-label="Search by name"
          placeholder="Search by name"
          className="pl-9"
          maxLength={100}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => {
            if (q.trim() !== initial.q) navigate({ ...initial, q });
          }}
        />
      </div>

      <div className="sm:w-48">
        <Select
          value={initial.role || ALL}
          onValueChange={(value) =>
            navigate({ ...initial, q, role: value === ALL ? "" : value })
          }
        >
          <SelectTrigger aria-label="Filter by role">
            <SelectValue placeholder="Every role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Every role</SelectItem>
            <SelectItem value="lead">Leads</SelectItem>
            <SelectItem value="admin">Co-leads</SelectItem>
            <SelectItem value="member">Members</SelectItem>
            {roleOptions.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="Filter by bio"
        value={initial.bio || ALL}
        onValueChange={(value) => {
          // Radix sends "" when the pressed item is pressed again.
          const bio = !value || value === ALL ? "" : value;
          navigate({ ...initial, q, bio });
        }}
      >
        <ToggleGroupItem value={ALL}>All bios</ToggleGroupItem>
        <ToggleGroupItem value="complete">Bio complete</ToggleGroupItem>
        <ToggleGroupItem value="incomplete">Bio not complete</ToggleGroupItem>
      </ToggleGroup>
    </form>
  );
}
