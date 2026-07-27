"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Info } from "lucide-react";
import type { ProjectPermissions } from "@quagga/types";
import { isPermissionsLockedKind } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Switch } from "@quagga/ui/components/switch";
import { toast } from "@quagga/ui/components/toast";
import type { RoleVM, SetRolePermissionsAction } from "./types";

// The privilege block of a role editor (canvas ZyKzw "Priv Box"): one labelled
// switch per privilege from questionnaire-spec §"Roles v2" privileges table,
// with `manage_questionnaires` expanding into its sub-scopes (audience_roles +
// may_block). UI-only — every write goes through `setRolePermissionsAction`,
// which re-checks `manage_roles` server-side and runs `enforceKindPermissions`
// (so a captain row can never drift below full rights, whatever the UI sends).

/** One-line privilege summary for a collapsed row. */
export function privilegeSummary(p: ProjectPermissions): string {
  const parts: string[] = [];
  if (p.view_member_details) parts.push("Sees member details");
  if (p.manage_questionnaires) {
    const scope = p.manage_questionnaires.audienceRoles;
    parts.push(
      scope === "all"
        ? "Can send questionnaires"
        : `Can send questionnaires (${scope.length} audience${scope.length === 1 ? "" : "s"})`,
    );
  }
  if (p.manage_roles) parts.push("Manages roles");
  else if (p.assign_roles) parts.push("Assigns roles");
  if (p.manage_members) parts.push("Manages invites");
  return parts.length ? parts.join(" · ") : "No extra privileges";
}

/** A labelled switch row with optional helper copy under the label. */
function PrivilegeRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
  children,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm">{label}</span>
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
          aria-label={label}
          className="mt-0.5"
        />
      </div>
      {hint && (
        <p className="max-w-prose text-xs text-muted-foreground">{hint}</p>
      )}
      {children}
    </div>
  );
}

/**
 * Controlled privilege toggles. Used both by an existing role's editor and by
 * the "New role" card (where there is no role id yet).
 */
export function PrivilegeToggles({
  value,
  onChange,
  disabled,
  roles,
  idPrefix,
}: {
  value: ProjectPermissions;
  onChange: (next: ProjectPermissions) => void;
  disabled?: boolean;
  /** Every role in the camp — the audience candidates for questionnaires. */
  roles: RoleVM[];
  idPrefix: string;
}) {
  const mq = value.manage_questionnaires;
  const scopeAll = mq?.audienceRoles === "all";
  const scopeIds = mq && mq.audienceRoles !== "all" ? mq.audienceRoles : [];
  // Officers are org-facing registrations, not questionnaire audiences here;
  // the baseline role IS the "everyone in this camp" audience (one concept).
  const audienceRoles = roles.filter((r) => r.kind !== "officer");
  const baseline = roles.find((r) => r.kind === "baseline");

  function toggleQuestionnaires(on: boolean) {
    if (on) {
      onChange({
        ...value,
        manage_questionnaires: {
          audienceRoles: baseline ? [baseline.id] : "all",
          mayBlock: false,
        },
      });
      return;
    }
    const { manage_questionnaires: _dropped, ...rest } = value;
    void _dropped;
    onChange(rest);
  }

  function setScopeAll() {
    if (!mq) return;
    onChange({
      ...value,
      manage_questionnaires: { ...mq, audienceRoles: "all" },
    });
  }

  function toggleScopeRole(roleId: string) {
    if (!mq) return;
    const current = mq.audienceRoles === "all" ? [] : mq.audienceRoles;
    const next = current.includes(roleId)
      ? current.filter((id) => id !== roleId)
      : [...current, roleId];
    onChange({
      ...value,
      manage_questionnaires: { ...mq, audienceRoles: next },
    });
  }

  const chip =
    "rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50";
  const chipOn = "border-primary bg-primary/15 text-foreground";
  const chipOff = "border-border text-muted-foreground hover:bg-muted/50";

  return (
    <div className="flex flex-col divide-y divide-border/60">
      <PrivilegeRow
        label="Can see private member info"
        hint="Ref codes, emails, join dates — never overrides a burner's own privacy flags."
        checked={!!value.view_member_details}
        disabled={disabled}
        onChange={(v) =>
          onChange({ ...value, view_member_details: v || undefined })
        }
      />

      <PrivilegeRow
        label="Can send questionnaires"
        checked={!!mq}
        disabled={disabled}
        onChange={toggleQuestionnaires}
      >
        {mq && (
          <div className="mt-1 flex flex-col gap-2 rounded-md bg-muted/40 p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Who they can send to
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={disabled}
                onClick={setScopeAll}
                className={`${chip} ${scopeAll ? chipOn : chipOff}`}
                aria-pressed={scopeAll}
              >
                Any audience
              </button>
              {audienceRoles.map((r) => {
                const on = !scopeAll && scopeIds.includes(r.id);
                return (
                  <button
                    key={`${idPrefix}-aud-${r.id}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleScopeRole(r.id)}
                    className={`${chip} ${on ? chipOn : chipOff}`}
                    aria-pressed={on}
                  >
                    {r.emoji ? `${r.emoji} ` : ""}
                    {r.name}
                  </button>
                );
              })}
            </div>
            {baseline && (
              <p className="text-xs text-muted-foreground">
                {baseline.name} is the baseline — selecting it means the whole
                camp.
              </p>
            )}
            <PrivilegeRow
              label="May send blocking questionnaires"
              hint="Blocking stops people using the app until they answer — leads only, usually."
              checked={!!mq.mayBlock}
              disabled={disabled}
              onChange={(v) =>
                onChange({
                  ...value,
                  manage_questionnaires: { ...mq, mayBlock: v },
                })
              }
            />
          </div>
        )}
      </PrivilegeRow>

      <PrivilegeRow
        label="Can assign roles to members"
        hint={
          value.manage_roles
            ? "Included with managing role definitions."
            : undefined
        }
        checked={!!value.assign_roles || !!value.manage_roles}
        disabled={disabled || !!value.manage_roles}
        onChange={(v) => onChange({ ...value, assign_roles: v || undefined })}
      />

      <PrivilegeRow
        label="Can manage role definitions"
        hint="Create, edit, delete roles — implies assigning."
        checked={!!value.manage_roles}
        disabled={disabled}
        onChange={(v) => onChange({ ...value, manage_roles: v || undefined })}
      />

      <PrivilegeRow
        label="Can manage invites"
        hint="Create and revoke this camp's invites."
        checked={!!value.manage_members}
        disabled={disabled}
        onChange={(v) => onChange({ ...value, manage_members: v || undefined })}
      />
    </div>
  );
}

/** The privilege block for an existing role, with its own save button. */
export function PrivilegeEditor({
  slug,
  role,
  roles,
  canManageRoles,
  setRolePermissionsAction,
}: {
  slug: string;
  role: RoleVM;
  roles: RoleVM[];
  canManageRoles: boolean;
  setRolePermissionsAction: SetRolePermissionsAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [perms, setPerms] = React.useState<ProjectPermissions>(
    role.permissions,
  );
  // Captain privileges are locked to all — the kind predicate decides, never a
  // hardcoded role name (questionnaire-spec §"Role kinds").
  const locked = isPermissionsLockedKind(role.kind);
  const disabled = !canManageRoles || locked;
  const dirty = JSON.stringify(perms) !== JSON.stringify(role.permissions);

  React.useEffect(() => {
    setPerms(role.permissions);
  }, [role.permissions]);

  function save() {
    startTransition(async () => {
      const res = await setRolePermissionsAction({
        slug,
        roleId: role.id,
        permissions: perms,
      });
      if (res.ok) {
        toast.success("Privileges saved");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Privileges
      </span>
      {locked && (
        <p className="flex items-start gap-2 rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Captains can do everything — that&apos;s what makes them captains.
          Their privileges are locked on.
        </p>
      )}
      <PrivilegeToggles
        value={perms}
        onChange={setPerms}
        disabled={disabled}
        roles={roles}
        idPrefix={role.id}
      />
      {!disabled && dirty && (
        <Button
          size="sm"
          className="self-start"
          onClick={save}
          disabled={isPending}
        >
          <Check className="h-4 w-4" aria-hidden />
          Save privileges
        </Button>
      )}
    </div>
  );
}
