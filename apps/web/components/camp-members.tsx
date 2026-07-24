"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Settings2, Plus, Pencil, Trash2, Tags, Check } from "lucide-react";
import type { MembershipRole } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
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
import { toast } from "@quagga/ui/components/toast";
import { MemberRefCode } from "./member-ref-code";
import type {
  createRoleAction,
  removeRoleAction,
  renameRoleAction,
  setMemberRolesAction,
} from "@/app/camps/[slug]/actions";

// Aliased at module scope so inner components can annotate props with the
// action types without the destructured parameter shadowing the import.
type CreateRoleAction = typeof createRoleAction;
type RenameRoleAction = typeof renameRoleAction;
type RemoveRoleAction = typeof removeRoleAction;
type SetMemberRolesAction = typeof setMemberRolesAction;

export interface CampRole {
  id: string;
  name: string;
  isDefault: boolean;
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
  canManage: boolean;
  showRefCodes: boolean;
  roles: CampRole[];
  members: CampMemberVM[];
  createRoleAction: CreateRoleAction;
  renameRoleAction: RenameRoleAction;
  removeRoleAction: RemoveRoleAction;
  setMemberRolesAction: SetMemberRolesAction;
}

const ROLE_LABEL: Record<MembershipRole, string> = {
  god: "God",
  org_staff: "Org staff",
  lead: "Lead",
  admin: "Co-lead",
  member: "Member",
};

export function CampMembers(props: CampMembersProps) {
  const router = useRouter();
  const [roles, setRoles] = React.useState<CampRole[]>(props.roles);
  const [members, setMembers] = React.useState<CampMemberVM[]>(props.members);
  const [manageOpen, setManageOpen] = React.useState(false);
  const [assignFor, setAssignFor] = React.useState<CampMemberVM | null>(null);

  const roleName = React.useCallback(
    (id: string) => roles.find((r) => r.id === id)?.name,
    [roles],
  );

  return (
    <div className="flex flex-col gap-4">
      {props.canManage && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setManageOpen(true)}
          >
            <Settings2 className="h-4 w-4" aria-hidden />
            Manage roles
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
                  .map((id) => ({ id, name: roleName(id) }))
                  .filter((r): r is { id: string; name: string } => Boolean(r.name))
                  .map((r) => (
                    <Badge key={r.id} variant="secondary" className="normal-case">
                      {r.name}
                    </Badge>
                  ))
              ) : (
                <span className="text-xs text-muted-foreground">No roles yet</span>
              )}
              {props.canManage && (
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

      {props.canManage && (
        <ManageRolesDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          slug={props.slug}
          roles={roles}
          setRoles={setRoles}
          setMembers={setMembers}
          createRoleAction={props.createRoleAction}
          renameRoleAction={props.renameRoleAction}
          removeRoleAction={props.removeRoleAction}
          refresh={() => router.refresh()}
        />
      )}

      {props.canManage && assignFor && (
        <AssignRolesDialog
          key={assignFor.membershipId}
          member={assignFor}
          roles={roles}
          slug={props.slug}
          onClose={() => setAssignFor(null)}
          onSaved={(roleIds) => {
            setMembers((prev) =>
              prev.map((m) =>
                m.membershipId === assignFor.membershipId
                  ? { ...m, roleIds }
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

function ManageRolesDialog({
  open,
  onOpenChange,
  slug,
  roles,
  setRoles,
  setMembers,
  createRoleAction,
  renameRoleAction,
  removeRoleAction,
  refresh,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slug: string;
  roles: CampRole[];
  setRoles: React.Dispatch<React.SetStateAction<CampRole[]>>;
  setMembers: React.Dispatch<React.SetStateAction<CampMemberVM[]>>;
  createRoleAction: CreateRoleAction;
  renameRoleAction: RenameRoleAction;
  removeRoleAction: RemoveRoleAction;
  refresh: () => void;
}) {
  const [newName, setNewName] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  function add() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createRoleAction({ slug, name });
      if (result.ok) {
        toast.success("Role added");
        setNewName("");
        refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function saveRename(roleId: string) {
    const name = editingName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await renameRoleAction({ slug, roleId, name });
      if (result.ok) {
        setRoles((prev) =>
          prev.map((r) => (r.id === roleId ? { ...r, name } : r)),
        );
        setEditingId(null);
        toast.success("Role renamed");
        refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function remove(roleId: string) {
    startTransition(async () => {
      const result = await removeRoleAction({ slug, roleId });
      if (result.ok) {
        setRoles((prev) => prev.filter((r) => r.id !== roleId));
        setMembers((prev) =>
          prev.map((m) => ({
            ...m,
            roleIds: m.roleIds.filter((id) => id !== roleId),
          })),
        );
        toast.success("Role removed");
        refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Custom roles</DialogTitle>
          <DialogDescription>
            Labels for organising your camp and targeting questionnaires. They
            don&apos;t change anyone&apos;s permissions.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {roles.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                {editingId === r.id ? (
                  <>
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-8"
                      maxLength={60}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={() => saveRename(r.id)}
                      disabled={isPending}
                    >
                      <Check className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {r.name}
                      {r.isDefault && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          default
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      aria-label={`Rename ${r.name}`}
                      onClick={() => {
                        setEditingId(r.id);
                        setEditingName(r.name);
                      }}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${r.name}`}
                      onClick={() => remove(r.id)}
                      disabled={isPending}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </li>
            ))}
            {roles.length === 0 && (
              <li className="text-sm text-muted-foreground">
                No roles yet — add one below.
              </li>
            )}
          </ul>

          <div className="flex items-center gap-2 border-t border-border pt-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
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
            <Button onClick={add} disabled={isPending || !newName.trim()}>
              <Plus className="h-4 w-4" aria-hidden />
              Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
  const [selected, setSelected] = React.useState<string[]>(member.roleIds);
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
            A member can hold several roles. Pick any that apply.
          </DialogDescription>
        </DialogHeader>

        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No roles exist yet. Add some from &ldquo;Manage roles&rdquo; first.
          </p>
        ) : (
          <ToggleGroup
            type="multiple"
            variant="outline"
            value={selected}
            onValueChange={setSelected}
            className="justify-start"
          >
            {roles.map((r) => (
              <ToggleGroupItem key={r.id} value={r.id}>
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
