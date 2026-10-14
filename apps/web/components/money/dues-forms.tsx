"use client";

import * as React from "react";
import { Check, History, Pencil, Plus, Trash2 } from "lucide-react";
import { formatRand } from "@quagga/core";
import { MONEY_INSTRUCTIONS_MAX, MONEY_NOTE_MAX } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { cn } from "@quagga/ui/lib/utils";
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
import { Textarea } from "@quagga/ui/components/textarea";
import {
  deleteDuesPaymentAction,
  listMemberPaymentsAction,
  recordDuesPaymentAction,
  setCampFeeAction,
  setMemberDuesAction,
  setPaymentInstructionsAction,
} from "@/app/(app)/camps/[slug]/money/actions";
import type { DuesPaymentView } from "@/lib/camp-money-store";
import { moneyDayLabel, todayInSouthAfrica } from "@/lib/money-view";
import {
  AmountInput,
  RecordsOnlyNote,
  centsToField,
  fieldToCents,
  useMoneyAction,
} from "./form-bits";

// The dues tab's forms (frame M2). "Record money in" writes what a money
// person SAW ARRIVE in the camp's account — nothing is collected or moved
// here (Decision 009). Every change notifies the member and is recorded.

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="text-sm font-medium text-destructive" role="alert">
      {error}
    </p>
  );
}

function Footer({
  pending,
  onCancel,
  onSave,
  saveLabel,
  extra,
}: {
  pending: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
  extra?: React.ReactNode;
}) {
  return (
    <DialogFooter>
      {extra}
      <Button
        type="button"
        variant="ghost"
        onClick={onCancel}
        disabled={pending}
      >
        Cancel
      </Button>
      <Button type="button" onClick={onSave} disabled={pending}>
        <Check className="h-4 w-4" aria-hidden />
        {saveLabel}
      </Button>
    </DialogFooter>
  );
}

// --- The camp fee and the payment instructions --------------------------------

export function CampFeeDialog({
  slug,
  campFeeCents,
}: {
  slug: string;
  campFeeCents: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const { pending, error, setError, run } = useMoneyAction();

  function save() {
    const cents = amount.trim() === "" ? 0 : fieldToCents(amount);
    if (cents === null) {
      setError("Enter an amount, like R 2 500,00.");
      return;
    }
    run(() => setCampFeeAction({ slug, defaultDuesCents: cents }), {
      success: "The camp fee is changed. Members on it get a notice.",
      onDone: () => setOpen(false),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setAmount(centsToField(campFeeCents));
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil className="h-4 w-4" aria-hidden />
          Change the camp fee
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change the camp fee</DialogTitle>
          <DialogDescription>
            What each member owes this edition unless you set a different amount
            for them. Members on the camp fee get a notice.
          </DialogDescription>
        </DialogHeader>
        <Field label="Camp fee per member" htmlFor="camp-fee">
          <AmountInput
            id="camp-fee"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <FormError error={error} />
        <Footer
          pending={pending}
          onCancel={() => setOpen(false)}
          onSave={save}
          saveLabel="Save the fee"
        />
      </DialogContent>
    </Dialog>
  );
}

export function InstructionsDialog({
  slug,
  instructions,
}: {
  slug: string;
  instructions: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const { pending, error, setError, run } = useMoneyAction();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setText(instructions ?? "");
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil className="h-4 w-4" aria-hidden />
          {instructions ? "Edit instructions" : "Write instructions"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How to pay the camp</DialogTitle>
          <DialogDescription>
            The camp&apos;s own bank details and how to use the ref code.
            Members see this under &ldquo;Your dues&rdquo;. It is instructions
            only: nothing is paid through this app.
          </DialogDescription>
        </DialogHeader>
        <Field label="Instructions" htmlFor="pay-instructions">
          <Textarea
            id="pay-instructions"
            rows={6}
            value={text}
            maxLength={MONEY_INSTRUCTIONS_MAX}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              "EFT to the camp's account\nAccount … · Branch code …\nReference: your ref code"
            }
          />
        </Field>
        <FormError error={error} />
        <Footer
          pending={pending}
          onCancel={() => setOpen(false)}
          onSave={() =>
            run(
              () =>
                setPaymentInstructionsAction({
                  slug,
                  paymentInstructions: text,
                }),
              {
                success: "The instructions are saved.",
                onDone: () => setOpen(false),
              },
            )
          }
          saveLabel="Save instructions"
        />
      </DialogContent>
    </Dialog>
  );
}

// --- One member ---------------------------------------------------------------------

export interface DuesMember {
  userId: string;
  name: string;
  refCode: string | null;
  owedCents: number;
  receivedCents: number;
  outstandingCents: number;
  isCampFee: boolean;
  reason: string | null;
}

function memberLine(m: DuesMember): string {
  return [
    m.refCode,
    `owes ${formatRand(m.owedCents)}`,
    `${formatRand(m.receivedCents)} received`,
    `${formatRand(m.outstandingCents)} outstanding`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function RecordMoneyDialog({
  slug,
  member,
  triggerClassName,
}: {
  slug: string;
  member: DuesMember;
  /** The 360 card stretches the trigger to the card's width (frame DooLI). */
  triggerClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState("");
  const [note, setNote] = React.useState("");
  const { pending, error, setError, run } = useMoneyAction();
  const id = `record-${member.userId}`;

  function save() {
    const cents = fieldToCents(amount);
    if (cents === null || cents <= 0) {
      setError("Enter the amount that arrived, like R 1 500,00.");
      return;
    }
    run(
      () =>
        recordDuesPaymentAction({
          slug,
          userId: member.userId,
          amountCents: cents,
          receivedOn: date,
          note,
        }),
      {
        success: `Recorded ${formatRand(cents)} from ${member.name}.`,
        onDone: () => setOpen(false),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setAmount(
            member.outstandingCents > 0
              ? centsToField(member.outstandingCents)
              : "",
          );
          setDate(todayInSouthAfrica());
          setNote("");
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-8 px-2.5 text-xs", triggerClassName)}
          aria-label={`Record money in from ${member.name}`}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Record money in
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record money in from {member.name}</DialogTitle>
          <DialogDescription>{memberLine(member)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" htmlFor={`${id}-amount`}>
            <AmountInput
              id={`${id}-amount`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Received on" htmlFor={`${id}-date`}>
            <Input
              id={`${id}-date`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Note (optional)"
          htmlFor={`${id}-note`}
          help="Only the money people see this note."
        >
          <Input
            id={`${id}-note`}
            value={note}
            maxLength={MONEY_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              member.refCode
                ? `EFT with reference ${member.refCode}`
                : "EFT with their ref code"
            }
          />
        </Field>
        <RecordsOnlyNote>
          This records money that is already in the camp&apos;s account. Nothing
          is collected or moved here. {member.name} gets a notice.
        </RecordsOnlyNote>
        <FormError error={error} />
        <Footer
          pending={pending}
          onCancel={() => setOpen(false)}
          onSave={save}
          saveLabel="Record it"
        />
      </DialogContent>
    </Dialog>
  );
}

export function SetAmountDialog({
  slug,
  member,
  campFeeCents,
  triggerClassName,
}: {
  slug: string;
  member: DuesMember;
  campFeeCents: number;
  /** The 360 card stretches the trigger to the card's width (frame DooLI). */
  triggerClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const { pending, error, setError, run } = useMoneyAction();
  const id = `dues-${member.userId}`;

  function save() {
    const cents = amount.trim() === "" ? null : fieldToCents(amount);
    if (cents === null) {
      setError("Enter an amount, or use the camp fee.");
      return;
    }
    if (cents === 0 && reason.trim() === "") {
      setError("Say why their dues are waived.");
      return;
    }
    run(
      () =>
        setMemberDuesAction({
          slug,
          userId: member.userId,
          amountCents: cents,
          reason,
        }),
      {
        success:
          cents === 0
            ? `${member.name}'s dues are waived.`
            : `${member.name} now owes ${formatRand(cents)}.`,
        onDone: () => setOpen(false),
      },
    );
  }

  function useCampFee() {
    run(
      () =>
        setMemberDuesAction({
          slug,
          userId: member.userId,
          amountCents: null,
          reason: null,
        }),
      {
        success: `${member.name} is back on the camp fee.`,
        onDone: () => setOpen(false),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setAmount(centsToField(member.owedCents));
          setReason(member.reason ?? "");
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-8 px-2.5 text-xs", triggerClassName)}
          aria-label={`Set what ${member.name} owes`}
        >
          Set amount
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set what {member.name} owes</DialogTitle>
          <DialogDescription>
            The camp fee is {formatRand(campFeeCents)}. Set R 0,00 with a reason
            to waive it. {member.name} gets a notice.
          </DialogDescription>
        </DialogHeader>
        <Field label="Amount" htmlFor={`${id}-amount`}>
          <AmountInput
            id={`${id}-amount`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field
          label="Reason"
          htmlFor={`${id}-reason`}
          help="Only the money people and the member see it."
        >
          <Input
            id={`${id}-reason`}
            value={reason}
            maxLength={MONEY_NOTE_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Joins for build week only"
          />
        </Field>
        <FormError error={error} />
        <Footer
          pending={pending}
          onCancel={() => setOpen(false)}
          onSave={save}
          saveLabel="Save amount"
          extra={
            member.isCampFee ? undefined : (
              <Button
                type="button"
                variant="ghost"
                onClick={useCampFee}
                disabled={pending}
                className="sm:mr-auto"
              >
                Use the camp fee
              </Button>
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/** The money recorded for one member, with "remove" for a mistake (audited;
 * record the right one again). Loaded when opened — money people only. */
export function PaymentsDialog({
  slug,
  member,
}: {
  slug: string;
  member: Pick<DuesMember, "userId" | "name">;
}) {
  const [open, setOpen] = React.useState(false);
  const [payments, setPayments] = React.useState<DuesPaymentView[] | null>(
    null,
  );
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const { pending, error, setError, run } = useMoneyAction();
  const [loading, startLoading] = React.useTransition();

  function load() {
    setPayments(null);
    setError(null);
    startLoading(async () => {
      const result = await listMemberPaymentsAction({
        slug,
        userId: member.userId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPayments(result.payments);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setConfirming(null);
          load();
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Money in from ${member.name}`}
        >
          <History className="h-4 w-4" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Money in from {member.name}</DialogTitle>
          <DialogDescription>
            Every amount recorded this edition. A wrong one is removed and
            recorded again; the removal is kept in the record.
          </DialogDescription>
        </DialogHeader>
        {loading || payments === null ? (
          !error && <p className="text-sm text-muted-foreground">Loading…</p>
        ) : payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {payments.map((p) => (
              <li key={p.id} className="flex items-start gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium tabular-nums">
                    {formatRand(p.amountCents)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {moneyDayLabel(p.receivedOn)} · recorded by{" "}
                    {p.recordedByName}
                  </p>
                  {p.note && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.note}
                    </p>
                  )}
                </div>
                {confirming === p.id ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          deleteDuesPaymentAction({ slug, paymentId: p.id }),
                        {
                          success: "The payment is removed.",
                          onDone: () => {
                            setConfirming(null);
                            load();
                          },
                        },
                      )
                    }
                  >
                    Remove it
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${formatRand(p.amountCents)} received ${moneyDayLabel(p.receivedOn)}`}
                    onClick={() => setConfirming(p.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <FormError error={error} />
      </DialogContent>
    </Dialog>
  );
}
