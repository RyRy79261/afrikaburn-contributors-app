"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { TeamChip } from "./team-chip";

// The team filter. A row of chips from md up; one "All teams" dropdown on a
// phone (canvas S1 `BPuki`), where six chips wrap into three rows.

const ALL = "all";

export interface TeamFilterOption {
  id: string;
  name: string;
  /** The URL that shows this team. */
  href: string;
}

export function TeamFilter({
  teams,
  allHref,
  active,
}: {
  teams: readonly TeamFilterOption[];
  /** The URL that shows every team. Hrefs, not a function: the pages that
   * render this are server components, and a function can't cross to here. */
  allHref: string;
  active: string | null;
}) {
  const router = useRouter();
  const hrefFor = (id: string | null) =>
    teams.find((t) => t.id === id)?.href ?? allHref;
  return (
    <>
      <nav
        aria-label="Filter by team"
        className="hidden flex-wrap gap-2 md:flex"
      >
        <TeamChip href={allHref} active={!active}>
          All teams
        </TeamChip>
        {teams.map((t) => (
          <TeamChip key={t.id} href={t.href} active={active === t.id}>
            {t.name}
          </TeamChip>
        ))}
      </nav>
      <div className="md:hidden">
        <Select
          value={active ?? ALL}
          onValueChange={(v) => router.push(hrefFor(v === ALL ? null : v))}
        >
          <SelectTrigger aria-label="Filter by team">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All teams</SelectItem>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
