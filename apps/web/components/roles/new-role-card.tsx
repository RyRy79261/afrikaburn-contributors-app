"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { ProjectPermissions, RoleColor } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import { toast } from "@quagga/ui/components/toast";
import { AppearancePicker } from "./appearance";
import { PrivilegeToggles } from "./privileges";
import type { CreateRoleWithSetupAction, RoleVM } from "./types";

// "New role" card (canvas ZyKzw "New Role Card"): name → icon + colour →
// privileges → create. One server round-trip: `createRoleWithSetupAction`
// re-checks `manage_roles` server-side and stores the appearance + privileges
// with the new custom role.

export function NewRoleCard({
  slug,
  roles,
  createRoleWithSetupAction,
}: {
  slug: string;
  roles: RoleVM[];
  createRoleWithSetupAction: CreateRoleWithSetupAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [emoji, setEmoji] = React.useState("");
  const [color, setColor] = React.useState<RoleColor>("teal");
  const [permissions, setPermissions] = React.useState<ProjectPermissions>({});

  function reset() {
    setName("");
    setEmoji("");
    setColor("teal");
    setPermissions({});
  }

  function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await createRoleWithSetupAction({
        slug,
        name: trimmed,
        color,
        emoji: emoji.trim() || null,
        permissions,
      });
      if (res.ok) {
        toast.success("Role created");
        reset();
        setOpen(false);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        className="self-start border-dashed"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4" aria-hidden />
        New role
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-dashed border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <Plus className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold">New role</h3>
          <p className="max-w-prose text-xs text-muted-foreground">
            Name it, pick an icon and colour, then choose what it can do. Set
            and forget.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="new-role-name"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Name
        </label>
        <Input
          id="new-role-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
          }}
          placeholder="e.g. Bar lead"
          maxLength={60}
          className="h-10"
        />
      </div>

      <AppearancePicker
        emoji={emoji}
        color={color}
        onEmojiChange={setEmoji}
        onColorChange={setColor}
        idPrefix="new-role"
      />

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Privileges
        </span>
        <PrivilegeToggles
          value={permissions}
          onChange={setPermissions}
          roles={roles}
          idPrefix="new-role"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={create} disabled={isPending || !name.trim()}>
          <Plus className="h-4 w-4" aria-hidden />
          Create role
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
