"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, CircleCheck, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { DUES_CATEGORY_KEY, formatRand } from "@quagga/core";
import {
  MONEY_CONTINGENCY_MAX_PCT,
  type BudgetCategoryKind,
  type BudgetEntryStatus,
} from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quagga/ui/components/dialog";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import {
  addBudgetCategoryAction,
  addBudgetEntryAction,
  approveBudgetAction,
  deleteBudgetEntryAction,
  removeBudgetCategoryAction,
  renameBudgetCategoryAction,
  reopenBudgetAction,
  setBudgetPlanAction,
  updateBudgetEntryAction,
} from "@/app/(app)/camps/[slug]/money/actions";
import { todayInSouthAfrica } from "@/lib/money-view";
import {
  AmountInput,
  centsToField,
  fieldToCents,
  useMoneyAction,
} from "./form-bits";
import { ReceiptPicker, uploadReceipt } from "./receipt-input";

// The budget tab's forms (frame M1): approve the budget, edit the plan (and
// the categories), add / correct / delete an entry. Every write goes through
// a server action that re-checks everything; these only collect input.

export interface PlanCategory {
  id: string;
  name: string;
  kind: BudgetCategoryKind;
  plannedCents: number;
  systemKey: string | null;
  archived: boolean;
}

// --- Approve -------------------------------------------------------------------

export function ApproveBudgetButton({ slug }: { slug: string }) {
  const { pending, error, run } = useMoneyAction();
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        className="w-full sm:w-fit"
        disabled={pending}
        onClick={() =>
          run(() => approveBudgetAction({ slug }), {
            success: "The budget is approved.",
          })
        }
      >
        <CircleCheck className="h-4 w-4" aria-hidden />
        Approve budget
      </Button>
      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Back to draft" on an approved budget, with a confirm step. Clears who
 * approved it and when; the approval stays in the audit record. */
export function BudgetBackToDraftButton({ slug }: { slug: string }) {
  const [open, setOpen] = React.useState(false);
  const { pending, error, setError, run } = useMoneyAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setError(null);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full sm:w-fit">
          <Undo2 className="h-4 w-4" aria-hidden />
          Back to draft
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move the budget back to draft?</DialogTitle>
          <DialogDescription>
            It is no longer approved until a money person approves it again. The
            earlier approval stays in the record.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => reopenBudgetAction({ slug }), {
                success: "The budget is back to draft.",
                onDone: () => setOpen(false),
              })
            }
          >
            <Undo2 className="h-4 w-4" aria-hidden />
            Back to draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Edit the plan ------------------------------------------------------------------

interface PlanRow {
  id: string;
  name: string;
  originalName: string;
  kind: BudgetCategoryKind;
  planned: string;
  originalCents: number;
  isDues: boolean;
}

function toRows(categories: readonly PlanCategory[]): PlanRow[] {
  return categories
    .filter((c) => !c.archived)
    .map((c) => ({
      id: c.id,
      name: c.name,
      originalName: c.name,
      kind: c.kind,
      planned: centsToField(c.plannedCents),
      originalCents: c.plannedCents,
      isDues: c.systemKey === DUES_CATEGORY_KEY,
    }));
}

export function EditPlanDialog({
  slug,
  contingencyPct,
  categories,
}: {
  slug: string;
  contingencyPct: number;
  categories: readonly PlanCategory[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<PlanRow[]>(() => toRows(categories));
  const [contingency, setContingency] = React.useState(String(contingencyPct));
  const [newKind, setNewKind] = React.useState<BudgetCategoryKind>("expense");
  const [newName, setNewName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function reset() {
    setRows(toRows(categories));
    setContingency(String(contingencyPct));
    setNewName("");
    setNewKind("expense");
    setError(null);
  }

  function update(id: string, patch: Partial<PlanRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addCategory() {
    setError(null);
    startTransition(async () => {
      const result = await addBudgetCategoryAction({
        slug,
        kind: newKind,
        name: newName,
        plannedCents: 0,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows((rs) => [
        ...rs,
        {
          id: result.id,
          name: newName.trim(),
          originalName: newName.trim(),
          kind: newKind,
          planned: centsToField(0),
          originalCents: 0,
          isDues: false,
        },
      ]);
      setNewName("");
      router.refresh();
    });
  }

  function removeCategory(row: PlanRow) {
    setError(null);
    startTransition(async () => {
      const result = await removeBudgetCategoryAction({
        slug,
        categoryId: row.id,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      toast.success(
        result.action === "archive"
          ? `${row.originalName} is archived: its entries and claims stay in the books.`
          : `${row.originalName} is removed.`,
      );
      router.refresh();
    });
  }

  function save() {
    setError(null);
    const pct = Number(contingency);
    if (!Number.isInteger(pct) || pct < 0 || pct > MONEY_CONTINGENCY_MAX_PCT) {
      setError(
        `The contingency is a whole percent from 0 to ${MONEY_CONTINGENCY_MAX_PCT}.`,
      );
      return;
    }
    const lines: { categoryId: string; plannedCents: number }[] = [];
    for (const r of rows) {
      const cents = r.planned.trim() === "" ? 0 : fieldToCents(r.planned);
      if (cents === null) {
        setError(`Check the planned amount for ${r.name || "a category"}.`);
        return;
      }
      lines.push({ categoryId: r.id, plannedCents: cents });
    }
    startTransition(async () => {
      for (const r of rows) {
        if (r.name.trim() !== r.originalName) {
          const renamed = await renameBudgetCategoryAction({
            slug,
            categoryId: r.id,
            name: r.name,
          });
          if (!renamed.ok) {
            setError(renamed.error);
            return;
          }
          update(r.id, { originalName: r.name.trim() });
        }
      }
      const result = await setBudgetPlanAction({
        slug,
        contingencyPct: pct,
        lines,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("The plan is saved.");
      setOpen(false);
      router.refresh();
    });
  }

  const spending = rows.filter((r) => r.kind === "expense");
  const income = rows.filter((r) => r.kind === "income");
  const renderRows = (list: PlanRow[]) =>
    list.map((r) => (
      <div key={r.id} className="flex items-center gap-2">
        <Input
          aria-label={`Name of ${r.originalName}`}
          value={r.name}
          onChange={(e) => update(r.id, { name: e.target.value })}
          className="min-w-0 flex-1"
          maxLength={40}
          disabled={pending}
        />
        <AmountInput
          aria-label={`Planned for ${r.originalName}`}
          value={r.planned}
          onChange={(e) => update(r.id, { planned: e.target.value })}
          className="w-32 shrink-0 text-right tabular-nums"
          disabled={pending}
        />
        {r.isDues ? (
          <span className="w-10 shrink-0" aria-hidden />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="w-10 shrink-0"
            aria-label={`Remove ${r.originalName}`}
            disabled={pending}
            onClick={() => removeCategory(r)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    ));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil className="h-4 w-4" aria-hidden />
          Edit the plan
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit the plan</DialogTitle>
          <DialogDescription>
            What the camp plans to spend and take in, by category. Every change
            is recorded with who made it. A category already used by an entry or
            a claim is archived, not deleted, so the books still add up.
          </DialogDescription>
        </DialogHeader>
        <Field
          label="Contingency"
          htmlFor="plan-contingency"
          help="A share of planned spend held back for surprises."
        >
          <div className="flex items-center gap-2">
            <Input
              id="plan-contingency"
              type="number"
              min={0}
              max={MONEY_CONTINGENCY_MAX_PCT}
              step={1}
              value={contingency}
              onChange={(e) => setContingency(e.target.value)}
              className="w-24"
              disabled={pending}
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </Field>
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Spending
          </p>
          {renderRows(spending)}
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Income
          </p>
          {renderRows(income)}
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3 sm:flex-row sm:items-end">
          <Field
            label="New category"
            htmlFor="plan-new-name"
            className="flex-1"
          >
            <Input
              id="plan-new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Art car fuel"
              maxLength={40}
              disabled={pending}
            />
          </Field>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={newKind}
            onValueChange={(v) => {
              if (v === "expense" || v === "income") setNewKind(v);
            }}
            aria-label="Kind of category"
          >
            <ToggleGroupItem value="expense">Spending</ToggleGroupItem>
            <ToggleGroupItem value="income">Income</ToggleGroupItem>
          </ToggleGroup>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending || newName.trim() === ""}
            onClick={addCategory}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add
          </Button>
        </div>
        {error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            <Check className="h-4 w-4" aria-hidden />
            Save the plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Entries ---------------------------------------------------------------------

export interface EntryFormValue {
  id: string;
  categoryId: string;
  kind: BudgetCategoryKind;
  amountCents: number;
  entryDate: string;
  description: string;
  status: BudgetEntryStatus;
}

/** Categories an entry can go under: live ones, never camp dues (dues come
 * from the Dues tab, so they are never counted twice). */
export function entryCategories(
  categories: readonly PlanCategory[],
): PlanCategory[] {
  return categories.filter(
    (c) => !c.archived && c.systemKey !== DUES_CATEGORY_KEY,
  );
}

export function EntryDialog({
  slug,
  categories,
  receiptsEnabled,
  entry,
  trigger,
}: {
  slug: string;
  categories: readonly PlanCategory[];
  receiptsEnabled: boolean;
  /** Present = correct this entry; absent = add one. */
  entry?: EntryFormValue;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<BudgetCategoryKind>("expense");
  const [categoryId, setCategoryId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState<BudgetEntryStatus>("paid");
  const [file, setFile] = React.useState<File | null>(null);
  const { pending, error, setError, run } = useMoneyAction();
  const usable = entryCategories(categories);
  const ofKind = usable.filter((c) => c.kind === kind);
  const idBase = entry ? `entry-${entry.id}` : "entry-new";

  function reset() {
    setKind(entry?.kind ?? "expense");
    setCategoryId(entry?.categoryId ?? "");
    setAmount(centsToField(entry?.amountCents));
    setDate(entry?.entryDate ?? todayInSouthAfrica());
    setDescription(entry?.description ?? "");
    setStatus(entry?.status ?? "paid");
    setFile(null);
    setError(null);
  }

  function save() {
    const cents = fieldToCents(amount);
    if (cents === null || cents <= 0) {
      setError("Enter an amount, like R 640,00.");
      return;
    }
    if (!categoryId) {
      setError("Pick a category.");
      return;
    }
    const fields = {
      slug,
      categoryId,
      amountCents: cents,
      entryDate: date,
      description,
      status: kind === "income" ? ("paid" as const) : status,
    };
    if (entry) {
      run(() => updateBudgetEntryAction({ ...fields, entryId: entry.id }), {
        success: "The entry is corrected.",
        onDone: () => setOpen(false),
      });
      return;
    }
    run(() => addBudgetEntryAction(fields), {
      success: "The entry is saved.",
      onDone: async (result) => {
        if (file) {
          const failed = await uploadReceipt({
            slug,
            kind: "entry",
            id: result.id,
            file,
          });
          if (failed) toast.error(`The entry is saved, but: ${failed}`);
        }
        setOpen(false);
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {entry ? "Correct the entry" : "Add an entry"}
          </DialogTitle>
          <DialogDescription>
            Spending or income the camp has made or committed to. Dues received
            and approved claims count from their own tabs.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Kind">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={kind}
              onValueChange={(v) => {
                if (v !== "expense" && v !== "income") return;
                setKind(v);
                setCategoryId("");
              }}
              aria-label="Kind"
              className="justify-start"
            >
              <ToggleGroupItem value="expense">Spending</ToggleGroupItem>
              <ToggleGroupItem value="income">Income</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field label="Category" htmlFor={`${idBase}-category`}>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id={`${idBase}-category`}>
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                {ofKind.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" htmlFor={`${idBase}-amount`}>
              <AmountInput
                id={`${idBase}-amount`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Date" htmlFor={`${idBase}-date`}>
              <Input
                id={`${idBase}-date`}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Description" htmlFor={`${idBase}-description`}>
            <Input
              id={`${idBase}-description`}
              value={description}
              maxLength={200}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ice and fresh veg, Ceres"
            />
          </Field>
          {kind === "expense" ? (
            <Field label="Status">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={status}
                onValueChange={(v) => {
                  if (v === "paid" || v === "committed") setStatus(v);
                }}
                aria-label="Status"
                className="justify-start"
              >
                <ToggleGroupItem value="paid">Paid</ToggleGroupItem>
                <ToggleGroupItem value="committed">Committed</ToggleGroupItem>
              </ToggleGroup>
            </Field>
          ) : (
            <p className="text-xs text-muted-foreground">
              Income is recorded as received.
            </p>
          )}
          {!entry && (
            <ReceiptPicker
              file={file}
              onChange={setFile}
              enabled={receiptsEnabled}
              audience="Only the camp's money people can open it."
              disabled={pending}
            />
          )}
        </div>
        {error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            <Check className="h-4 w-4" aria-hidden />
            Save entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteEntryButton({
  slug,
  entryId,
  description,
  amountCents,
}: {
  slug: string;
  entryId: string;
  description: string;
  amountCents: number;
}) {
  const [open, setOpen] = React.useState(false);
  const { pending, error, run } = useMoneyAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Delete the entry: ${description}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this entry?</DialogTitle>
          <DialogDescription>
            {description} · {formatRand(amountCents)}. The deletion is recorded
            with who made it. Add the right entry again if it was a mistake.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              run(() => deleteBudgetEntryAction({ slug, entryId }), {
                success: "The entry is deleted.",
                onDone: () => setOpen(false),
              })
            }
          >
            Delete entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
