import {
  OFFICER_KEYS,
  OFFICER_AUDIENCE_LABELS,
  ORG_OUTBOUND_SELECTORS,
  ORG_OUTBOUND_SELECTOR_LABELS,
  type AudienceSpec,
  type OfficerKey,
  type OrgOutboundSelector,
} from "@quagga/types";

// The bulletin audience picker's option list ⇄ AudienceSpec mapping.
//
// A bulletin targets ONE audience (canvas `U8CqE`: a single-choice list), so
// every option projects to a one-selector spec. The selector vocabulary is the
// questionnaire audience vocabulary verbatim (notifications-spec: "reuses the
// questionnaire audience machinery") — never a bulletin-only list, so the
// shared @quagga/core resolver stays the single source of truth for who a
// bulletin reaches. Project audiences are deliberately absent: those are
// camp-scoped and the server action rejects them.

export interface BulletinAudienceOption {
  value: string;
  label: string;
}

const OUTBOUND_PREFIX = "outbound:";
const OFFICER_PREFIX = "officer:";
const INTERNAL_VALUE = "org_internal";

/** Options for the AudienceSelect, in broadcast-reach order. */
export const BULLETIN_AUDIENCE_OPTIONS: readonly BulletinAudienceOption[] = [
  ...ORG_OUTBOUND_SELECTORS.map((selector) => ({
    value: `${OUTBOUND_PREFIX}${selector}`,
    label: ORG_OUTBOUND_SELECTOR_LABELS[selector],
  })),
  ...OFFICER_KEYS.map((key) => ({
    value: `${OFFICER_PREFIX}${key}`,
    label: OFFICER_AUDIENCE_LABELS[key],
  })),
  { value: INTERNAL_VALUE, label: "Org members (internal)" },
];

/** Option value → the audience spec the action stores. `null` when unknown. */
export function audienceSpecForOption(value: string): AudienceSpec | null {
  if (value === INTERNAL_VALUE) return { kind: "org_internal" };
  if (value.startsWith(OUTBOUND_PREFIX)) {
    const selector = value.slice(OUTBOUND_PREFIX.length) as OrgOutboundSelector;
    return ORG_OUTBOUND_SELECTORS.includes(selector)
      ? { kind: "org_outbound", selectors: [selector] }
      : null;
  }
  if (value.startsWith(OFFICER_PREFIX)) {
    const key = value.slice(OFFICER_PREFIX.length) as OfficerKey;
    return OFFICER_KEYS.includes(key)
      ? { kind: "org_officer", officerKeys: [key] }
      : null;
  }
  return null;
}

/**
 * Stored spec → option value, so editing an existing bulletin re-selects it.
 * A multi-selector spec (authored elsewhere) has no single option; returning
 * `undefined` leaves the picker empty rather than silently narrowing it.
 */
export function optionForAudienceSpec(
  spec: AudienceSpec | null | undefined,
): string | undefined {
  if (!spec) return undefined;
  if (spec.kind === "org_internal") return INTERNAL_VALUE;
  if (spec.kind === "org_outbound" && spec.selectors.length === 1) {
    return `${OUTBOUND_PREFIX}${spec.selectors[0]}`;
  }
  if (spec.kind === "org_officer" && spec.officerKeys.length === 1) {
    return `${OFFICER_PREFIX}${spec.officerKeys[0]}`;
  }
  return undefined;
}

/** The noun the "Resolves to ~N …" line uses for a given audience. */
export function audienceCountNoun(value: string | undefined): string {
  if (!value) return "burners";
  if (value === INTERNAL_VALUE) return "org staff";
  if (value.startsWith(OFFICER_PREFIX)) return "officers";
  if (value === `${OUTBOUND_PREFIX}all_current_burners`) return "burners";
  return "recipients";
}
