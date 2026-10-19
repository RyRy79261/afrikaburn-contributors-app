import { z } from "zod";

// Registration safety (docs/registration-safety-spec.md): the fire kinds a camp
// ticks under "Will your camp have any fire?" and the optional gas & fuel
// record. Shapes only — the rules (thresholds, extinguisher maths, who may
// edit) are @quagga/core `registration-safety.ts`.

/**
 * The kinds of fire (G2a), as STABLE KEYS. They are stored in
 * `registrations.s4_fire_kinds` and are the option values of the Form 2
 * `fire_kinds` question, so a label may change and a key may not.
 *
 * The list comes from Quaggapedia "Fire, Fire Safety" and is NOT confirmed by
 * AfrikaBurn yet — open point 3 in the spec's "Open points for AfrikaBurn".
 */
export const FireKind = z.enum([
  "braai_brazier",
  "fire_pit",
  "burn_barrel",
  "gas_cooking_heating",
  "flame_effect",
  "fire_performance",
  "other",
]);
export type FireKind = z.infer<typeof FireKind>;

/** Every fire kind, in the order the form shows them. */
export const FIRE_KINDS: readonly FireKind[] = FireKind.options;

/** What a camp sees next to each fire kind. */
export const FIRE_KIND_LABELS: Record<FireKind, string> = {
  braai_brazier: "Braai or brazier (raised)",
  fire_pit: "Fire pit (raised)",
  burn_barrel: "Burn barrel",
  gas_cooking_heating: "Gas cooking or heating",
  flame_effect: "Flame effect",
  fire_performance: "Fire performance",
  other: "Other",
};

/** The longest free-text note on a gas & fuel record. */
export const GAS_FUEL_NOTE_MAX = 500;
/** More bottle-size rows than any camp has; a bound, not a rule. */
export const GAS_FUEL_MAX_LPG_ROWS = 12;
/** A bound on every count so a typo cannot store a nonsense number. */
export const GAS_FUEL_MAX_COUNT = 1000;

/** The bottle sizes the record offers, in kg. Common South African LPG
 * cylinders; a camp picks one per row. */
export const LPG_BOTTLE_SIZES_KG = [3, 5, 9, 14, 19, 48] as const;

const Count = z.number().int().min(0).max(GAS_FUEL_MAX_COUNT);

/** One row of LPG: a bottle size and how many of it. */
export const LpgRow = z.strictObject({
  sizeKg: z.number().positive().max(100),
  count: Count,
});
export type LpgRow = z.infer<typeof LpgRow>;

/**
 * The gas & fuel record: what a camp is bringing that burns. One jsonb
 * document on `camp_gas_fuel_records.record`. Totals are computed, never
 * stored.
 */
export const GasFuelRecord = z.strictObject({
  lpg: z.array(LpgRow).max(GAS_FUEL_MAX_LPG_ROWS),
  jerryCans20l: Count,
  barrels200l: Count,
  fuelTrailers: Count,
  note: z.string().max(GAS_FUEL_NOTE_MAX),
});
export type GasFuelRecord = z.infer<typeof GasFuelRecord>;

const Slug = z.string().min(1).max(120);

/** Save the record (it stops being a draft). */
export const SaveGasFuelRecordInput = z.strictObject({
  slug: Slug,
  record: GasFuelRecord,
});
export type SaveGasFuelRecordInput = z.infer<typeof SaveGasFuelRecordInput>;

/** "Start from 2026": copy the previous edition's record in as a draft. */
export const StartGasFuelFromLastYearInput = z.strictObject({ slug: Slug });
export type StartGasFuelFromLastYearInput = z.infer<
  typeof StartGasFuelFromLastYearInput
>;
