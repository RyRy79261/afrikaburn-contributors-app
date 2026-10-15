import Link from "next/link";
import { Check, ChevronRight, Lock, Users } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import type { TeamListItem, TeamPersonView } from "@/lib/camp-teams-store";
import { JoinModeChip } from "./join-mode-chip";
import { JoinTeamButton } from "./team-dialogs";

/** "Lead: Thandi Mokoena" / "Leads: Alice Hatter, Pieter van Wyk" / "No
 * team lead yet". Names are handles, as on every team surface. */
export function leadsLine(leads: readonly TeamPersonView[]): string {
  if (leads.length === 0) return "No team lead yet";
  const names = leads.map((l) => l.displayName).join(", ");
  return `${leads.length === 1 ? "Lead" : "Leads"}: ${names}`;
}

/** "1 member" / "6 members". */
export function memberCountLabel(n: number): string {
  return `${n} ${n === 1 ? "member" : "members"}`;
}

/**
 * One row of the camp's team list (frame T1): name, join mode, leads and
 * member count, then Joined, Join, or "A team lead adds people". The whole
 * row opens the team page; Join sits above the row's link.
 */
export function TeamListRow({
  slug,
  team,
}: {
  slug: string;
  team: TeamListItem;
}) {
  const href = `/camps/${slug}/teams/${team.id}`;
  return (
    <li className="relative flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary/60 text-primary">
          <Users className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={href}
              className="font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {team.name}
            </Link>
            <span className="hidden sm:inline-flex">
              <JoinModeChip joinMode={team.joinMode} />
            </span>
            {team.archived && <Badge variant="secondary">Archived</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {leadsLine(team.leads)}
            <span className="hidden sm:inline">
              {" "}
              · {memberCountLabel(team.memberCount)}
            </span>
          </p>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground sm:hidden">
            <JoinModeChip joinMode={team.joinMode} />
            {memberCountLabel(team.memberCount)}
          </p>
        </div>
        <ChevronRight
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground sm:hidden"
          aria-hidden
        />
      </div>
      <div className="flex items-center gap-3 sm:shrink-0">
        {team.viewerOnTeam ? (
          <Badge variant="success" className="w-fit">
            <Check className="h-3 w-3" aria-hidden />
            Joined
          </Badge>
        ) : team.canJoin ? (
          <JoinTeamButton
            slug={slug}
            teamId={team.id}
            teamName={team.name}
            className="relative z-10 w-full sm:w-auto"
          />
        ) : team.archived ? null : (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />A team lead adds people
          </span>
        )}
        <ChevronRight
          className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block"
          aria-hidden
        />
      </div>
    </li>
  );
}
