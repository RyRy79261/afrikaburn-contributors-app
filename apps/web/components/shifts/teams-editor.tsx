"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quagga/ui/components/dialog";
import { Input } from "@quagga/ui/components/input";
import { toast } from "@quagga/ui/components/toast";
import {
  addShiftTeamAction,
  removeShiftTeamAction,
  renameShiftTeamAction,
} from "@/app/(app)/camps/[slug]/shifts/actions";

// "Edit teams" (canvas S2): the camp's team list starts as a starter list and
// the lead adds, renames and removes from there (Ryan, 28 Sep 2026, #57).
// Removing a team keeps its shifts — they just show no team.

export interface TeamItem {
  id: string;
  name: string;
}

export function TeamsEditor({
  slug,
  teams,
  onChange,
}: {
  slug: string;
  teams: TeamItem[];
  /** Tell the form the list changed (e.g. to select a newly added team). */
  onChange?: (teams: TeamItem[], addedId?: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [list, setList] = React.useState(teams);
  const [newName, setNewName] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => setList(teams), [teams]);

  function commit(next: TeamItem[], addedId?: string) {
    setList(next);
    onChange?.(next, addedId);
    router.refresh();
  }

  function add() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await addShiftTeamAction({ slug, name });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setNewName("");
      commit([...list, { id: result.id, name }], result.id);
    });
  }

  function rename(id: string) {
    const name = editName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await renameShiftTeamAction({ slug, teamId: id, name });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditing(null);
      commit(list.map((t) => (t.id === id ? { ...t, name } : t)));
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await removeShiftTeamAction({ slug, teamId: id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      commit(list.filter((t) => t.id !== id));
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Pencil className="h-4 w-4" aria-hidden />
          Edit teams
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Teams</DialogTitle>
          <DialogDescription>
            Add, rename or remove your camp&apos;s teams. Removing a team keeps
            its shifts — they just show no team.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y divide-border">
          {list.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">
              No teams yet — add one below.
            </li>
          )}
          {list.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-2">
              {editing === t.id ? (
                <>
                  <Input
                    aria-label={`New name for ${t.name}`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={40}
                    className="h-9"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        rename(t.id);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => rename(t.id)}
                    disabled={pending}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {t.name}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Rename ${t.name}`}
                    onClick={() => {
                      setEditing(t.id);
                      setEditName(t.name);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${t.name}`}
                    onClick={() => remove(t.id)}
                    disabled={pending}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Input
            aria-label="New team name"
            placeholder="New team, e.g. Bar crew"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={40}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button
            type="button"
            onClick={add}
            disabled={pending || !newName.trim()}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
