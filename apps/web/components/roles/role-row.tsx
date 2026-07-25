"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, Users } from "lucide-react";
import type { RoleColor } from "@quagga/types";
import {
  canDeleteRoleKind,
  canRenameRoleKind,
  isBaselineKind,
  isPermissionsLockedKind,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@quagga/ui/components/accordion";
import { RoleBadge } from "@quagga/ui/components/role-badge";
import { toast } from "@quagga/ui/components/toast";
import { AppearancePicker } from "./appearance";
import { PrivilegeEditor, privilegeSummary } from "./privileges";
import { KIND_TAG } from "./types";
import type {
  RemoveRoleAction,
  RenameRoleAction,
  RoleVM,
  SetRoleAppearanceAction,
  SetRolePermissionsAction,
} from "./types";

// A core / custom role row (canvas ZyKzw "Row Captain", "Role Team lead",
// "Row Burner", "Row Kitchen wizard"). What is editable is decided by the
// @quagga/core kind predicates — never by role name — and every write is
// re-checked server-side by the actions (`manage_roles`).

/** The collapsed row's one-line summary (canvas "Summary"). */
function summaryFor(role: RoleVM): string {
  if (isPermissionsLockedKind(role.kind)) return "All privileges · locked on";
  const privileges = privilegeSummary(role.permissions);
  if (isBaselineKind(role.kind)) {
    return `${privileges} · rename to alias your people`;
  }
  return `${privileges} · ${role.memberCount} member${role.memberCount === 1 ? "" : "s"}`;
}

export function RoleRow({
  slug,
  role,
  roles,
  canManageRoles,
  renameRoleAction,
  removeRoleAction,
  setRoleAppearanceAction,
  setRolePermissionsAction,
}: {
  slug: string;
  role: RoleVM;
  roles: RoleVM[];
  canManageRoles: boolean;
  renameRoleAction: RenameRoleAction;
  removeRoleAction: RemoveRoleAction;
  setRoleAppearanceAction: SetRoleAppearanceAction;
  setRolePermissionsAction: SetRolePermissionsAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(role.name);
  const [emoji, setEmoji] = React.useState(role.emoji ?? "");
  const [color, setColor] = React.useState<RoleColor>(role.color);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const canRename = canManageRoles && canRenameRoleKind(role.kind);
  const canDelete = canManageRoles && canDeleteRoleKind(role.kind);
  const baseline = isBaselineKind(role.kind);

  const nameDirty = name.trim() !== role.name && name.trim().length > 0;
  const appearanceDirty =
    emoji.trim() !== (role.emoji ?? "") || color !== role.color;
  const dirty = (canRename && nameDirty) || (canManageRoles && appearanceDirty);

  function save() {
    startTransition(async () => {
      if (canRename && nameDirty) {
        const res = await renameRoleAction({
          slug,
          roleId: role.id,
          name: name.trim(),
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
      }
      if (appearanceDirty) {
        const res = await setRoleAppearanceAction({
          slug,
          roleId: role.id,
          color,
          emoji: emoji.trim() || null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
      }
      toast.success("Role saved");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await removeRoleAction({ slug, roleId: role.id });
      if (res.ok) {
        toast.success("Role deleted");
        setConfirmDelete(false);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <AccordionItem value={role.id}>
      <AccordionTrigger>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <RoleBadge name={role.name} color={role.color} emoji={role.emoji} />
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {KIND_TAG[role.kind]}
          </span>
          <span className="hidden min-w-0 truncate text-xs font-normal text-muted-foreground sm:inline">
            {summaryFor(role)}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <div className="flex flex-col gap-5">
          <p className="text-xs text-muted-foreground sm:hidden">
            {summaryFor(role)}
          </p>

          {canRename && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`${role.id}-name`}
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Name
              </label>
              <Input
                id={`${role.id}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                className="h-10 max-w-xs"
              />
              {baseline && (
                <p className="text-xs text-muted-foreground">
                  Every member of the camp holds this role — rename it to
                  whatever your camp calls its people.
                </p>
              )}
            </div>
          )}

          <AppearancePicker
            emoji={emoji}
            color={color}
            disabled={!canManageRoles}
            onEmojiChange={setEmoji}
            onColorChange={setColor}
            idPrefix={role.id}
          />

          {dirty && (
            <Button
              size="sm"
              className="self-start"
              onClick={save}
              disabled={isPending}
            >
              <Check className="h-4 w-4" aria-hidden />
              Save changes
            </Button>
          )}

          <div className="border-t border-border pt-4">
            <PrivilegeEditor
              slug={slug}
              role={role}
              roles={roles}
              canManageRoles={canManageRoles}
              setRolePermissionsAction={setRolePermissionsAction}
            />
          </div>

          {canDelete && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              {confirmDelete ? (
                <div className="flex flex-col gap-2">
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {role.memberCount} member
                    {role.memberCount === 1 ? " holds" : "s hold"} this role —
                    deleting removes it from them. They stay in the camp.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={remove}
                      disabled={isPending}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      Delete {role.name}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete(false)}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(true)}
                  disabled={isPending}
                  className="self-start text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Delete role
                </Button>
              )}
            </div>
          )}

          {!canDelete && !baseline && (
            <p className="text-xs text-muted-foreground">
              Seeded roles can&apos;t be deleted — rename and recolour them
              instead.
            </p>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
