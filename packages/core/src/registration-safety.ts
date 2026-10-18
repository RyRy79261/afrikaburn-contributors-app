// Registration safety (docs/registration-safety-spec.md, epic #49). PURE — no
// I/O, no clock.
//
// What a theme camp is asked about power, fire, gas and fuel is three yes/no
// gates and one follow-up (section 4, Form 2). Everything else here is DERIVED,
// never asked: a rough water guide, the extinguishers the layout implies, and
// whether the camp's optional gas & fuel record goes to the fuel depot.
//
// Pre-event planning only. There is no connectivity on site; sign-off happens
// in person, by the Safety Officer. Nothing here is an approval step.
//
// OPEN POINTS FOR AFRIKABURN (spec §"Open points for AfrikaBurn"). The
// numbers below are named constants so a confirmation changes one line:
//   1.  the extinguisher rule        → EXTINGUISHER_*
//   1b. the generator extinguisher   → GENERATOR_EXTINGUISHER_*
//   2.  the fuel depot thresholds    → FUEL_DEPOT_*, GAS_POLICY_MAX_KG
//   3.  the fire kinds list          → FireKind in @quagga/types
//   4.  FAST for flame effects       → nothing routes to FAST (not settled)
//
// NO BUCKETS OF SAND (Ryan, 18 Oct 2026). The Theme Camp Safety Checklist lists
// them next to the extinguishers; the app never asks for, counts or suggests
// them.

import type {
  FireKind,
  GasFuelRecord,
  LayoutDocument,
  LayoutObject,
  NestedLayoutObject,
} from "@quagga/types";
import { FireKind as FireKindSchema } from "@quagga/types";
import { footprintArea } from "@quagga/geo";
import { objectFootprint } from "./camp-layout";
import { findCatalogEntry, type LayoutCatalogEntry } from "./layout-catalog";
import { hasProjectPermission, type PermissionMembership } from "./project-permissions";
import type { NotificationPayload } from "@quagga/types";

// --- Policy links (decision 9: links only, never a read-check) -----------------

/** Every policy the safety questions link to, in one place. Plain links, opened
 * in a new tab; never an acknowledgement, never tracked. */
export const SAFETY_POLICY_LINKS = {
  generator: {
    label: "Generator policy",
    href: "https://quaggapedia.afrikaburn.com/index.php?title=Generator_policy",
  },
  fire: {
    label: "Fire, Fire Safety",
    href: "https://quaggapedia.afrikaburn.com/index.php?title=FIRE%2C_FIRE_SAFETY",
  },
  gasFuel: {
    label: "Gas and Fuel Storage policy",
    href: "https://www.afrikaburn.org/afrikaburn-gas-and-fuel-storage-policy/",
  },
  safetyChecklist: {
    label: "Theme Camp Safety Checklist",
    href: "https://www.afrikaburn.org/event/participation/theme-camps/theme-camp-safety-checklist/",
  },
  waterwise: {
    label: "Be Waterwise",
    href: "https://quaggapedia.afrikaburn.com/index.php?title=BE%20WATERWISE",
  },
} as const;

export type SafetyPolicyKey = keyof typeof SAFETY_POLICY_LINKS;

// --- Water (REG-017): a rough guide, not a question and not a water order -------

/** Quaggapedia "Be Waterwise": 5 L a person a day. */
export const WATER_LITRES_PER_PERSON_PER_DAY = 5;

export interface WaterEstimate {
  /** Rounded to the nearest 5 L. */
  litres: number;
  people: number;
  days: number;
}

/** Days from `from` to `to`, both inclusive; null for an unparseable date. */
function inclusiveDays(from: string, to: string): number | null {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * `5 L × population × days`, days counting from the first arrival to the
 * edition's last day, inclusive. Null when the population or the arrival is
 * missing (or the arrival is after the burn ends) — the caller then shows
 * "Add your population and first arrival to see a rough estimate".
 */
export function waterEstimateLitres(input: {
  population: number | null | undefined;
  firstArrivalDate: string | null | undefined;
  editionEndDate: string;
}): WaterEstimate | null {
  const people = input.population;
  if (typeof people !== "number" || !Number.isFinite(people) || people <= 0) {
    return null;
  }
  if (!input.firstArrivalDate) return null;
  const days = inclusiveDays(input.firstArrivalDate, input.editionEndDate);
  if (days === null || days < 1) return null;
  const raw = WATER_LITRES_PER_PERSON_PER_DAY * Math.trunc(people) * days;
  return { litres: Math.round(raw / 5) * 5, people: Math.trunc(people), days };
}

/** "5 L a person a day × 45 people × 9 days". */
export function describeWaterEstimate(w: WaterEstimate): string {
  return `${WATER_LITRES_PER_PERSON_PER_DAY} L a person a day × ${w.people} ${
    w.people === 1 ? "person" : "people"
  } × ${w.days} ${w.days === 1 ? "day" : "days"}`;
}

const THOUSANDS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "2,025 L" — a comma for thousands, as the frames show it. */
export function formatLitres(litres: number): string {
  return `${THOUSANDS.format(litres)} L`;
}

// --- Extinguishers (REG-015 guidance): derived from the layout, never asked ----

/** Theme Camp Safety Checklist: 2 × 4.5 kg DCP per 100 m² of tent. Open
 * point 1: per structure per started 100 m² is used here. */
export const EXTINGUISHER_UNITS_PER_BLOCK = 2;
export const EXTINGUISHER_BLOCK_M2 = 100;
export const EXTINGUISHER_SIZE = "4.5 kg DCP";
/** Generator policy: "a minimum 1.5kg fire extinguisher close by". Open
 * point 1b. */
export const GENERATOR_EXTINGUISHER_UNITS = 1;
export const GENERATOR_EXTINGUISHER_SIZE = "1.5 kg";
/** The fixed line that always goes with the count. */
export const EXTINGUISHER_SERVICE_NOTE =
  "Extinguishers must be serviced. The Safety Officer checks them on site.";
/** The rule in words, for wherever the count is shown. */
export const EXTINGUISHER_RULE_TEXT =
  "2 × 4.5 kg DCP extinguishers for each 100 m², or part of 100 m², of every tent or shade structure, and a 1.5 kg extinguisher by every generator";

/** 2 × ceil(area / 100): a 150 m² stretch tent needs 4. A structure with no
 * area needs none. */
export function extinguishersForStructure(areaM2: number): number {
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return 0;
  // A float area of exactly 100.0000001 from a polygon is still one block:
  // round to the centimetre before taking the ceiling.
  const blocks = Math.ceil(
    Math.round(areaM2 * 100) / 100 / EXTINGUISHER_BLOCK_M2,
  );
  return EXTINGUISHER_UNITS_PER_BLOCK * blocks;
}

export interface ExtinguisherRow {
  objectId: string;
  catalogKey: string;
  /** The camp's label, else "<palette label> <n>". */
  name: string;
  kind: "structure" | "generator";
  /** Rect: width × length; circle: the diameter twice. Metres. */
  width: number;
  length: number;
  shape: "rect" | "circle";
  areaM2: number;
  /** 4.5 kg DCP units for a structure; 0 for a generator. */
  units: number;
  /** 1.5 kg units for a generator; 0 for a structure. */
  generatorUnits: number;
}

export interface ExtinguisherEstimate {
  /** Total 4.5 kg DCP units. */
  units: number;
  /** Total 1.5 kg units, one by each generator. */
  generatorUnits: number;
  structures: number;
  generators: number;
  rows: ExtinguisherRow[];
}

type AnyObject = LayoutObject | NestedLayoutObject;

/**
 * The extinguishers a layout implies. LAYOUT ONLY — it reads nothing else.
 *
 *  - every covered structure (a `nestable` catalogue entry: Bedouin, stretch
 *    tent, dome, gazebo, shade): 2 × 4.5 kg DCP for each 100 m², or part of
 *    100 m², of its footprint;
 *  - every `generator`: 1 × 1.5 kg close by, as its own row.
 *
 * Private tents (`role: "tent"`) are not counted (open point 1). Fuel trailers
 * are not either: their extinguishers belong to the trailer at the depot.
 */
export function extinguisherEstimate(
  doc: LayoutDocument,
  catalog: readonly LayoutCatalogEntry[],
): ExtinguisherEstimate {
  const rows: ExtinguisherRow[] = [];
  const ordinal = new Map<string, number>();

  const visit = (o: AnyObject) => {
    const entry = findCatalogEntry(catalog, o.catalogKey);
    if (!entry) return;
    const isStructure = entry.nestable;
    const isGenerator = entry.key === "generator";
    if (!isStructure && !isGenerator) return;
    const n = (ordinal.get(entry.key) ?? 0) + 1;
    ordinal.set(entry.key, n);
    const label = o.label?.trim();
    const areaM2 = footprintArea(objectFootprint(o));
    const width = o.shape === "circle" ? (o.diameter ?? o.width) : o.width;
    const length = o.shape === "circle" ? (o.diameter ?? o.width) : o.length;
    rows.push({
      objectId: o.id,
      catalogKey: entry.key,
      name: label || `${entry.label} ${n}`,
      kind: isGenerator ? "generator" : "structure",
      width,
      length,
      shape: o.shape,
      areaM2,
      units: isStructure ? extinguishersForStructure(areaM2) : 0,
      generatorUnits: isGenerator ? GENERATOR_EXTINGUISHER_UNITS : 0,
    });
  };

  for (const o of doc.plot.objects) {
    visit(o);
    for (const c of o.child?.objects ?? []) visit(c);
  }

  return {
    units: rows.reduce((s, r) => s + r.units, 0),
    generatorUnits: rows.reduce((s, r) => s + r.generatorUnits, 0),
    structures: rows.filter((r) => r.kind === "structure").length,
    generators: rows.filter((r) => r.kind === "generator").length,
    rows,
  };
}

/** "8 × 4.5 kg DCP and 1 × 1.5 kg by the generator" — the one-line total. */
export function describeExtinguishers(e: ExtinguisherEstimate): string {
  const big = `${e.units} × ${EXTINGUISHER_SIZE}`;
  if (e.generatorUnits === 0) return big;
  const by = e.generators === 1 ? "the generator" : "each generator";
  return `${big} and ${e.generatorUnits} × ${GENERATOR_EXTINGUISHER_SIZE} by ${by}`;
}

// --- The three gates (section 4) ------------------------------------------------

/** The gate answers as stored on the registration (null = not answered). */
export interface SafetyGates {
  s4HasGenerator: boolean | null;
  s4HasFire: boolean | null;
  s4FireKinds: readonly string[] | null;
  s4HasGasOrFuel: boolean | null;
}

/** Fire kinds kept to the known keys, de-duplicated, in the form's order. */
export function cleanFireKinds(raw: readonly unknown[] | null | undefined): FireKind[] {
  if (!raw) return [];
  const set = new Set(raw);
  return FireKindSchema.options.filter((k) => set.has(k));
}

/** G1–G3 answered, and G2a (at least one kind) when G2 is yes. */
export function safetyGatesComplete(g: Partial<SafetyGates>): boolean {
  const answered = (v: boolean | null | undefined) => typeof v === "boolean";
  if (!answered(g.s4HasGenerator)) return false;
  if (!answered(g.s4HasFire)) return false;
  if (!answered(g.s4HasGasOrFuel)) return false;
  if (g.s4HasFire === true && cleanFireKinds(g.s4FireKinds).length === 0) {
    return false;
  }
  return true;
}

/** Answering G2 = No clears the kinds; Yes keeps them. */
export function normalizeFireAnswer(
  hasFire: boolean | null,
  kinds: readonly unknown[] | null | undefined,
): FireKind[] {
  return hasFire === true ? cleanFireKinds(kinds) : [];
}

/** What the layout suggests for each gate. Only ever `true` or absent: the
 * layout never suggests No. */
export interface GateSuggestions {
  generator: boolean;
  fire: boolean;
  /** Fire kinds to tick when the fire suggestion is taken. */
  fireKinds: FireKind[];
  gas: boolean;
}

/**
 * "Derive over ask": a generator, fire pit or gas storage drawn on the layout
 * suggests Yes to its gate. A SUGGESTION, NOT AN ANSWER — nothing is written
 * until the camp saves section 4, and an unsaved gate counts as unanswered.
 */
export function suggestGatesFromLayout(doc: LayoutDocument | null): GateSuggestions {
  const keys = new Set<string>();
  for (const o of doc?.plot.objects ?? []) {
    keys.add(o.catalogKey);
    for (const c of o.child?.objects ?? []) keys.add(c.catalogKey);
  }
  const fire = keys.has("fire-pit");
  return {
    generator: keys.has("generator"),
    fire,
    fireKinds: fire ? ["fire_pit"] : [],
    gas: keys.has("gas-storage"),
  };
}

/**
 * The gates with unsaved suggestions taken — what the wizard writes the first
 * time the camp touches section 4. A saved answer (true OR false) is never
 * touched by the layout.
 */
export function adoptGateSuggestions(
  saved: SafetyGates,
  s: GateSuggestions,
): SafetyGates {
  const fireAdopted = saved.s4HasFire === null && s.fire;
  return {
    s4HasGenerator:
      saved.s4HasGenerator ?? (s.generator ? true : null),
    s4HasFire: saved.s4HasFire ?? (s.fire ? true : null),
    s4FireKinds: fireAdopted
      ? cleanFireKinds([...(saved.s4FireKinds ?? []), ...s.fireKinds])
      : saved.s4FireKinds,
    s4HasGasOrFuel: saved.s4HasGasOrFuel ?? (s.gas ? true : null),
  };
}

// --- The gas & fuel record --------------------------------------------------------

/** Over this much gas goes to the fuel depot (checklist, Theme Camps Guide).
 * Open point 2: the suppliers page says 19 kg. */
export const FUEL_DEPOT_GAS_KG = 90;
/** More than this many 20 L jerry cans goes to the depot (2 × 20 L). Open
 * point 2: the suppliers page says 50 L. */
export const FUEL_DEPOT_JERRY_CANS = 2;
/** The policy's maximum gas per camp — shown as advice, never validated.
 * Open point 2. */
export const GAS_POLICY_MAX_KG = 100;

/** An empty record: no bottles, zeros. The form shows a first-time camp one
 * blank bottle row on top of this; a row with no size chosen is not stored. */
export function emptyGasFuelRecord(): GasFuelRecord {
  return {
    lpg: [],
    jerryCans20l: 0,
    barrels200l: 0,
    fuelTrailers: 0,
    note: "",
  };
}

/** Total kg of LPG across every bottle row. */
export function gasTotalKg(record: Pick<GasFuelRecord, "lpg">): number {
  const kg = record.lpg.reduce((s, r) => s + r.sizeKg * r.count, 0);
  return Math.round(kg * 10) / 10;
}

/**
 * Does this record go to the fuel depot? True when gas > 90 kg, jerry cans
 * > 2 (more than 2 × 20 L), or any 200 L barrel, or any fuel trailer.
 */
export function fuelDepotAdvice(record: GasFuelRecord): boolean {
  return (
    gasTotalKg(record) > FUEL_DEPOT_GAS_KG ||
    record.jerryCans20l > FUEL_DEPOT_JERRY_CANS ||
    record.barrels200l > 0 ||
    record.fuelTrailers > 0
  );
}

/** The reasons, in words, for the inline warning ("96 kg of gas is over
 * 90 kg, and a 200 L barrel always goes to the depot"). Empty within limits. */
export function fuelDepotReasons(record: GasFuelRecord): string[] {
  const out: string[] = [];
  const gas = gasTotalKg(record);
  if (gas > FUEL_DEPOT_GAS_KG) {
    out.push(`${gas} kg of gas is over ${FUEL_DEPOT_GAS_KG} kg`);
  }
  if (record.jerryCans20l > FUEL_DEPOT_JERRY_CANS) {
    out.push(
      `${record.jerryCans20l} × 20 L jerry cans is more than ${FUEL_DEPOT_JERRY_CANS} × 20 L`,
    );
  }
  if (record.barrels200l > 0) {
    out.push(
      record.barrels200l === 1
        ? "a 200 L barrel always goes to the depot"
        : `${record.barrels200l} × 200 L barrels always go to the depot`,
    );
  }
  if (record.fuelTrailers > 0) {
    out.push(
      record.fuelTrailers === 1
        ? "a fuel trailer always goes to the depot"
        : `${record.fuelTrailers} fuel trailers always go to the depot`,
    );
  }
  return out;
}

/** "2 × 48 kg gas (96 kg) · 2 × 20 L jerry cans · 1 × 200 L barrel · no fuel
 * trailers" — the read-only summary for the org review and the section 4
 * line. */
export function describeGasFuelRecord(record: GasFuelRecord): string {
  const rows = record.lpg.filter((r) => r.count > 0);
  const gas =
    rows.length === 0
      ? "no gas"
      : `${rows.map((r) => `${r.count} × ${r.sizeKg} kg`).join(" + ")} gas (${gasTotalKg(record)} kg)`;
  const plural = (n: number, one: string, many: string) =>
    n === 0 ? `no ${many}` : `${n} × ${n === 1 ? one : many}`;
  return [
    gas,
    plural(record.jerryCans20l, "20 L jerry can", "20 L jerry cans"),
    plural(record.barrels200l, "200 L barrel", "200 L barrels"),
    record.fuelTrailers === 0
      ? "no fuel trailers"
      : `${record.fuelTrailers} fuel trailer${record.fuelTrailers === 1 ? "" : "s"}`,
  ].join(" · ");
}

/** A record with empty bottle rows (no size chosen, or zero) dropped — what is
 * stored. */
export function tidyGasFuelRecord(record: GasFuelRecord): GasFuelRecord {
  return {
    ...record,
    lpg: record.lpg.filter((r) => r.count > 0 && r.sizeKg > 0),
    note: record.note.trim(),
  };
}

// --- Who: leads, co-leads and layout planners edit; every member reads ---------

/** Every current member reads the record. Never public. */
export function canViewGasFuelRecord(
  membership: PermissionMembership | null,
): boolean {
  return membership !== null;
}

/** Leads and co-leads (structural lead/admin, irrevocably) and holders of
 * `manage_layout` — the person who plans the build. No new privilege. */
export function canEditGasFuelRecord(
  membership: PermissionMembership | null,
): boolean {
  return (
    membership !== null && hasProjectPermission(membership, "manage_layout")
  );
}

export type GasFuelRefusal =
  | "not_found"
  | "not_editor"
  | "no_registration"
  | "record_exists"
  | "no_source";

const GAS_FUEL_REFUSALS: Record<GasFuelRefusal, string> = {
  not_found: "Camp not found.",
  not_editor:
    "Only leads, co-leads and whoever plans the layout can change this.",
  no_registration:
    "The gas & fuel record belongs to your registration for this edition. Start that first.",
  record_exists: "This camp already has a gas & fuel record for this edition.",
  no_source: "There's no record from an earlier year to start from.",
};

export function gasFuelRefusalMessage(reason: GasFuelRefusal): string {
  return GAS_FUEL_REFUSALS[reason];
}

/** A save: editors only, and only where a registration exists. */
export function decideGasFuelSave(facts: {
  canEdit: boolean;
  hasRegistration: boolean;
}): GasFuelRefusal | null {
  if (!facts.canEdit) return "not_editor";
  if (!facts.hasRegistration) return "no_registration";
  return null;
}

/** "Start from 2026": one click, a DRAFT copy, never over an existing row. */
export function decideStartGasFuelFromLastYear(facts: {
  canEdit: boolean;
  hasRegistration: boolean;
  hasRecord: boolean;
  hasSource: boolean;
}): GasFuelRefusal | null {
  const save = decideGasFuelSave(facts);
  if (save) return save;
  if (facts.hasRecord) return "record_exists";
  if (!facts.hasSource) return "no_source";
  return null;
}

/** Offer "Start from {year}" only to an editor, with no record this edition,
 * and an earlier record to copy. */
export function shouldOfferGasFuelCarryForward(facts: {
  canEdit: boolean;
  hasRecord: boolean;
  hasSource: boolean;
}): boolean {
  return facts.canEdit && !facts.hasRecord && facts.hasSource;
}

/** The copy that goes into the new edition: the data, nothing else. Totals
 * are recomputed; the notice columns start empty because the copy is a
 * draft and sends nothing until saved. */
export function copyGasFuelRecordForNewEdition(
  prior: GasFuelRecord,
): GasFuelRecord {
  return {
    lpg: prior.lpg.map((r) => ({ sizeKg: r.sizeKg, count: r.count })),
    jerryCans20l: prior.jerryCans20l,
    barrels200l: prior.barrels200l,
    fuelTrailers: prior.fuelTrailers,
    note: prior.note,
  };
}

// --- The fuel depot notice: edge-triggered, two copies tracked separately ------

export interface FuelDepotNoticeDecision {
  sendCamp: boolean;
  sendWrangler: boolean;
  /** "set" stamps now, "clear" nulls, "keep" leaves it. */
  campNotifiedAt: "set" | "clear" | "keep";
  wranglerNotifiedAt: "set" | "clear" | "keep";
}

/**
 * What a SAVE of the record does to the notices.
 *
 *  - A draft never sends and never touches the columns.
 *  - Advice false clears both columns, so a later turn back to true sends
 *    again.
 *  - Advice true sends the camp copy when `camp_notified_at` is null (the
 *    edge), and the wrangler copy when a wrangler is assigned and
 *    `wrangler_notified_at` is null. With no wrangler yet the wrangler's copy
 *    waits for the assign action (`shouldSendDeferredWranglerCopy`).
 *
 * Each save is one edge at most: a second save over the limit sends nothing.
 */
export function decideFuelDepotNotice(facts: {
  isDraft: boolean;
  advice: boolean;
  campNotifiedAt: Date | null;
  wranglerNotifiedAt: Date | null;
  wranglerAssigned: boolean;
}): FuelDepotNoticeDecision {
  if (facts.isDraft) {
    return {
      sendCamp: false,
      sendWrangler: false,
      campNotifiedAt: "keep",
      wranglerNotifiedAt: "keep",
    };
  }
  if (!facts.advice) {
    return {
      sendCamp: false,
      sendWrangler: false,
      campNotifiedAt: facts.campNotifiedAt ? "clear" : "keep",
      wranglerNotifiedAt: facts.wranglerNotifiedAt ? "clear" : "keep",
    };
  }
  const sendCamp = facts.campNotifiedAt === null;
  const sendWrangler =
    facts.wranglerAssigned && facts.wranglerNotifiedAt === null;
  return {
    sendCamp,
    sendWrangler,
    campNotifiedAt: sendCamp ? "set" : "keep",
    wranglerNotifiedAt: sendWrangler ? "set" : "keep",
  };
}

/**
 * The deferred wrangler copy, sent by the wrangler ASSIGN action: the camp's
 * SAVED (non-draft) record says depot and this wrangler has not been told. A
 * reassignment to a different wrangler resets `wrangler_notified_at` first,
 * so the new wrangler is told too.
 */
export function shouldSendDeferredWranglerCopy(facts: {
  record: { isDraft: boolean; advice: boolean; wranglerNotifiedAt: Date | null } | null;
  /** True when the assign changed who holds the camp (or nobody did). */
  wranglerChanged: boolean;
}): boolean {
  const r = facts.record;
  if (!r || r.isDraft || !r.advice) return false;
  return facts.wranglerChanged || r.wranglerNotifiedAt === null;
}

/**
 * The in-app notice. Kind `wrangler` (no enum change; it renders with that
 * kind's compass icon), title only, and NO AMOUNTS: they go stale after the
 * next save, and the link opens the current record.
 */
export function fuelDepotNotification(input: {
  side: "camp" | "wrangler";
  campName: string;
  campSlug: string;
  registrationId: string;
  /** The assigned wrangler's name, or null when none is assigned yet. Read
   * only by the camp copy. */
  wranglerName?: string | null;
}): NotificationPayload & { linkApp: "web" | "org" } {
  if (input.side === "wrangler") {
    return {
      kind: "wrangler",
      title: `${input.campName} is over the fuel depot limit — talk to them about how the fuel depot works`,
      body: null,
      link: `/registrations/${input.registrationId}`,
      linkApp: "org",
    };
  }
  return {
    kind: "wrangler",
    title: input.wranglerName
      ? "Your gas and fuel go to the fuel depot — talk to your wrangler about how it works"
      : "Your gas and fuel go to the fuel depot — your wrangler will be told when one is assigned",
    body: null,
    link: `/camps/${input.campSlug}/gas-fuel`,
    linkApp: "web",
  };
}
