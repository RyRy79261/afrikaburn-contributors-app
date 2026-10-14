"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { formatRand, parseRandToCents } from "@quagga/core";
import { Input } from "@quagga/ui/components/input";
import { toast } from "@quagga/ui/components/toast";

// Shared pieces of the money forms: the rand amount field, the "records
// only" info box and the submit-then-refresh hook every dialog uses.

/** What an amount field shows for a stored amount ("R 1 500,00"). */
export function centsToField(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : formatRand(cents);
}

/** The typed amount → whole cents, or null with nothing usable typed. */
export function fieldToCents(value: string): number | null {
  return parseRandToCents(value);
}

export function AmountInput(
  props: Omit<React.ComponentProps<typeof Input>, "type" | "inputMode">,
) {
  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder={props.placeholder ?? "R 0,00"}
    />
  );
}

/** The blue note on M2 / M3: this records something; nothing moves here. */
export function RecordsOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs text-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Run a money action: pending state, the error to show, a toast and a refresh
 * on success. `onDone` closes the dialog.
 */
export function useMoneyAction() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(
    <R extends ActionResult>(
      action: () => Promise<R>,
      opts: {
        success?: string;
        onDone?: (result: Extract<R, { ok: true }>) => void | Promise<void>;
      } = {},
    ) => {
      setError(null);
      startTransition(async () => {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        await opts.onDone?.(result as Extract<R, { ok: true }>);
        if (opts.success) toast.success(opts.success);
        router.refresh();
      });
    },
    [router],
  );

  return { pending, error, setError, run };
}
