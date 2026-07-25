"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { RoleAssignmentConsent } from "@quagga/types";
import { officerConsentCopy } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@quagga/ui/components/accordion";
import { RoleBadge } from "@quagga/ui/components/role-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import { PrivilegeEditor } from "./privileges";
import { OFFICER_PURPOSE } from "./types";
import type {
  AssignOfficerAction,
  MemberVM,
  OfficerVM,
  RoleVM,
  SetRolePermissionsAction,
  UnassignOfficerAction,
} from "./types";

// An officer row (canvas ZyKzw "Row LNT Lead" / "Row Sound Officer" /
// "Row Safety Baron"). Officers are org-defined catalog roles: NOT aliasable
// (no rename, no recolour — hence the lock glyph) and assignment is a CONSENT
// flow, because acceptance is the only path that shares a member's contact
// details with AfrikaBurn (questionnaire-spec §"Officers are ALSO
// registrations"; POPIA consent-based processing).

const CONSENT_TAG: Record<RoleAssignmentConsent, string> = {
  pending: "Awaiting acceptance",
  accepted: "✓ Accepted",
  declined: "Declined",
};

export function OfficerRow({
  slug,
  role,
  officer,
  officerApplies,
  members,
  roles,
  canAssign,
  canManageRoles,
  assignOfficerAction,
  unassignOfficerAction,
  setRolePermissionsAction,
}: {
  slug: string;
  role: RoleVM;
  officer: OfficerVM | undefined;
  /** Requirements only apply to registered / in-flight camps. */
  officerApplies: boolean;
  members: MemberVM[];
  roles: RoleVM[];
  canAssign: boolean;
  canManageRoles: boolean;
  assignOfficerAction: AssignOfficerAction;
  unassignOfficerAction: UnassignOfficerAction;
  setRolePermissionsAction: SetRolePermissionsAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [pick, setPick] = React.useState("");

  const assignments = officer?.assignments ?? [];
  const required = officer?.requirement === "required";
  const memberName = (id: string) =>
    members.find((m) => m.membershipId === id)?.displayName ?? "Member";
  const purpose = role.officerKey ? OFFICER_PURPOSE[role.officerKey] : "";
  const unassignedMembers = members.filter(
    (m) => !assignments.some((a) => a.membershipId === m.membershipId),
  );

  function assign() {
    if (!pick) return;
    startTransition(async () => {
      const res = await assignOfficerAction({
        slug,
        roleId: role.id,
        membershipId: pick,
      });
      if (res.ok) {
        toast.success("Asked them to accept — nothing is shared until they do.");
        setPick("");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function unassign(membershipId: string) {
    startTransition(async () => {
      const res = await unassignOfficerAction({
        slug,
        roleId: role.id,
        membershipId,
      });
      if (res.ok) {
        toast.success("Officer slot freed");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  // Collapsed summary: who holds it and where their consent sits.
  const summary =
    assignments.length === 0
      ? "Not yet assigned"
      : assignments
          .map((a) => {
            const who = memberName(a.membershipId);
            if (a.consent === "accepted") {
              return `${who} · contact shared with AfrikaBurn`;
            }
            if (a.consent === "pending") return `${who} · awaiting acceptance`;
            return `${who} · declined`;
          })
          .join(" · ");

  return (
    <AccordionItem value={role.id}>
      <AccordionTrigger>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <RoleBadge name={role.name} color={role.color} emoji={role.emoji} />
          <Lock
            className="h-3 w-3 shrink-0 text-muted-foreground"
            aria-label="Set by AfrikaBurn — officers can't be renamed"
          />
          {officerApplies && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                required
                  ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {officer?.requirement ?? "recommended"}
            </span>
          )}
          {assignments.map((a) => (
            <span
              key={`tag-${a.membershipId}`}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                a.consent === "accepted"
                  ? "bg-success/20 text-success"
                  : "bg-accent/20 text-accent"
              }`}
            >
              {CONSENT_TAG[a.consent]}
            </span>
          ))}
          <span
            className={`hidden min-w-0 truncate text-xs font-normal sm:inline ${
              assignments.length === 0 && required
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {summary}
          </span>
          {assignments.length === 0 && canAssign && (
            // Visual affordance only — the accordion trigger owns the click
            // (a real <button> here would nest inside the trigger button).
            <span className="ml-auto hidden rounded-md border border-input px-2.5 py-1 text-xs font-medium sm:inline">
              Assign
            </span>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground sm:hidden">{summary}</p>
          {purpose && (
            <p className="max-w-prose text-sm text-muted-foreground">
              {purpose}
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {assignments.length === 0 && (
              <li className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                Not yet assigned — that&apos;s a normal state, you can name
                someone whenever you know who it is.
              </li>
            )}
            {assignments.map((a) => (
              <li
                key={a.membershipId}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{memberName(a.membershipId)}</span>
                  <span
                    className={`text-xs ${
                      a.consent === "accepted"
                        ? "text-success"
                        : a.consent === "pending"
                          ? "text-accent"
                          : "text-muted-foreground"
                    }`}
                  >
                    {a.consent === "accepted"
                      ? "Accepted · name, email and phone shared with AfrikaBurn for this role"
                      : a.consent === "pending"
                        ? "Awaiting their acceptance · nothing shared yet"
                        : "Declined · the slot is free"}
                  </span>
                </span>
                {canAssign && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => unassign(a.membershipId)}
                    disabled={isPending}
                    aria-label={`Remove ${memberName(a.membershipId)} from ${role.name}`}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {canAssign && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Select value={pick} onValueChange={setPick}>
                <SelectTrigger className="h-9 w-full sm:w-64">
                  <SelectValue placeholder="Choose a member…" />
                </SelectTrigger>
                <SelectContent>
                  {unassignedMembers.map((m) => (
                    <SelectItem key={m.membershipId} value={m.membershipId}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={assign} disabled={isPending || !pick}>
                <Plus className="h-4 w-4" aria-hidden />
                Ask them to accept
              </Button>
            </div>
          )}

          <p className="flex items-start gap-2 rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {officerConsentCopy(role.name)}
          </p>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            Officer names, icons and colours are set by AfrikaBurn so the same
            vocabulary works across every camp — you can still choose what this
            officer may do inside your camp.
          </p>

          <div className="border-t border-border pt-4">
            <PrivilegeEditor
              slug={slug}
              role={role}
              roles={roles}
              canManageRoles={canManageRoles}
              setRolePermissionsAction={setRolePermissionsAction}
            />
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
