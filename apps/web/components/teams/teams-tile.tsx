import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";

/**
 * The camp page's way into Teams (docs/camp-teams-spec.md; built without a
 * frame, after the Shifts and Meetings tiles): how many teams, how many the
 * member is on. Members only — the camp page never loads it for anyone else.
 */
export function TeamsTile({
  slug,
  teams,
  mine,
  canCreate,
}: {
  slug: string;
  teams: number;
  mine: number;
  canCreate: boolean;
}) {
  const description =
    teams === 0
      ? canCreate
        ? "Make the camp's teams — each gets a page, its people and a chat with no phone numbers."
        : "Your camp hasn't made any teams yet."
      : `${teams} ${teams === 1 ? "team" : "teams"} · you're in ${mine}. Each team has its own chat.`;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <Users className="h-4 w-4 text-accent" aria-hidden />
      <p className="text-sm font-medium">Teams</p>
      <p className="text-xs text-muted-foreground">{description}</p>
      <Link
        href={`/camps/${slug}/teams`}
        className="mt-auto inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {teams === 0 && canCreate ? "Make a team" : "Open teams"}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}
