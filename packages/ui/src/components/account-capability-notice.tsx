import { Info } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import { cn } from "@quagga/ui/lib/utils";

// The honest "we can't do this yet" block, shared by all three apps.
//
// THE RULE (docs/accounts-security-spec.md §"Provider capability probe"): a
// surface for a capability our auth server does not expose must say so plainly
// and offer NO control that pretends otherwise.
//
// THE AUTHORITY IS @quagga/core's `AUTH_CAPABILITIES`, and it stays there. This
// component takes the ALREADY-RESOLVED verdict as data because @quagga/ui
// depends on @quagga/types and nothing else — importing core's runtime here
// would drag business logic into the presentation package for the sake of one
// lookup. Each app resolves the capability and passes what it found, so the day
// a capability flips to `supported` the notice still disappears everywhere at
// once.
//
// Deliberately not styled as an error: nothing is broken, and nothing the reader
// did caused it.

export interface CapabilityVerdict {
  /**
   * `null` when there is nothing to say — the capability is supported AND
   * finished. The component renders nothing, so a caller can pass this
   * unconditionally rather than branching at every call site.
   */
  label: string | null;
  message: string;
}

export function AccountCapabilityNotice({
  verdict,
  className,
}: {
  verdict: CapabilityVerdict;
  className?: string;
}) {
  if (!verdict.label) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Badge variant="outline">{verdict.label}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{verdict.message}</p>
    </div>
  );
}
