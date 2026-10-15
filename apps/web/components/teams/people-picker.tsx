"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Checkbox } from "@quagga/ui/components/checkbox";
import { Input } from "@quagga/ui/components/input";

/** One person a picker offers — a handle, never a contact detail. */
export interface PickablePerson {
  userId: string;
  displayName: string;
}

/**
 * A searchable tick list of camp members (frame T2 "Add people", T1 "Team
 * leads"). It offers only the people the SERVER listed; the write re-checks
 * every id under its own lock, so this decides nothing.
 */
export function PeoplePicker({
  people,
  selected,
  onChange,
  searchLabel = "Search the camp's members",
  emptyLabel = "Everyone in the camp is already on this team.",
}: {
  people: readonly PickablePerson[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  searchLabel?: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? people.filter((p) => p.displayName.toLowerCase().includes(q))
    : people;

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  }

  if (people.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className="pl-9"
        />
      </div>
      <ul className="flex max-h-60 flex-col overflow-y-auto">
        {shown.length === 0 && (
          <li className="py-2 text-sm text-muted-foreground">
            Nobody matches that.
          </li>
        )}
        {shown.map((p) => (
          <li key={p.userId}>
            <label className="flex min-h-[40px] cursor-pointer items-center gap-3 rounded-md px-1 text-sm hover:bg-muted/40">
              <Checkbox
                checked={selected.has(p.userId)}
                onChange={(e) => toggle(p.userId, e.target.checked)}
              />
              {p.displayName}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
