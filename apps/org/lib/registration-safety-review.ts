import {
  cleanFireKinds,
  describeExtinguishers,
  describeGasFuelRecord,
  describeWaterEstimate,
  EXTINGUISHER_SIZE,
  extinguisherEstimate,
  formatLitres,
  fuelDepotAdvice,
  fuelDepotItems,
  getLayoutCatalog,
  waterEstimateLitres,
} from "@quagga/core";
import {
  FIRE_KIND_LABELS,
  type GasFuelRecord,
  type LayoutDocument,
} from "@quagga/types";
import { formatDate } from "./labels";

// Section 4's safety fields on the org review (docs/registration-safety-spec.md
// §"Org review"; frames LN9Ap / oOOW1). PURE — the page loads the facts.
//
// TWO SOURCES, ON PURPOSE. Extinguishers and Structures come from the PINNED
// layout snapshot only (camp-layout-spec decisions 9/10: later edits reach the
// org on resubmission) and are left out without one. The gas & fuel record is
// read LIVE, saved only: it is a camp record, not part of the submission.
//
// Real values replace the old placeholder: an unanswered gate reads "Not
// answered yet (Form 2)", never "No".

export const NOT_ANSWERED = "Not answered yet (Form 2)";

export interface SafetyReviewInput {
  registration: {
    s4HasGenerator: boolean | null;
    s4HasFire: boolean | null;
    s4FireKinds: readonly string[] | null;
    s4HasGasOrFuel: boolean | null;
    s4ExpectedPopulation: number | null;
    s4FirstArrivalDate: string | null;
  };
  edition: { year: number; endDate: string | null };
  /** The latest PINNED layout document, or null. Never the live one. */
  pinnedLayout: LayoutDocument | null;
  /** The SAVED gas & fuel record, or null (none, or only a draft). */
  gasFuel: {
    record: GasFuelRecord;
    updatedAt: Date;
    campNotifiedAt: Date | null;
    wranglerNotifiedAt: Date | null;
  } | null;
  wranglerAssigned: boolean;
}

export interface SafetyReviewField {
  label: string;
  value: string;
  /** "Over the limit" / "Within the limits" for the Fuel depot field. */
  chip?: { tone: "warning" | "success"; text: string };
  wide?: boolean;
}

function gate(v: boolean | null): string {
  return v === null ? NOT_ANSWERED : v ? "Yes" : "No";
}

/** "a, b and c". */
function andList(parts: readonly string[]): string {
  return parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "96 kg of gas and a 200 L barrel" — ONLY what puts a record over, in words
 * (frame LN9Ap): 2 × 20 L jerry cans stay in camp, so they are not named.
 * Built from @quagga/core `fuelDepotItems`, the same list the camp's warning
 * reads, so the org and the camp always agree on what is over. */
function overWhat(r: GasFuelRecord): string {
  return andList(fuelDepotItems(r).map((i) => i.what));
}

export const WATER_ESTIMATE_LABEL = "Water estimate";

/**
 * Where the safety fields sit in section 4 (frames LN9Ap / oOOW1): the water
 * estimate is worked out from the population, so it sits beside it; the gates,
 * the fuel depot, the record and the layout-derived counts follow the camp's
 * own size answers. Order within each group is kept.
 */
export function placeSafetyReviewFields<T extends { label: string }>(
  fields: readonly T[],
): { besidePopulation: T[]; afterSize: T[] } {
  return {
    besidePopulation: fields.filter((f) => f.label === WATER_ESTIMATE_LABEL),
    afterSize: fields.filter((f) => f.label !== WATER_ESTIMATE_LABEL),
  };
}

/** The section 4 safety fields, in the frame's order. */
export function safetyReviewFields(i: SafetyReviewInput): SafetyReviewField[] {
  const r = i.registration;
  const out: SafetyReviewField[] = [];

  // Water estimate — worked out, not asked.
  const water = i.edition.endDate
    ? waterEstimateLitres({
        population: r.s4ExpectedPopulation,
        firstArrivalDate: r.s4FirstArrivalDate,
        editionEndDate: i.edition.endDate,
      })
    : null;
  out.push({
    label: WATER_ESTIMATE_LABEL,
    value: water
      ? `About ${formatLitres(water.litres)} — ${describeWaterEstimate(water)}. Worked out, not asked.`
      : "Needs the population and first arrival",
  });

  out.push({ label: "Generator", value: gate(r.s4HasGenerator) });

  const kinds = cleanFireKinds(r.s4FireKinds);
  out.push({
    label: "Fire",
    value:
      r.s4HasFire === true && kinds.length > 0
        ? `Yes — ${kinds.map((k) => FIRE_KIND_LABELS[k].toLowerCase()).join(", ")}`
        : gate(r.s4HasFire),
  });

  out.push({ label: "Gas or fuel", value: gate(r.s4HasGasOrFuel) });

  if (i.gasFuel) {
    const g = i.gasFuel;
    const advice = fuelDepotAdvice(g.record);
    if (advice) {
      const camp = g.campNotifiedAt
        ? `The camp's leads were told on ${formatDate(g.campNotifiedAt)}.`
        : "The camp's leads haven't been told yet.";
      const wrangler = g.wranglerNotifiedAt
        ? `The wrangler was told on ${formatDate(g.wranglerNotifiedAt)}.`
        : i.wranglerAssigned
          ? "Wrangler not told yet."
          : "Wrangler not told yet: none assigned. They'll be told when one is assigned.";
      out.push({
        label: "Fuel depot",
        chip: { tone: "warning", text: "Over the limit" },
        value: `${overWhat(g.record)}. ${camp} ${wrangler}`,
      });
    } else {
      out.push({
        label: "Fuel depot",
        chip: { tone: "success", text: "Within the limits" },
        value: "Nothing goes to the fuel depot.",
      });
    }
    out.push({
      label: "Gas & fuel record",
      value: `${describeGasFuelRecord(g.record)}. Saved ${formatDate(g.updatedAt)}.${
        g.record.note ? ` “${g.record.note}”` : ""
      }`,
      wide: true,
    });
  }

  if (i.pinnedLayout) {
    const e = extinguisherEstimate(
      i.pinnedLayout,
      getLayoutCatalog(i.edition.year),
    );
    out.push({
      label: "Extinguishers (from the pinned layout)",
      value: `${describeExtinguishers(e)} — 2 × ${EXTINGUISHER_SIZE} for each 100 m², or part of 100 m², of every tent or shade structure. Serviced extinguishers are checked on site.`,
      wide: true,
    });
    const structures = e.rows
      .filter((row) => row.kind === "structure")
      .map((row) =>
        row.shape === "circle"
          ? `${row.name} Ø ${Math.round(row.width * 10) / 10} m`
          : `${row.name} ${Math.round(row.width * 10) / 10} × ${Math.round(row.length * 10) / 10} m`,
      );
    const gens = e.generators;
    if (gens > 0) {
      structures.push(gens === 1 ? "a generator" : `${gens} generators`);
    }
    out.push({
      label: "Structures (from the pinned layout)",
      value:
        structures.length > 0
          ? `${andList(structures)}.`
          : "No tent or shade structures or generators",
      wide: true,
    });
  }

  return out;
}
