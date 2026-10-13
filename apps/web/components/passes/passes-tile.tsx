import Link from "next/link";
import { ArrowRight, Ticket } from "lucide-react";
import type { GroupKind, WapListStatus } from "@quagga/types";
import {
  WAP_LIST_STATUS_LABELS,
  wapAllocatedLabel,
  wapPassesPath,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { wapProjectNoun } from "@/lib/wap-view";

// The project page's way into Work Access Passes (epic #53) — for the
// project's leads and co-leads only; the page never loads the summary for
// anyone else. Counts only: no name is on the tile.

export function PassesTile({
  slug,
  kind,
  summary,
}: {
  slug: string;
  kind: GroupKind;
  summary: {
    window: "not_opened" | "open" | "closed";
    granted: number;
    allocated: number;
    pending: number | null;
    listStatus: WapListStatus | null;
  };
}) {
  const noun = wapProjectNoun(kind);
  const description =
    summary.granted > 0
      ? `${wapAllocatedLabel(summary.allocated, summary.granted)}${summary.listStatus ? ` · list ${WAP_LIST_STATUS_LABELS[summary.listStatus].toLowerCase()}` : ""}.`
      : summary.pending !== null
        ? `Asked for ${summary.pending} — waiting on AfrikaBurn.`
        : summary.window === "open"
          ? `Requests are open — ask for the passes the ${noun} needs.`
          : summary.window === "closed"
            ? "Requests are closed."
            : "AfrikaBurn hasn't opened requests yet.";

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-center justify-between gap-2">
        <Ticket className="h-4 w-4 text-accent" aria-hidden />
        {summary.window === "open" && (
          <Badge variant="success">Requests open</Badge>
        )}
      </div>
      <p className="text-sm font-medium">Work Access Passes</p>
      <p className="text-xs text-muted-foreground">{description}</p>
      <Link
        href={wapPassesPath(kind, slug)}
        className="mt-auto inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open passes
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

/** The member's own pass line ("You have a Work Access Pass — …"), from
 * @quagga/core `wapOwnPassLine`. Nothing renders for a draft list. */
export function OwnPassLine({ line }: { line: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm text-card-foreground">
      <Ticket className="h-4 w-4 shrink-0 text-accent" aria-hidden />
      <p>{line}</p>
    </div>
  );
}
