"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { wapDateLabel, wapYesNo } from "@quagga/core";
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
import { updatePassAction } from "@/app/(app)/_project-passes/actions";

// Edit one pass (canvas W1, the pencil). Each field is either the member's own
// roster plan (blank / "From the roster") or the lead's override on the pass.
// The server validates the dates against the edition and against each other
// (@quagga/core `validateWapOverrides`) and stores an override equal to the
// plan as "follow the plan".

export interface EditablePass {
  allocationId: string;
  displayName: string;
  overrides: {
    arrivalDate: string | null;
    departureDate: string | null;
    build: boolean | null;
    strike: boolean | null;
  };
  plan: {
    arrivalDate: string | null;
    departureDate: string | null;
    joiningBuild: boolean;
    joiningStrike: boolean;
  } | null;
}

type Tri = "plan" | "yes" | "no";
const toTri = (v: boolean | null): Tri =>
  v === null ? "plan" : v ? "yes" : "no";
const fromTri = (v: Tri): boolean | null => (v === "plan" ? null : v === "yes");

export function EditPassDialog({
  slug,
  pass,
  window,
}: {
  slug: string;
  pass: EditablePass;
  /** The edition's date window (the same one a member's own plan sits in). */
  window: { earliest: string; latest: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [arrival, setArrival] = React.useState(
    pass.overrides.arrivalDate ?? "",
  );
  const [departure, setDeparture] = React.useState(
    pass.overrides.departureDate ?? "",
  );
  const [build, setBuild] = React.useState<Tri>(toTri(pass.overrides.build));
  const [strike, setStrike] = React.useState<Tri>(toTri(pass.overrides.strike));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const id = `pass-${pass.allocationId}`;

  function reset() {
    setArrival(pass.overrides.arrivalDate ?? "");
    setDeparture(pass.overrides.departureDate ?? "");
    setBuild(toTri(pass.overrides.build));
    setStrike(toTri(pass.overrides.strike));
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updatePassAction({
        slug,
        allocationId: pass.allocationId,
        arrivalDate: arrival || null,
        departureDate: departure || null,
        build: fromTri(build),
        strike: fromTri(strike),
      });
      if (!result.ok) {
        setError(result.error);
        router.refresh();
        return;
      }
      toast.success(`${pass.displayName}'s pass is updated.`);
      setOpen(false);
      router.refresh();
    });
  }

  const planWord = (v: boolean | undefined) =>
    `From the roster (${wapYesNo(v === undefined ? null : v)})`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Edit ${pass.displayName}'s pass`}
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pass.displayName}&apos;s pass</DialogTitle>
          <DialogDescription>
            Leave a field blank to use what they set on the roster. A change
            here shows as edited.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Arrival"
            htmlFor={`${id}-arrival`}
            help={`Roster: ${wapDateLabel(pass.plan?.arrivalDate ?? null)}`}
          >
            <Input
              id={`${id}-arrival`}
              type="date"
              min={window?.earliest}
              max={window?.latest}
              value={arrival}
              onChange={(e) => setArrival(e.target.value)}
              aria-describedby={`${id}-arrival-help`}
            />
          </Field>
          <Field
            label="Departure"
            htmlFor={`${id}-departure`}
            help={`Roster: ${wapDateLabel(pass.plan?.departureDate ?? null)}`}
          >
            <Input
              id={`${id}-departure`}
              type="date"
              min={window?.earliest}
              max={window?.latest}
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
              aria-describedby={`${id}-departure-help`}
            />
          </Field>
          <Field label="Build" htmlFor={`${id}-build`}>
            <Select value={build} onValueChange={(v) => setBuild(v as Tri)}>
              <SelectTrigger id={`${id}-build`} aria-label="Build">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plan">
                  {planWord(pass.plan?.joiningBuild)}
                </SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Strike" htmlFor={`${id}-strike`}>
            <Select value={strike} onValueChange={(v) => setStrike(v as Tri)}>
              <SelectTrigger id={`${id}-strike`} aria-label="Strike">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plan">
                  {planWord(pass.plan?.joiningStrike)}
                </SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
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
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
