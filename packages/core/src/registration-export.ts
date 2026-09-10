// Placement export (roadmap R1: "Registration hardening: validation ... export
// for placement").
//
// WHAT THIS IS FOR. Placement happens off-platform — a room, a printed map, and
// the people who decide which camp goes where (App Spec §13 is blocked on
// AfrikaBurn's own mapping process). Those people need one table of every
// registered camp with the numbers that drive the decision. That is this file.
//
// WHAT IS DELIBERATELY NOT IN IT. No phone numbers, no ID numbers, no emergency
// contacts, no medical notes, no alternate-contact block. A placement
// spreadsheet gets mailed around, opened on personal laptops and left in
// downloads folders; it is the single worst container for hard-locked personal
// data this codebase holds, and none of it helps anyone decide where a camp
// goes. The one contact column is the registration's own contact email, which is
// the address AfrikaBurn already corresponds with about this registration.
//
// Keep this list honest: if a column is not used to place a camp, it does not
// belong in the export.

/** One row of the placement export — already flattened, already safe to write. */
export interface PlacementExportRow {
  campName: string;
  campCode: string | null;
  erf: string | null;
  status: string;
  categories?: readonly string[] | null;
  contactEmail: string | null;
  expectedPopulation: number | null;
  areaDimensions: string | null;
  workAccessPasses: number | null;
  firstArrivalDate: string | null;
  amplifiedMusic: string | null;
  placementFirstChoice: string | null;
  placementSecondChoice: string | null;
  neighbourRequest: string | null;
  familyFriendly: string | null;
  wranglerName: string | null;
  submittedAt: Date | string | null;
}

interface Column {
  header: string;
  value: (row: PlacementExportRow) => unknown;
}

/** The export's columns, in the order placement reads them. */
const COLUMNS: readonly Column[] = [
  { header: "Camp", value: (r) => r.campName },
  { header: "Camp code", value: (r) => r.campCode },
  { header: "Erf", value: (r) => r.erf },
  { header: "Status", value: (r) => r.status },
  { header: "Categories", value: (r) => r.categories?.join("; ") ?? null },
  { header: "Expected population", value: (r) => r.expectedPopulation },
  { header: "Area dimensions", value: (r) => r.areaDimensions },
  { header: "Work Access Passes", value: (r) => r.workAccessPasses },
  { header: "First arrival", value: (r) => r.firstArrivalDate },
  { header: "Amplified sound", value: (r) => r.amplifiedMusic },
  { header: "Placement 1st choice", value: (r) => r.placementFirstChoice },
  { header: "Placement 2nd choice", value: (r) => r.placementSecondChoice },
  { header: "Neighbour request", value: (r) => r.neighbourRequest },
  { header: "Family friendly", value: (r) => r.familyFriendly },
  { header: "Wrangler", value: (r) => r.wranglerName },
  { header: "Contact email", value: (r) => r.contactEmail },
  { header: "Submitted", value: (r) => r.submittedAt },
];

/** The export's header row, exposed so tests can assert against one list. */
export const PLACEMENT_EXPORT_HEADERS: readonly string[] = COLUMNS.map(
  (c) => c.header,
);

/** ISO date (no time) — placement cares about the day, not the second. */
function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return date.toISOString().slice(0, 10);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Escape one CSV field.
 *
 * FORMULA INJECTION IS THE REASON THIS IS NOT `JSON.stringify`. A camp is free to
 * name itself `=cmd|' /c calc'!A0`, and Excel will happily treat a leading `=`,
 * `+`, `-` or `@` as a formula the moment a placement volunteer opens the file.
 * Prefixing a single quote neutralises it while still displaying the text — the
 * standard mitigation, applied here because this export is built from strings
 * typed by the public.
 */
export function escapeCsvField(value: unknown): string {
  const raw = formatValue(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** UTF-8 byte-order mark, as an escape \u2014 the literal character is invisible in
 * source and the linter rejects it as irregular whitespace. */
export const CSV_BOM = "\ufeff";

/**
 * Render the placement export as CSV text.
 *
 * CRLF line endings and a UTF-8 BOM, because the consumer is Excel on someone's
 * laptop: without the BOM a camp called "Kraaifontein Kombuis" arrives mojibaked,
 * and that is the kind of detail that gets a tool abandoned.
 */
export function buildPlacementCsv(rows: readonly PlacementExportRow[]): string {
  const lines = [
    PLACEMENT_EXPORT_HEADERS.map(escapeCsvField).join(","),
    ...rows.map((row) =>
      COLUMNS.map((col) => escapeCsvField(col.value(row))).join(","),
    ),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** The download filename, e.g. `afrikaburn-2027-placement-2026-08-12.csv`. */
export function placementCsvFilename(year: number, today: Date | string): string {
  return `afrikaburn-${year}-placement-${formatDate(today)}.csv`;
}
