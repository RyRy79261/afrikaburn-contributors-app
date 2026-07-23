// Placement-preference zones for Section 5. AfrikaBurn's confirmed business rule
// is that placement zones change year to year and must be configurable per
// edition (docs/sources/scope-theme-camp-registration.txt). The frozen schema
// has no per-edition zone table, so the code owns the list keyed by edition
// year; new editions add an entry without a migration. Zone names track the
// real Tankwa Town geography (the binnekring, the ish-roads, the Loud & Quiet
// Zones from docs/sources/quaggapedia/sound-quiet.md).

export interface PlacementZone {
  /** Stored verbatim in the placement-choice columns (human-readable). */
  readonly value: string;
  readonly label: string;
  readonly blurb: string;
}

/** AfrikaBurn 2027 placement zones (seeded, sensible defaults). */
export const PLACEMENT_ZONES_2027: readonly PlacementZone[] = [
  {
    value: "Binnekring — front line (12ish)",
    label: "Binnekring — front line (12ish)",
    blurb: "On the inner circle near the Clan. High-energy, high-footfall, loud.",
  },
  {
    value: "Binnekring — back line",
    label: "Binnekring — back line",
    blurb: "Facing the Circle but a step quieter — good for family-friendly camps.",
  },
  {
    value: "Loud Zone (northwest binnekring)",
    label: "Loud Zone (northwest binnekring)",
    blurb: "Where large sound rigs are grouped. Register as a sound camp for this.",
  },
  {
    value: "Mid-city (3ish–9ish roads)",
    label: "Mid-city (3ish–9ish roads)",
    blurb: "The body of the city, between the Circle and the outer roads.",
  },
  {
    value: "Outer roads (back of the city)",
    label: "Outer roads (back of the city)",
    blurb: "Deeper into the camping rings — calmer, further from the noise.",
  },
  {
    value: "Quiet Camping (behind the dunes)",
    label: "Quiet Camping (behind the dunes)",
    blurb: "No generators or amplified sound at any time. For a proper night's sleep.",
  },
  {
    value: "No preference — place us where it works",
    label: "No preference",
    blurb: "Happy to be placed wherever suits AfrikaBurn's plan.",
  },
];

const ZONES_BY_YEAR: Record<number, readonly PlacementZone[]> = {
  2027: PLACEMENT_ZONES_2027,
};

/**
 * The placement zones offered for a given edition year. Falls back to the 2027
 * list for any year without a bespoke entry (single seeded edition in the MVP).
 */
export function getPlacementZones(year: number): readonly PlacementZone[] {
  return ZONES_BY_YEAR[year] ?? PLACEMENT_ZONES_2027;
}
