"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, ShieldAlert, Info } from "lucide-react";
import type {
  OfficerKey,
  ProjectPermissions,
  ProjectRoleKind,
  RoleColor,
  RoleAssignmentConsent,
} from "@quagga/types";
import { ROLE_COLORS } from "@quagga/types";
import type { OfficerRequirement, OutstandingOfficers } from "@quagga/core";
import { officerConsentCopy } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@quagga/ui/components/accordion";
import {
  RoleBadge,
  RoleSwatch,
  ROLE_COLOR_LABELS,
} from "@quagga/ui/components/role-badge";
import { toast } from "@quagga/ui/components/toast";
import type {
  createRoleAction,
  renameRoleAction,
  removeRoleAction,
  setRoleAppearanceAction,
  setRolePermissionsAction,
  assignOfficerAction,
  unassignOfficerAction,
} from "@/app/camps/[slug]/actions";

// Aliased at module scope so inner components can annotate props with the action
// types without the destructured parameter shadowing the import.
type CreateRoleAction = typeof createRoleAction;
type RenameRoleAction = typeof renameRoleAction;
type RemoveRoleAction = typeof removeRoleAction;
type SetRoleAppearanceAction = typeof setRoleAppearanceAction;
type SetRolePermissionsAction = typeof setRolePermissionsAction;
type AssignOfficerAction = typeof assignOfficerAction;
type UnassignOfficerAction = typeof unassignOfficerAction;

interface RoleVM {
  id: string;
  name: string;
  kind: ProjectRoleKind;
  color: RoleColor;
  emoji: string | null;
  permissions: ProjectPermissions;
  officerKey: OfficerKey | null;
}

interface MemberVM {
  membershipId: string;
  userId: string;
  displayName: string;
}

interface OfficerVM {
  roleId: string;
  officerKey: OfficerKey;
  name: string;
  emoji: string | null;
  color: RoleColor;
  requirement: OfficerRequirement;
  assignments: {
    membershipId: string;
    consent: RoleAssignmentConsent;
    orgVisible: boolean;
  }[];
}

interface Props {
  slug: string;
  canManageRoles: boolean;
  canAssignRoles: boolean;
  canViewDetails: boolean;
  roles: RoleVM[];
  members: MemberVM[];
  assignmentsByMember: Record<string, string[]>;
  officers: OfficerVM[];
  officerApplies: boolean;
  outstanding: OutstandingOfficers;
  createRoleAction: CreateRoleAction;
  renameRoleAction: RenameRoleAction;
  removeRoleAction: RemoveRoleAction;
  setRoleAppearanceAction: SetRoleAppearanceAction;
  setRolePermissionsAction: SetRolePermissionsAction;
  assignOfficerAction: AssignOfficerAction;
  unassignOfficerAction: UnassignOfficerAction;
}

const KIND_TAG: Record<ProjectRoleKind, string> = {
  captain: "Captain",
  baseline: "Everyone",
  default: "Default",
  custom: "Custom",
  officer: "Officer",
};

/** One-line privilege summary for a collapsed row. */
function privilegeSummary(p: ProjectPermissions): string {
  const parts: string[] = [];
  if (p.manage_questionnaires) {
    const scope = p.manage_questionnaires.audienceRoles;
    const who =
      scope === "all"
        ? "all audiences"
        : `${scope.length} audience${scope.length === 1 ? "" : "s"}`;
    parts.push(`Questionnaires (${who})`);
  }
  if (p.view_member_details) parts.push("sees member details");
  if (p.manage_roles) parts.push("manages roles");
  else if (p.assign_roles) parts.push("assigns roles");
  if (p.manage_members) parts.push("manages members");
  return parts.length ? parts.join(" · ") : "No extra privileges";
}

export function RolesSettings(props: Props) {
  const officers = props.roles.filter((r) => r.kind === "officer");
  const coreRoles = props.roles.filter(
    (r) => r.kind === "captain" || r.kind === "baseline" || r.kind === "default",
  );
  const customRoles = props.roles.filter((r) => r.kind === "custom");

  return (
    <div className="flex flex-col gap-8">
      {/* --- Officers ------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Officers
          </h2>
          {props.officerApplies ? (
            props.outstanding.outstanding.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-0.5 text-xs font-semibold text-destructive-foreground">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                {props.outstanding.outstanding.length} outstanding ·{" "}
                {props.outstanding.assignedCount} of {props.outstanding.requiredCount}{" "}
                assigned
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success px-2.5 py-0.5 text-xs font-semibold text-[color:var(--color-success-foreground)]">
                <Check className="h-3.5 w-3.5" aria-hidden />
                All required officers assigned
              </span>
            )
          ) : null}
        </div>
        {props.officerApplies ? (
          <p className="text-xs text-muted-foreground">
            AfrikaBurn asks registered camps to name the people responsible for
            these functions. Assigning an officer sends them a request to accept —
            once they do, their contact details are shared with AfrikaBurn for
            that role.
          </p>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            Officers are optional for free camps — nothing is required until you
            have a registration in flight. You can still assign them voluntarily.
          </p>
        )}

        <Accordion type="single" collapsible className="flex flex-col gap-2">
          {officers.map((role) => {
            const officer = props.officers.find((o) => o.roleId === role.id);
            return (
              <OfficerRow
                key={role.id}
                slug={props.slug}
                role={role}
                officer={officer}
                officerApplies={props.officerApplies}
                members={props.members}
                canAssign={props.canAssignRoles}
                canManageRoles={props.canManageRoles}
                canViewDetails={props.canViewDetails}
                roles={props.roles}
                assignOfficerAction={props.assignOfficerAction}
                unassignOfficerAction={props.unassignOfficerAction}
                setRolePermissionsAction={props.setRolePermissionsAction}
              />
            );
          })}
        </Accordion>
      </section>

      {/* --- Core Roles --------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Core Roles
        </h2>
        <Accordion type="single" collapsible className="flex flex-col gap-2">
          {coreRoles.map((role) => (
            <RoleRow
              key={role.id}
              slug={props.slug}
              role={role}
              canManageRoles={props.canManageRoles}
              roles={props.roles}
              renameRoleAction={props.renameRoleAction}
              removeRoleAction={props.removeRoleAction}
              setRoleAppearanceAction={props.setRoleAppearanceAction}
              setRolePermissionsAction={props.setRolePermissionsAction}
            />
          ))}
        </Accordion>
      </section>

      {/* --- Custom Roles ------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Custom Roles
        </h2>
        <Accordion type="single" collapsible className="flex flex-col gap-2">
          {customRoles.map((role) => (
            <RoleRow
              key={role.id}
              slug={props.slug}
              role={role}
              canManageRoles={props.canManageRoles}
              roles={props.roles}
              renameRoleAction={props.renameRoleAction}
              removeRoleAction={props.removeRoleAction}
              setRoleAppearanceAction={props.setRoleAppearanceAction}
              setRolePermissionsAction={props.setRolePermissionsAction}
            />
          ))}
          {customRoles.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No custom roles yet — add one below to organise your crew.
            </p>
          )}
        </Accordion>
        {props.canManageRoles && (
          <CreateRoleCard slug={props.slug} createRoleAction={props.createRoleAction} />
        )}
      </section>
    </div>
  );
}

// --- Role row (core + custom) ---------------------------------------------

function RoleRow({
  slug,
  role,
  canManageRoles,
  roles,
  renameRoleAction,
  removeRoleAction,
  setRoleAppearanceAction,
  setRolePermissionsAction,
}: {
  slug: string;
  role: RoleVM;
  canManageRoles: boolean;
  roles: RoleVM[];
  renameRoleAction: RenameRoleAction;
  removeRoleAction: RemoveRoleAction;
  setRoleAppearanceAction: SetRoleAppearanceAction;
  setRolePermissionsAction: SetRolePermissionsAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(role.name);
  const [emoji, setEmoji] = React.useState(role.emoji ?? "");
  const canRename = role.kind !== "officer";
  const canDelete = role.kind === "custom";

  function saveRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === role.name) return;
    startTransition(async () => {
      const res = await renameRoleAction({ slug, roleId: role.id, name: trimmed });
      if (res.ok) {
        toast.success("Renamed");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function saveColor(color: RoleColor) {
    startTransition(async () => {
      const res = await setRoleAppearanceAction({ slug, roleId: role.id, color });
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  function saveEmoji() {
    startTransition(async () => {
      const res = await setRoleAppearanceAction({
        slug,
        roleId: role.id,
        emoji: emoji.trim() || null,
      });
      if (res.ok) {
        toast.success("Saved");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await removeRoleAction({ slug, roleId: role.id });
      if (res.ok) {
        toast.success("Role deleted");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <AccordionItem value={role.id}>
      <AccordionTrigger>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <RoleBadge name={role.name} color={role.color} emoji={role.emoji} />
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {KIND_TAG[role.kind]}
          </span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {privilegeSummary(role.permissions)}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <div className="flex flex-col gap-5">
          {role.kind === "captain" && (
            <p className="flex items-start gap-2 rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Captains can do everything — that&apos;s what makes them captains.
              Their privileges are locked on.
            </p>
          )}

          <PermissionEditor
            role={role}
            roles={roles}
            disabled={!canManageRoles || role.kind === "captain"}
            slug={slug}
            setRolePermissionsAction={setRolePermissionsAction}
          />

          {/* Appearance + rename */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Appearance
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {ROLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={ROLE_COLOR_LABELS[c]}
                  disabled={!canManageRoles || isPending}
                  onClick={() => saveColor(c)}
                  className="rounded-full p-0.5 disabled:opacity-50"
                >
                  <RoleSwatch color={c} selected={c === role.color} />
                </button>
              ))}
            </div>
            {canManageRoles && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted-foreground">Emoji</label>
                <Input
                  value={emoji}
                  onChange={(e) => setEmoji(e.target.value)}
                  maxLength={4}
                  className="h-8 w-16 text-center"
                />
                <Button size="sm" variant="outline" onClick={saveEmoji} disabled={isPending}>
                  Save emoji
                </Button>
              </div>
            )}
          </div>

          {canManageRoles && canRename && (
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  className="h-8 w-56"
                />
              </div>
              <Button size="sm" onClick={saveRename} disabled={isPending}>
                <Check className="h-4 w-4" aria-hidden />
                Rename
              </Button>
            </div>
          )}

          {canManageRoles && canDelete && (
            <div className="border-t border-border pt-4">
              <Button
                size="sm"
                variant="ghost"
                onClick={remove}
                disabled={isPending}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete role
              </Button>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

// --- Permission editor -----------------------------------------------------

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 aria-checked:border-primary"
    >
      <span>{label}</span>
      <span
        className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-background transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </span>
    </button>
  );
}

function PermissionEditor({
  role,
  roles,
  disabled,
  slug,
  setRolePermissionsAction,
}: {
  role: RoleVM;
  roles: RoleVM[];
  disabled: boolean;
  slug: string;
  setRolePermissionsAction: SetRolePermissionsAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [perms, setPerms] = React.useState<ProjectPermissions>(role.permissions);
  const dirty = JSON.stringify(perms) !== JSON.stringify(role.permissions);

  // Audience-role candidates for the manage_questionnaires scope: non-officer,
  // non-baseline roles (baseline = the "everyone" audience, always allowed).
  const audienceRoles = roles.filter(
    (r) => r.kind !== "officer" && r.kind !== "baseline",
  );
  const baseline = roles.find((r) => r.kind === "baseline");

  const mq = perms.manage_questionnaires;
  const scopeAll = mq?.audienceRoles === "all";
  const scopeIds = mq && mq.audienceRoles !== "all" ? mq.audienceRoles : [];

  function set(next: ProjectPermissions) {
    setPerms(next);
  }

  function toggleQuestionnaires(on: boolean) {
    if (on) set({ ...perms, manage_questionnaires: { audienceRoles: "all", mayBlock: false } });
    else {
      const { manage_questionnaires: _omit, ...rest } = perms;
      void _omit;
      set(rest);
    }
  }

  function toggleScopeAll(all: boolean) {
    if (!mq) return;
    set({
      ...perms,
      manage_questionnaires: {
        ...mq,
        audienceRoles: all ? "all" : baseline ? [baseline.id] : [],
      },
    });
  }

  function toggleScopeRole(roleId: string) {
    if (!mq || mq.audienceRoles === "all") return;
    const has = mq.audienceRoles.includes(roleId);
    set({
      ...perms,
      manage_questionnaires: {
        ...mq,
        audienceRoles: has
          ? mq.audienceRoles.filter((id) => id !== roleId)
          : [...mq.audienceRoles, roleId],
      },
    });
  }

  function save() {
    startTransition(async () => {
      const res = await setRolePermissionsAction({ slug, roleId: role.id, permissions: perms });
      if (res.ok) {
        toast.success("Privileges saved");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Privileges
      </span>
      <Toggle
        label="See member details (ref codes, emails, join dates)"
        checked={!!perms.view_member_details}
        disabled={disabled}
        onChange={(v) => set({ ...perms, view_member_details: v || undefined })}
      />
      <Toggle
        label="Send questionnaires"
        checked={!!mq}
        disabled={disabled}
        onChange={toggleQuestionnaires}
      />
      {mq && (
        <div className="ml-3 flex flex-col gap-2 border-l border-border pl-3">
          <Toggle
            label="May target any audience"
            checked={scopeAll}
            disabled={disabled}
            onChange={toggleScopeAll}
          />
          {!scopeAll && (
            <div className="flex flex-wrap gap-1.5">
              <span className="w-full text-xs text-muted-foreground">
                Allowed audiences (everyone / baseline is always allowed):
              </span>
              {audienceRoles.map((r) => {
                const on = scopeIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleScopeRole(r.id)}
                    className={`rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${on ? "border-primary bg-primary/15" : "border-border text-muted-foreground"}`}
                  >
                    {r.emoji ? `${r.emoji} ` : ""}
                    {r.name}
                  </button>
                );
              })}
            </div>
          )}
          <Toggle
            label="May send blocking (gate-the-app) questionnaires"
            checked={!!mq.mayBlock}
            disabled={disabled}
            onChange={(v) =>
              set({ ...perms, manage_questionnaires: { ...mq, mayBlock: v } })
            }
          />
        </div>
      )}
      <Toggle
        label="Assign roles to members"
        checked={!!perms.assign_roles || !!perms.manage_roles}
        disabled={disabled || !!perms.manage_roles}
        onChange={(v) => set({ ...perms, assign_roles: v || undefined })}
      />
      <Toggle
        label="Manage role definitions (implies assign)"
        checked={!!perms.manage_roles}
        disabled={disabled}
        onChange={(v) => set({ ...perms, manage_roles: v || undefined })}
      />
      <Toggle
        label="Manage members (invites)"
        checked={!!perms.manage_members}
        disabled={disabled}
        onChange={(v) => set({ ...perms, manage_members: v || undefined })}
      />
      {!disabled && dirty && (
        <Button size="sm" className="self-start" onClick={save} disabled={isPending}>
          <Check className="h-4 w-4" aria-hidden />
          Save privileges
        </Button>
      )}
    </div>
  );
}

// --- Officer row -----------------------------------------------------------

const CONSENT_LABEL: Record<RoleAssignmentConsent, string> = {
  pending: "Awaiting acceptance",
  accepted: "Accepted",
  declined: "Declined",
};

function OfficerRow({
  slug,
  role,
  officer,
  officerApplies,
  members,
  canAssign,
  canManageRoles,
  canViewDetails,
  roles,
  assignOfficerAction,
  unassignOfficerAction,
  setRolePermissionsAction,
}: {
  slug: string;
  role: RoleVM;
  officer: OfficerVM | undefined;
  officerApplies: boolean;
  members: MemberVM[];
  canAssign: boolean;
  canManageRoles: boolean;
  canViewDetails: boolean;
  roles: RoleVM[];
  assignOfficerAction: AssignOfficerAction;
  unassignOfficerAction: UnassignOfficerAction;
  setRolePermissionsAction: SetRolePermissionsAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [pick, setPick] = React.useState("");
  const assignments = officer?.assignments ?? [];
  const memberName = (id: string) =>
    members.find((m) => m.membershipId === id)?.displayName ?? "Member";

  function assign() {
    if (!pick) return;
    startTransition(async () => {
      const res = await assignOfficerAction({ slug, roleId: role.id, membershipId: pick });
      if (res.ok) {
        toast.success("Officer invited — awaiting their acceptance");
        setPick("");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function unassign(membershipId: string) {
    startTransition(async () => {
      const res = await unassignOfficerAction({ slug, roleId: role.id, membershipId });
      if (res.ok) {
        toast.success("Removed");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <AccordionItem value={role.id}>
      <AccordionTrigger>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <RoleBadge name={role.name} color={role.color} emoji={role.emoji} />
          {/* Requirement tags apply only to registered / in-flight camps.
              Free camps show no badge (questionnaire-spec §"Officer roles":
              "Free camps: no badge, no requirement counts (officers optional)"). */}
          {officerApplies && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${officer?.requirement === "required" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}
            >
              {officer?.requirement ?? "recommended"}
            </span>
          )}
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {assignments.length === 0
              ? "not yet assigned"
              : `${assignments.length} assigned`}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2">
            {assignments.length === 0 && (
              <li className="text-sm text-muted-foreground">No one assigned yet.</li>
            )}
            {assignments.map((a) => (
              <li
                key={a.membershipId}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{memberName(a.membershipId)}</span>
                  <span
                    className={`text-xs ${a.consent === "accepted" ? "text-[color:var(--color-success)]" : a.consent === "pending" ? "text-accent" : "text-muted-foreground"}`}
                  >
                    {CONSENT_LABEL[a.consent]}
                    {a.orgVisible && canViewDetails
                      ? " · contact shared with AfrikaBurn"
                      : ""}
                  </span>
                </span>
                {canAssign && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => unassign(a.membershipId)}
                    disabled={isPending}
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
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Assign a member…</option>
                {members.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={assign} disabled={isPending || !pick}>
                <Plus className="h-4 w-4" aria-hidden />
                Assign
              </Button>
            </div>
          )}

          <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
            {officerConsentCopy(role.name)}
          </p>

          <PermissionEditor
            role={role}
            roles={roles}
            disabled={!canManageRoles}
            slug={slug}
            setRolePermissionsAction={setRolePermissionsAction}
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

// --- Create custom role ----------------------------------------------------

function CreateRoleCard({
  slug,
  createRoleAction,
}: {
  slug: string;
  createRoleAction: CreateRoleAction;
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await createRoleAction({ slug, name: trimmed });
      if (res.ok) {
        toast.success("Role added");
        setName("");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-3">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="New role, e.g. Kitchen crew"
        maxLength={60}
        className="h-9"
      />
      <Button onClick={add} disabled={isPending || !name.trim()}>
        <Plus className="h-4 w-4" aria-hidden />
        Add role
      </Button>
    </div>
  );
}
