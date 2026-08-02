import { AUTH_CAPABILITIES, capabilityVerdict } from "@quagga/core";
import type { AuthCapabilityKey } from "@quagga/types";
import { AccountCapabilityNotice } from "@quagga/ui/components/account-capability-notice";

// The honest "we can't do this yet" block — @quagga/core's capability matrix
// resolved into the shared presentation (roadmap M4-21).
//
// THE RULE (docs/accounts-security-spec.md §"Provider capability probe"): a
// surface for a capability our auth server does not expose must say so plainly
// and offer NO control that pretends otherwise. Every word comes from
// `AUTH_CAPABILITIES` — the single machine-readable authority — so the day a
// capability flips to `supported`, the notice disappears from every surface at
// once and nobody has to hunt for stale copy.
//
// The wording now lives in core's `capabilityVerdict` rather than here, because
// the org console and the supplier portal render the same refusal and a second
// copy of "Not finished yet" is a second copy that can drift.

export function CapabilityNotice({
  capability,
  className,
}: {
  capability: AuthCapabilityKey;
  className?: string;
}) {
  return (
    <AccountCapabilityNotice
      verdict={capabilityVerdict(AUTH_CAPABILITIES[capability])}
      className={className}
    />
  );
}
