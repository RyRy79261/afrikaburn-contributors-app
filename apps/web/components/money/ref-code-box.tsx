"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";

/** "Your ref code" on M4: the member's own camp reference, to quote on every
 * EFT so the camp can tell the money is theirs. Copy only — nothing pays. */
export function RefCodeBox({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — copy the code by hand.");
    }
  }
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/10 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Your ref code</p>
          <p
            className="mt-0.5 font-mono text-lg font-semibold text-primary"
            data-testid="money-ref-code"
          >
            {code}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Copy className="h-4 w-4" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Use it as the reference on every EFT, so the camp can tell the money is
        yours.
      </p>
    </div>
  );
}
