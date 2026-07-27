"use client";

import * as React from "react";
import { Check, ShieldAlert } from "lucide-react";
import type { OutstandingOfficers } from "@quagga/core";
import { Accordion } from "@quagga/ui/components/accordion";
import { NewRoleCard } from "./new-role-card";
import { OfficerRow } from "./officer-row";
import { RoleRow } from "./role-row";
import type {
  AssignOfficerAction,
  CreateRoleWithSetupAction,
  MemberVM,
  OfficerVM,
  RemoveRoleAction,
  RenameRoleAction,
  RoleVM,
  SetRoleAppearanceAction,
  SetRolePermissionsAction,
  UnassignOfficerAction,
} from "./types";

// Camp Settings · Roles & Officers (canvas ZyKzw desktop / TIrbC mobile).
// A separate, set-and-forget screen from the members view: three expandable
// groups — OFFICERS (org registrations, consent-gated), CORE ROLES (seeded
// fixtures: captain locked, baseline everyone-holds-it, defaults renameable)
// and CUSTOM ROLES (create/edit/delete). One row open at a time keeps it
// scannable (questionnaire-spec §"Roles v2" / §"Role kinds" / §"Officer roles").

interface Props {
  slug: string;
  canManageRoles: boolean;
  canAssignRoles: boolean;
  roles: RoleVM[];
  members: MemberVM[];
  officers: OfficerVM[];
  officerApplies: boolean;
  outstanding: OutstandingOfficers;
  createRoleWithSetupAction: CreateRoleWithSetupAction;
  renameRoleAction: RenameRoleAction;
  removeRoleAction: RemoveRoleAction;
  setRoleAppearanceAction: SetRoleAppearanceAction;
  setRolePermissionsAction: SetRolePermissionsAction;
  assignOfficerAction: AssignOfficerAction;
  unassignOfficerAction: UnassignOfficerAction;
}

function SectionHead({
  title,
  sub,
  badge,
}: {
  title: string;
  sub: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {badge}
      </div>
      <p className="max-w-prose text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

/** Outstanding-required-officers badge — destructive until the count clears. */
function OutstandingBadge({
  outstanding,
}: {
  outstanding: OutstandingOfficers;
}) {
  if (!outstanding.applies) return null;
  if (outstanding.outstanding.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success px-2.5 py-0.5 text-xs font-semibold text-[color:var(--color-success-foreground)]">
        <Check className="h-3.5 w-3.5" aria-hidden />
        All required officers assigned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-0.5 text-xs font-semibold text-destructive-foreground">
      <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
      {outstanding.outstanding.length} outstanding
      <span className="hidden sm:inline">
        {" "}
        · {outstanding.assignedCount} of {outstanding.requiredCount} assigned
      </span>
    </span>
  );
}

export function RolesSettings(props: Props) {
  const officerRoles = props.roles.filter((r) => r.kind === "officer");
  const coreRoles = props.roles.filter(
    (r) =>
      r.kind === "captain" || r.kind === "baseline" || r.kind === "default",
  );
  const customRoles = props.roles.filter((r) => r.kind === "custom");

  return (
    <div className="flex flex-col gap-8">
      {/* --- Officers ------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <SectionHead
          title="Officers"
          sub={
            props.officerApplies
              ? "The people AfrikaBurn needs to reach. Assigning one asks them to accept — only then are their contact details shared with AfrikaBurn."
              : "Free camps don't have required officers — requirements apply once you register. You can still name them voluntarily."
          }
          badge={<OutstandingBadge outstanding={props.outstanding} />}
        />
        <Accordion type="single" collapsible className="flex flex-col gap-2">
          {officerRoles.map((role) => (
            <OfficerRow
              key={role.id}
              slug={props.slug}
              role={role}
              officer={props.officers.find((o) => o.roleId === role.id)}
              officerApplies={props.officerApplies}
              members={props.members}
              roles={props.roles}
              canAssign={props.canAssignRoles}
              canManageRoles={props.canManageRoles}
              assignOfficerAction={props.assignOfficerAction}
              unassignOfficerAction={props.unassignOfficerAction}
              setRolePermissionsAction={props.setRolePermissionsAction}
            />
          ))}
        </Accordion>
      </section>

      {/* --- Core roles ---------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionHead
          title="Core roles"
          sub="Seeded on every camp. Rename and recolour freely — these can't be deleted."
        />
        <Accordion type="single" collapsible className="flex flex-col gap-2">
          {coreRoles.map((role) => (
            <RoleRow
              key={role.id}
              slug={props.slug}
              role={role}
              roles={props.roles}
              canManageRoles={props.canManageRoles}
              renameRoleAction={props.renameRoleAction}
              removeRoleAction={props.removeRoleAction}
              setRoleAppearanceAction={props.setRoleAppearanceAction}
              setRolePermissionsAction={props.setRolePermissionsAction}
            />
          ))}
        </Accordion>
      </section>

      {/* --- Custom roles -------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionHead
          title="Custom roles"
          sub="Anything your camp needs. Delete these anytime (members keep their membership)."
        />
        <Accordion type="single" collapsible className="flex flex-col gap-2">
          {customRoles.map((role) => (
            <RoleRow
              key={role.id}
              slug={props.slug}
              role={role}
              roles={props.roles}
              canManageRoles={props.canManageRoles}
              renameRoleAction={props.renameRoleAction}
              removeRoleAction={props.removeRoleAction}
              setRoleAppearanceAction={props.setRoleAppearanceAction}
              setRolePermissionsAction={props.setRolePermissionsAction}
            />
          ))}
        </Accordion>
        {customRoles.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No custom roles yet — add one to organise your crew.
          </p>
        )}
        {props.canManageRoles && (
          <NewRoleCard
            slug={props.slug}
            roles={props.roles}
            createRoleWithSetupAction={props.createRoleWithSetupAction}
          />
        )}
      </section>
    </div>
  );
}
