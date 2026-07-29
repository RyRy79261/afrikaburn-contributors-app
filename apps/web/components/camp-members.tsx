"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tags, Settings2, ArrowRight } from "lucide-react";
import type { MembershipRole, ProjectRoleKind, RoleColor } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { RoleBadge } from "@quagga/ui/components/role-badge";
import { toast } from "@quagga/ui/components/toast";
import { MemberRefCode } from "./member-ref-code";
import type { setMemberRolesAction } from "@/app/(app)/camps/[slug]/actions";

type SetMemberRolesAction = typeof setMemberRolesAction;

export interface CampRole {
  id: string;
  name: string;
  kind: ProjectRoleKind;
  color: RoleColor;
  emoji: string | null;
}

export interface CampMemberVM {
  membershipId: string;
  userId: string;
  displayName: string;
  role: MembershipRole;
  refCode: string | null;
  isViewer: boolean;
  roleIds: string[];
}

interface CampMembersProps {
  slug: string;
  canAssignRoles: boolean;
  canManageRoles: boolean;
  showRefCodes: boolean;
  officersOutstanding: number;
  roles: CampRole[];
  /** Role ids assignable via quick-assign (excludes baseline + officers). */
  assignableRoleIds: string[];
  members: CampMemberVM[];
  setMemberRolesAction: SetMemberRolesAction;
}

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

/**
 * The camp member roster. Names link to each member's DETAIL page — which is
 * where a camp lead sees that member's medical notes (never here: casual bulk
 * exposure down a list of forty people is a different risk from purposeful
 * access, so medical stays off every list, card and export).
 */
export function CampMembers(props: CampMembersProps) {
  const router = useRouter();
  const [members, setMembers] = React.useState<CampMemberVM[]>(props.members);
  const [assignFor, setAssignFor] = React.useState<CampMemberVM | null>(null);

  // Re-seed the optimistic roster whenever the server sends a fresh one.
  //
  // `members` exists so the chips move the instant a save succeeds, but
  // `useState(props.members)` IGNORES its argument on every render after the
  // first — so the `router.refresh()` fired after a save repainted the whole
  // page EXCEPT this list, and any wrong optimistic value survived until a full
  // page load. That is what made the dropped-chip bug below sticky rather than
  // momentary. This is React's documented "adjust state when a prop changes"
  // pattern (a render-phase set, not an effect, so nothing flashes).
  const [seenMembers, setSeenMembers] = React.useState(props.members);
  if (seenMembers !== props.members) {
    setSeenMembers(props.members);
    setMembers(props.members);
  }

  const role = React.useCallback(
    (id: string) => props.roles.find((r) => r.id === id),
    [props.roles],
  );

  return (
    <div className="flex flex-col gap-4">
      {(props.canManageRoles || props.canAssignRoles) && (
        <div className="flex justify-end">
          <Button asChild size="sm" variant="outline">
            <Link href={`/camps/${props.slug}/settings/roles`}>
              <Settings2 className="h-4 w-4" aria-hidden />
              Manage roles
              {props.officersOutstanding > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-destructive-foreground">
                  {props.officersOutstanding}
                </span>
              )}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-border">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-col gap-2 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm">
                <Link
                  href={`/burners/${m.userId}`}
                  className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {m.displayName}
                </Link>
                {m.isViewer && (
                  <span className="ml-1.5 text-xs text-accent">(you)</span>
                )}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {props.showRefCodes && m.refCode && (
                  <MemberRefCode code={m.refCode} />
                )}
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
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {m.roleIds.length > 0 ? (
                m.roleIds
                  .map((id) => role(id))
                  .filter((r): r is CampRole => Boolean(r))
                  .map((r) => (
                    <RoleBadge
                      key={r.id}
                      name={r.name}
                      color={r.color}
                      emoji={r.emoji}
                    />
                  ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  No roles yet
                </span>
              )}
              {props.canAssignRoles && (
                <button
                  type="button"
                  onClick={() => setAssignFor(m)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Tags className="h-3 w-3" aria-hidden />
                  Assign
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {props.canAssignRoles && assignFor && (
        <AssignRolesDialog
          key={assignFor.membershipId}
          member={assignFor}
          roles={props.roles.filter((r) =>
            props.assignableRoleIds.includes(r.id),
          )}
          slug={props.slug}
          onClose={() => setAssignFor(null)}
          onSaved={(roleIds) => {
            // MERGE, don't replace. The dialog only ever returns the ASSIGNABLE
            // selection, but a roster row's chips also carry the ids the dialog
            // can't touch — the baseline role everyone holds, and any accepted
            // officer role. Overwriting `roleIds` with the selection therefore
            // stripped the "Burner" chip off whoever you had just given a role
            // to, and (before the re-seed above) left it stripped: the roster
            // read as if assigning a role had cost them their membership one.
            const assignable = new Set(props.assignableRoleIds);
            setMembers((prev) =>
              prev.map((m) =>
                m.membershipId === assignFor.membershipId
                  ? {
                      ...m,
                      roleIds: [
                        ...m.roleIds.filter((id) => !assignable.has(id)),
                        ...roleIds,
                      ],
                    }
                  : m,
              ),
            );
            setAssignFor(null);
            router.refresh();
          }}
          setMemberRolesAction={props.setMemberRolesAction}
        />
      )}
    </div>
  );
}

function AssignRolesDialog({
  member,
  roles,
  slug,
  onClose,
  onSaved,
  setMemberRolesAction,
}: {
  member: CampMemberVM;
  roles: CampRole[];
  slug: string;
  onClose: () => void;
  onSaved: (roleIds: string[]) => void;
  setMemberRolesAction: SetMemberRolesAction;
}) {
  // Only assignable role ids are editable here (baseline + officers excluded).
  const assignableIds = React.useMemo(
    () => new Set(roles.map((r) => r.id)),
    [roles],
  );
  const [selected, setSelected] = React.useState<string[]>(
    member.roleIds.filter((id) => assignableIds.has(id)),
  );
  const [isPending, startTransition] = React.useTransition();

  function save() {
    startTransition(async () => {
      const result = await setMemberRolesAction({
        slug,
        membershipId: member.membershipId,
        roleIds: selected,
      });
      if (result.ok) {
        toast.success("Roles updated");
        // The ASSIGNABLE selection only — the roster merges it over the chips
        // this dialog never had (baseline, accepted officers). The comment here
        // used to claim this call preserved the baseline chip; it did the
        // opposite.
        onSaved(selected);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roles for {member.displayName}</DialogTitle>
          <DialogDescription>
            A member can hold several roles. Officer registrations are managed
            on the Roles &amp; Officers page.
          </DialogDescription>
        </DialogHeader>

        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No assignable roles yet. Add some on the Roles &amp; Officers page.
          </p>
        ) : (
          <ToggleGroup
            type="multiple"
            variant="outline"
            value={selected}
            onValueChange={setSelected}
            className="flex-wrap justify-start"
          >
            {roles.map((r) => (
              <ToggleGroupItem key={r.id} value={r.id}>
                {r.emoji ? `${r.emoji} ` : ""}
                {r.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isPending || roles.length === 0}>
            {isPending ? "Saving…" : "Save roles"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
