// The audience chip on the reader's bulletin page (/bulletins/[id]). PURE —
// copy only; the read itself is authorised by the caller's delivery row.

import { teamAudienceLabel, teamNamesFor } from "@quagga/core";
import {
  ORG_OUTBOUND_SELECTOR_LABELS,
  OFFICER_AUDIENCE_LABELS,
  type AudienceSpec,
} from "@quagga/types";

/**
 * Audience chip copy. The spec's audience machinery is shared with
 * questionnaires; participants only ever see outbound/officer/project shapes
 * here because org-internal broadcasts can't reach this page at all.
 *
 * A by-team camp announcement names its teams ("Kitchen team", "Kitchen +
 * Build crew", docs/team-audiences-spec.md §Surfaces) from `campTeams` — the
 * sending camp's teams, archived included; an id whose team was deleted since
 * is left out, and with none left the chip reads "Deleted team".
 */
export function bulletinAudienceChip(
  spec: AudienceSpec | null,
  campTeams: readonly { id: string; name: string }[] = [],
): string | null {
  if (!spec) return null;
  switch (spec.kind) {
    case "org_outbound":
      return spec.selectors
        .map((s) => ORG_OUTBOUND_SELECTOR_LABELS[s] ?? s)
        .join(", ");
    case "org_officer":
      return spec.officerKeys
        .map((k) => OFFICER_AUDIENCE_LABELS[k] ?? k)
        .join(", ");
    case "project":
      return spec.mode === "teams"
        ? teamAudienceLabel(teamNamesFor(spec.teamIds ?? [], campTeams))
        : "Your camp";
    case "org_suppliers":
      // Supplier broadcasts never reach a burner's bulletin page (they target
      // supplier accounts), but the label keeps the switch exhaustive.
      return "Suppliers";
    case "org_internal":
      return null;
  }
}
