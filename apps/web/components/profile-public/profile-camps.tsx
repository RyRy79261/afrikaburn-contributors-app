import Link from "next/link";
import { Tent } from "lucide-react";
import type { GroupKind, MembershipRole } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import type { BurnerCamp, CampHistoryDisplay } from "@/lib/groups-store";

// The CAMPS block of the public burner profile: current memberships followed by
// self-reported camp history.
//
// The undiscoverability law is enforced UPSTREAM, server-side, in
// `getPublicBurnerProfile`: `camps` already contains ONLY camps with an approved
// registration this edition (free-camp memberships are never selected into the
// view model), and each history entry carries `registered`, which is the only
// thing that turns it into a discoverable link. This component never fetches
// and never re-decides — it renders what the server already gated.

const KIND_LABEL: Record<GroupKind, string> = {
  org: "AfrikaBurn",
  theme_camp: "Theme camp",
  artwork: "Artwork",
  mutant_vehicle: "Mutant vehicle",
};

// `god` renders as "System manager": the stored enum value stays `god` on
// purpose (@quagga/types roles.ts), and this is the label layer.
const ROLE_LABEL: Record<MembershipRole, string> = {
  god: "System manager",
  org_staff: "Org staff",
  engineer: "Engineer",
  lead: "Lead",
  admin: "Co-lead",
  member: "Member",
};

export function ProfileCamps({
  camps,
  campHistory,
}: {
  camps: BurnerCamp[];
  campHistory: CampHistoryDisplay[];
}) {
  if (camps.length === 0 && campHistory.length === 0) {
    return <p className="text-sm text-muted-foreground">No camps to show.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {camps.map((camp) => (
        <li
          key={camp.slug}
          className="flex items-center justify-between gap-3 py-2.5"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <Tent className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            <Link
              href={`/camps/${camp.slug}`}
              className="truncate rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {camp.name}
            </Link>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {KIND_LABEL[camp.kind]}
            </span>
          </span>
          <Badge
            variant={
              camp.role === "lead"
                ? "default"
                : camp.role === "admin"
                  ? "secondary"
                  : "outline"
            }
          >
            {ROLE_LABEL[camp.role]}
          </Badge>
        </li>
      ))}

      {campHistory.map((entry, i) => {
        // Linked entries link out ONLY when the camp is registered — a free
        // camp stays undiscoverable even when a member names it.
        const linkable =
          entry.kind === "linked" && entry.registered && entry.slug;
        const meta = [entry.event ?? "AfrikaBurn", entry.years]
          .filter(Boolean)
          .join(" · ");
        return (
          <li
            key={`${entry.label}-${i}`}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <Tent
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0">
                {linkable ? (
                  <Link
                    href={`/camps/${entry.slug}`}
                    className="rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {entry.label}
                  </Link>
                ) : (
                  <span className="font-medium">{entry.label}</span>
                )}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {meta}
                </span>
              </span>
            </span>
            {!linkable && <Badge variant="outline">Self-reported</Badge>}
          </li>
        );
      })}
    </ul>
  );
}
