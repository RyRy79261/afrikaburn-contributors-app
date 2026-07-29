"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import type { TransitionResult } from "@/lib/registration-store";

/**
 * The way back from a voluntary withdrawal.
 *
 * Withdraw's confirm dialog has always told the camp their registration "won't
 * be considered for this edition until you register again" — and until now
 * there was no register-again. `withdrawn` was terminal in the state machine,
 * `registrations` is unique on (group, edition) so no second row could be
 * started, the wizard is read-only outside `draft`/`changes_requested`, and the
 * org console refused every action out of `withdrawn`. A camp that clicked
 * Withdraw was out for the edition, permanently, on the strength of a sentence
 * promising otherwise.
 *
 * Reopening returns the registration to `draft` — the camp's own editable
 * state, not in front of a reviewer — with every answer still in place.
 *
 * There is deliberately NO equivalent for `rejected`: that is AfrikaBurn's
 * decision, not the camp's, and it stays terminal.
 */
export function ReopenRegistrationButton({
  slug,
  reopenAction,
}: {
  slug: string;
  reopenAction: (slug: string) => Promise<TransitionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await reopenAction(slug);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        <RotateCcw className="h-4 w-4" aria-hidden />
        {pending ? "Reopening…" : "Reopen registration"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
