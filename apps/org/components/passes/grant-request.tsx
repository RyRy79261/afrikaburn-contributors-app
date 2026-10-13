"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, ShieldAlert } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import { toast } from "@quagga/ui/components/toast";
import { declineWapRequest, grantWapRequest } from "@/lib/actions/wap";

// Grant or decline the one pending request (frame W2). The number defaults to
// the amount asked; fewer is allowed, never more — the input caps it, and the
// server refuses it whatever this renders (@quagga/core `decideWapGrant`).

export function GrantRequest({
  requestId,
  requested,
  refusal,
}: {
  requestId: string;
  requested: number;
  /** Why this viewer may not decide, or null when they may. */
  refusal: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(String(requested));
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= requested;
  const inputId = `grant-${requestId}`;
  const hintId = `${inputId}-hint`;

  function grant() {
    if (!valid) return;
    startTransition(async () => {
      const result = await grantWapRequest({ requestId, granted: n });
      if (result.ok) {
        toast.success(`Granted ${n} pass${n === 1 ? "" : "es"}.`);
        router.refresh();
      } else {
        toast.error("Could not grant", { description: result.error });
      }
    });
  }

  function decline() {
    startTransition(async () => {
      const result = await declineWapRequest({ requestId });
      if (result.ok) {
        toast.success("Request declined.");
        router.refresh();
      } else {
        toast.error("Could not decline", { description: result.error });
      }
    });
  }

  const disabled = Boolean(refusal) || pending;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        Passes to grant
      </label>
      <Input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={1}
        max={requested}
        step={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        aria-describedby={hintId}
        aria-invalid={!valid}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        Asked for {requested}. You can grant fewer, never more.
      </p>
      <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button onClick={grant} disabled={disabled || !valid}>
          <CircleCheck aria-hidden />
          {valid ? `Grant ${n}` : "Grant"}
        </Button>
        <Button variant="outline" onClick={decline} disabled={disabled}>
          Decline
        </Button>
      </div>
      {refusal && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{refusal}</span>
        </p>
      )}
    </div>
  );
}
