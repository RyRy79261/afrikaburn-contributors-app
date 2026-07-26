import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import type { MembershipRole } from "@quagga/types";

import type { RosterMemberRow } from "@/lib/queries";

const ROLE_LABEL: Record<MembershipRole, string> = {
  god: "God",
  org_staff: "Org staff",
  lead: "Lead",
  admin: "Co-lead",
  member: "Member",
};

/**
 * The org-side member roster. NOTHING medical is rendered here — not the notes,
 * and not a "has notes / no notes" signpost either.
 *
 * The signpost was the subtler leak: whether a NAMED person has declared a
 * health condition is itself special personal information, so printing it down
 * forty rows is a complete census of who has disclosed, obtained in one page
 * load, with no `bio.medical.view` audit row written for any of it. AGENTS.md
 * puts medical on a member's DETAIL view only, precisely because casual bulk
 * exposure is a different risk from purposeful access — and the detail view is
 * the surface that records the read. Each row links there.
 */
export function MemberRoster({
  registrationId,
  members,
}: {
  registrationId: string;
  members: RosterMemberRow[];
}) {
  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground">No members on file.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {members.map((m) => (
        <li key={m.userId}>
          <Link
            href={`/registrations/${registrationId}/members/${m.userId}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-sm py-2.5 text-sm transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-center gap-2">
              <span className="font-medium">{m.displayName}</span>
              <Badge
                variant={
                  m.role === "lead"
                    ? "default"
                    : m.role === "admin"
                      ? "secondary"
                      : "outline"
                }
              >
                {ROLE_LABEL[m.role]}
              </Badge>
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Open member
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
