import { Info } from "lucide-react";
import {
  AUTH_CAPABILITIES,
  capabilityPendingMessage,
  type AuthCapability,
} from "@quagga/core";
import type { AuthCapabilityKey } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { cn } from "@quagga/ui/lib/utils";

// The honest "we can't do this yet" block.
//
// THE RULE (docs/accounts-security-spec.md §"Provider capability probe"): a
// surface for a capability our managed Neon Auth instance does not expose must
// say so plainly and offer NO control that pretends otherwise. Every word shown
// here comes from `AUTH_CAPABILITIES` in @quagga/core — the single machine-
// readable authority — so the day a capability flips to `supported`, this notice
// disappears from every surface at once and nobody has to hunt for stale copy.
//
// Deliberately not styled as an error: nothing is broken, and nothing the burner
// did caused it.

const SUPPORT_LABEL: Record<
  Exclude<AuthCapability["support"], "supported">,
  string
> = {
  unavailable: "Not available yet",
  client_only: "Not available yet",
};

export function capabilityFor(key: AuthCapabilityKey): AuthCapability {
  return AUTH_CAPABILITIES[key];
}

export function CapabilityNotice({
  capability,
  className,
}: {
  capability: AuthCapabilityKey;
  className?: string;
}) {
  const cap = AUTH_CAPABILITIES[capability];

  // A capability the PROVIDER supports but we have not finished wiring still
  // owes the reader an explanation — this used to return null for it, leaving a
  // disabled button sitting next to nothing at all.
  const pending = capabilityPendingMessage(cap);
  if (cap.support === "supported" && !pending) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Badge variant="outline">
          {cap.support === "supported"
            ? "Not finished yet"
            : SUPPORT_LABEL[cap.support]}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {pending || cap.userMessage}
      </p>
    </div>
  );
}
