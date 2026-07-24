"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";

interface MemberRefCodeProps {
  code: string;
  /** Prominent variant = the viewer's own code banner; otherwise an inline chip. */
  prominent?: boolean;
}

/**
 * A camp-scoped member reference code with copy-to-clipboard. The code is a
 * stable identifier a camp quotes for its OWN off-platform EFT reconciliation —
 * the platform never processes money.
 */
export function MemberRefCode({ code, prominent = false }: MemberRefCodeProps) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — copy the code manually");
    }
  }

  if (prominent) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Your camp reference
          </p>
          <p className="mt-0.5 font-mono text-xl font-semibold tracking-tight">
            {code}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Use it as your EFT reference when you pay the camp for shared costs.
            AfrikaBurn never charges for registration — this is camp-internal.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Copy className="h-4 w-4" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Copy reference code ${code}`}
    >
      {code}
      {copied ? (
        <Check className="h-3 w-3" aria-hidden />
      ) : (
        <Copy className="h-3 w-3" aria-hidden />
      )}
    </button>
  );
}
