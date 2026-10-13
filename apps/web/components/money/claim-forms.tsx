"use client";

import * as React from "react";
import { Check, CircleCheck, Plus, Send, Undo2, X } from "lucide-react";
import { formatRand } from "@quagga/core";
import { MONEY_DESCRIPTION_MAX, MONEY_NOTE_MAX } from "@quagga/types";
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
import { Textarea } from "@quagga/ui/components/textarea";
import { toast } from "@quagga/ui/components/toast";
import {
  approveClaimAction,
  markClaimRepaidAction,
  rejectClaimAction,
  submitClaimAction,
  withdrawClaimAction,
} from "@/app/(app)/camps/[slug]/money/actions";
import { todayInSouthAfrica } from "@/lib/money-view";
import {
  AmountInput,
  RecordsOnlyNote,
  fieldToCents,
  useMoneyAction,
} from "./form-bits";
import { ReceiptPicker, uploadReceipt } from "./receipt-input";

// Claims (frames M3, M4): a member claims back money they spent for the camp;
// a money person approves or rejects it and, once the camp has paid them back
// by EFT, records that it is repaid. Nothing is paid through the app. A claim's
// author never decides their own claim — the server refuses it whatever these
// buttons show.

export interface ClaimCategory {
  id: string;
  name: string;
}

const UNSURE = "__unsure__";

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="text-sm font-medium text-destructive" role="alert">
      {error}
    </p>
  );
}

export function NewClaimDialog({
  slug,
  categories,
  receiptsEnabled,
}: {
  slug: string;
  categories: readonly ClaimCategory[];
  receiptsEnabled: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [categoryId, setCategoryId] = React.useState(UNSURE);
  const [amount, setAmount] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const { pending, error, setError, run } = useMoneyAction();

  function save() {
    const cents = fieldToCents(amount);
    if (cents === null || cents <= 0) {
      setError("Enter what you spent, like R 385,00.");
      return;
    }
    run(
      () =>
        submitClaimAction({
          slug,
          categoryId: categoryId === UNSURE ? null : categoryId,
          amountCents: cents,
          description,
        }),
      {
        success: "Your claim is submitted. The money people get a notice.",
        onDone: async (result) => {
          if (file) {
            const failed = await uploadReceipt({
              slug,
              kind: "claim",
              id: result.id,
              file,
            });
            if (failed) {
              toast.error(
                `Your claim is in, but the receipt didn't upload: ${failed} Add it from the claim while it waits.`,
              );
            }
          }
          setOpen(false);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setCategoryId(UNSURE);
          setAmount("");
          setDescription("");
          setFile(null);
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus className="h-4 w-4" aria-hidden />
          New claim
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Claim money back</DialogTitle>
          <DialogDescription>
            For something you bought for the camp with your own money.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="claim-category">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="claim-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSURE}>
                  Not sure (the money people pick)
                </SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Amount" htmlFor="claim-amount">
            <AmountInput
              id="claim-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>
        <Field label="What was it for?" htmlFor="claim-description">
          <Textarea
            id="claim-description"
            rows={3}
            value={description}
            maxLength={MONEY_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ice for the cooler boxes, Ceres, on the way in"
          />
        </Field>
        <ReceiptPicker
          file={file}
          onChange={setFile}
          enabled={receiptsEnabled}
          audience="Only you and the camp's money people can open it."
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">
          A money person approves or rejects it. Once approved, the camp pays
          you back by EFT and marks it repaid. You can withdraw it until
          it&apos;s decided.
        </p>
        <FormError error={error} />
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
            <Send className="h-4 w-4" aria-hidden />
            Submit claim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WithdrawClaimButton({
  slug,
  claimId,
}: {
  slug: string;
  claimId: string;
}) {
  const [confirm, setConfirm] = React.useState(false);
  const { pending, error, run } = useMoneyAction();
  return (
    <div className="flex flex-col gap-1">
      {confirm ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => withdrawClaimAction({ slug, claimId }), {
                success: "Your claim is withdrawn.",
              })
            }
          >
            Withdraw it
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirm(false)}
            disabled={pending}
          >
            Keep it
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirm(true)}
        >
          <Undo2 className="h-4 w-4" aria-hidden />
          Withdraw
        </Button>
      )}
      <FormError error={error} />
    </div>
  );
}

export interface DecidableClaim {
  id: string;
  claimantName: string;
  amountCents: number;
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  decidedAtLabel: string | null;
}

function claimSummary(c: DecidableClaim): string {
  return [c.categoryName, formatRand(c.amountCents), c.description]
    .filter(Boolean)
    .join(" · ");
}

/** Approve. A claim filed without a category asks for one first — an
 * approved claim is spending, and spending has a category. */
export function ApproveClaimButton({
  slug,
  claim,
  categories,
}: {
  slug: string;
  claim: DecidableClaim;
  categories: readonly ClaimCategory[];
}) {
  const [open, setOpen] = React.useState(false);
  const [categoryId, setCategoryId] = React.useState("");
  const { pending, error, setError, run } = useMoneyAction();

  if (claim.categoryId) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                approveClaimAction({
                  slug,
                  claimId: claim.id,
                  categoryId: null,
                }),
              { success: `${claim.claimantName}'s claim is approved.` },
            )
          }
        >
          <CircleCheck className="h-4 w-4" aria-hidden />
          Approve
        </Button>
        <FormError error={error} />
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setCategoryId("");
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <CircleCheck className="h-4 w-4" aria-hidden />
          Approve
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve {claim.claimantName}&apos;s claim</DialogTitle>
          <DialogDescription>{claimSummary(claim)}</DialogDescription>
        </DialogHeader>
        <Field
          label="Which category does it count against?"
          htmlFor={`approve-${claim.id}-category`}
        >
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id={`approve-${claim.id}-category`}>
              <SelectValue placeholder="Pick a category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <FormError error={error} />
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
            disabled={pending || !categoryId}
            onClick={() =>
              run(
                () =>
                  approveClaimAction({
                    slug,
                    claimId: claim.id,
                    categoryId,
                  }),
                {
                  success: `${claim.claimantName}'s claim is approved.`,
                  onDone: () => setOpen(false),
                },
              )
            }
          >
            <CircleCheck className="h-4 w-4" aria-hidden />
            Approve claim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RejectClaimDialog({
  slug,
  claim,
}: {
  slug: string;
  claim: DecidableClaim;
}) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const { pending, error, setError, run } = useMoneyAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setNote("");
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <X className="h-4 w-4" aria-hidden />
          Reject with a note
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject {claim.claimantName}&apos;s claim</DialogTitle>
          <DialogDescription>{claimSummary(claim)}</DialogDescription>
        </DialogHeader>
        <Field
          label="Tell them why. They see this note."
          htmlFor={`reject-${claim.id}-note`}
        >
          <Textarea
            id={`reject-${claim.id}-note`}
            rows={3}
            value={note}
            maxLength={MONEY_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <FormError error={error} />
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
              run(() => rejectClaimAction({ slug, claimId: claim.id, note }), {
                success: `${claim.claimantName}'s claim is rejected. They get your note.`,
                onDone: () => setOpen(false),
              })
            }
          >
            <X className="h-4 w-4" aria-hidden />
            Reject claim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MarkRepaidDialog({
  slug,
  claim,
}: {
  slug: string;
  claim: DecidableClaim;
}) {
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState("");
  const { pending, error, setError, run } = useMoneyAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDate(todayInSouthAfrica());
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Check className="h-4 w-4" aria-hidden />
          Mark repaid
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Mark {claim.claimantName}&apos;s claim repaid
          </DialogTitle>
          <DialogDescription>
            {[
              claim.categoryName,
              formatRand(claim.amountCents),
              claim.decidedAtLabel ? `approved ${claim.decidedAtLabel}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </DialogDescription>
        </DialogHeader>
        <Field label="Repaid on" htmlFor={`repaid-${claim.id}-date`}>
          <Input
            id={`repaid-${claim.id}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <RecordsOnlyNote>
          Pay them back by EFT from the camp&apos;s account first. This only
          records that it happened; nothing is sent from here.
        </RecordsOnlyNote>
        <FormError error={error} />
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
              run(
                () =>
                  markClaimRepaidAction({
                    slug,
                    claimId: claim.id,
                    repaidOn: date,
                  }),
                {
                  success: `${claim.claimantName}'s claim is marked repaid.`,
                  onDone: () => setOpen(false),
                },
              )
            }
          >
            <Check className="h-4 w-4" aria-hidden />
            Mark repaid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
