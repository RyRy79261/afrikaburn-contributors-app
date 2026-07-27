"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { Input } from "@quagga/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";
import { toast } from "@quagga/ui/components/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import { CATEGORY_LABEL_MAX, CATEGORY_SUGGESTED_MAX } from "@quagga/types";
import type { CampCategoryRow } from "@/lib/queries";
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "@/lib/actions/categories";

// The org CRUD surface for the per-edition camp-category taxonomy (build-spec
// §"Camp categories", canvas frame g4CzsM / X8RHa). The table shows emoji,
// label, real usage counts (from `getCampCategories`) and the sort position;
// create/edit/delete and reordering all go through the audited server actions in
// lib/actions/categories.ts — validation (shape + per-edition dedupe) is
// enforced there via @quagga/core, never here.
//
// `canManage` comes from the ONE capability matrix on the server
// (`manage_camp_categories`, System manager only — Ryan, 27 Jul 2026), which is
// the same check `createCategory`/`updateCategory`/`deleteCategory` re-run. So
// when it is false every control is gone AND every action would refuse: the
// read-only table is a truthful picture of the permission, not a decoration over
// buttons that would have worked.

interface FormState {
  label: string;
  emoji: string;
  sort: string;
}

const EMPTY_FORM: FormState = { label: "", emoji: "", sort: "" };

/** Trim the emoji to null when blank — the Zod input rejects an empty string. */
function emojiValue(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Parse the sort field; blank/invalid means "leave it to the server". */
function sortValue(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function CategoriesManager({
  editionId,
  categories,
  canManage,
}: {
  editionId: string;
  categories: CampCategoryRow[];
  /** From `orgCan(actor, "manage_camp_categories")` — System manager only. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<CampCategoryRow | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<CampCategoryRow | null>(null);

  function submitCreate() {
    startTransition(async () => {
      const result = await createCategory({
        editionId,
        label: addForm.label,
        emoji: emojiValue(addForm.emoji),
        sort: sortValue(addForm.sort),
      });
      if (result.ok) {
        toast.success("Category added.");
        setAddForm(EMPTY_FORM);
        setAdding(false);
        router.refresh();
      } else {
        toast.error("Could not add category", { description: result.error });
      }
    });
  }

  function submitEdit() {
    const target = editing;
    if (!target) return;
    startTransition(async () => {
      const result = await updateCategory({
        categoryId: target.id,
        label: editForm.label,
        emoji: emojiValue(editForm.emoji),
        sort: sortValue(editForm.sort),
      });
      if (result.ok) {
        toast.success("Category updated.");
        setEditing(null);
        router.refresh();
      } else {
        toast.error("Could not update category", { description: result.error });
      }
    });
  }

  function submitDelete() {
    const target = deleting;
    if (!target) return;
    startTransition(async () => {
      const result = await deleteCategory({ categoryId: target.id });
      if (result.ok) {
        toast.success(`"${target.label}" removed.`);
        setDeleting(null);
        router.refresh();
      } else {
        toast.error("Could not remove category", { description: result.error });
      }
    });
  }

  /** Swap two neighbours' sort values (the reorder affordance). */
  function move(index: number, direction: -1 | 1) {
    const current = categories[index];
    const neighbour = categories[index + direction];
    if (!current || !neighbour) return;
    // Equal stored sorts would make a swap a no-op — fall back to positions.
    const [nextCurrent, nextNeighbour] =
      current.sort === neighbour.sort
        ? [index + direction, index]
        : [neighbour.sort, current.sort];

    startTransition(async () => {
      const first = await updateCategory({
        categoryId: current.id,
        label: current.label,
        emoji: current.emoji,
        sort: nextCurrent,
      });
      if (!first.ok) {
        toast.error("Could not reorder", { description: first.error });
        return;
      }
      const second = await updateCategory({
        categoryId: neighbour.id,
        label: neighbour.label,
        emoji: neighbour.emoji,
        sort: nextNeighbour,
      });
      if (!second.ok) {
        toast.error("Could not reorder", { description: second.error });
        return;
      }
      router.refresh();
    });
  }

  function openEdit(row: CampCategoryRow) {
    setEditing(row);
    setEditForm({
      label: row.label,
      emoji: row.emoji ?? "",
      sort: String(row.sort),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead>
            <TableHead className="w-28">Used by</TableHead>
            <TableHead className="w-20">Sort</TableHead>
            <TableHead className="w-32 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                No categories yet. Add the first one below.
              </TableCell>
            </TableRow>
          ) : (
            categories.map((row, index) => (
              <TableRow key={row.id}>
                <TableCell>
                  <span className="flex items-center gap-3">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-base"
                      aria-hidden
                    >
                      {row.emoji ?? "·"}
                    </span>
                    <span className="font-medium">{row.label}</span>
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground tabular-nums">
                  {row.usage} camp{row.usage === 1 ? "" : "s"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground tabular-nums">
                  {row.sort}
                </TableCell>
                <TableCell>
                  <span className="flex items-center justify-end gap-1">
                    {canManage && (
                      <>
                        <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending || index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Move ${row.label} up`}
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending || index === categories.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Move ${row.label} down`}
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => openEdit(row)}
                      aria-label={`Edit ${row.label}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => setDeleting(row)}
                      aria-label={`Delete ${row.label}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
        </CardContent>
      </Card>

      {/* Add category — a collapsed row that opens into the form. Absent for a
          rank that cannot manage the taxonomy; the same rank's write would be
          refused server-side, so this is agreement, not concealment. */}
      {canManage && (
      <div className="rounded-xl border border-dashed border-border p-4">
        {adding ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <CategoryField
                label="Name"
                className="flex-1"
                value={addForm.label}
                onChange={(v) => setAddForm((f) => ({ ...f, label: v }))}
                placeholder="e.g. Late night"
                maxLength={CATEGORY_LABEL_MAX}
              />
              <CategoryField
                label="Emoji"
                className="sm:w-24"
                value={addForm.emoji}
                onChange={(v) => setAddForm((f) => ({ ...f, emoji: v }))}
                placeholder="🌙"
                maxLength={16}
              />
              <CategoryField
                label="Sort"
                className="sm:w-24"
                value={addForm.sort}
                onChange={(v) => setAddForm((f) => ({ ...f, sort: v }))}
                placeholder="end"
                inputMode="numeric"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setAddForm(EMPTY_FORM);
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={pending || addForm.label.trim().length === 0}
                onClick={submitCreate}
              >
                {pending ? "Adding…" : "Add category"}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-3 text-left"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border">
              <Plus className="h-4 w-4 text-accent" aria-hidden />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-medium">Add category</span>
              <span className="text-xs text-muted-foreground">
                Name, an optional emoji, and where it sorts.
              </span>
            </span>
          </button>
        )}
      </div>
      )}

      <p className="text-xs text-muted-foreground">
        Camps choose up to {CATEGORY_SUGGESTED_MAX} categories on their profile;
        the order here sets how chips appear in the directory.
      </p>

      {/* Edit */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit category</DialogTitle>
            <DialogDescription>
              Renaming is safe — camps keep their picks. Names must be unique
              for this edition.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row">
            <CategoryField
              label="Name"
              className="flex-1"
              value={editForm.label}
              onChange={(v) => setEditForm((f) => ({ ...f, label: v }))}
              maxLength={CATEGORY_LABEL_MAX}
            />
            <CategoryField
              label="Emoji"
              className="sm:w-24"
              value={editForm.emoji}
              onChange={(v) => setEditForm((f) => ({ ...f, emoji: v }))}
              maxLength={16}
            />
            <CategoryField
              label="Sort"
              className="sm:w-24"
              value={editForm.sort}
              onChange={(v) => setEditForm((f) => ({ ...f, sort: v }))}
              inputMode="numeric"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending || editForm.label.trim().length === 0}
              onClick={submitEdit}
            >
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove &ldquo;{deleting?.label}&rdquo;?</DialogTitle>
            <DialogDescription>
              {deleting && deleting.usage > 0
                ? `${deleting.usage} camp${deleting.usage === 1 ? "" : "s"} currently use this category. Removing it drops their pick and the directory chip — it cannot be undone.`
                : "Nothing uses this category yet. Removing it cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={submitDelete}
            >
              {pending ? "Removing…" : "Remove category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryField({
  label,
  value,
  onChange,
  className,
  placeholder,
  maxLength,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  inputMode?: "numeric";
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm ${className ?? ""}`}>
      <span className="font-medium">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
      />
    </label>
  );
}
