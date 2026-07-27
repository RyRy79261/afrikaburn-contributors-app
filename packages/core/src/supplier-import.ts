// AB public Suppliers List CSV → JSON import parser (build-spec §Seeds,
// §Core logic "supplier CSV→JSON import parser"). PURE — no fetch, no I/O; the
// caller (a one-off fetch script) hands in the raw CSV text, this module turns
// it into `SupplierImportRow[]` for `packages/db/src/data/suppliers.json`.
//
// Sheet shape (as exported): AfrikaBurn tracks each supplier as a small
// MERGED-CELL block rather than one-row-per-supplier. Column A (name) and
// column C (status) are only populated on the block's first physical row;
// column B (contact) carries the contact PERSON's name on the first row, then
// one phone/email/address per subsequent row; column D (category) sometimes
// continues on a second row; column H occasionally carries a free-text note
// (e.g. "Transporting of:", "Tankwa local farmer"). A blank column-A cell
// means "still the previous supplier".
//
// Privacy: this parser deliberately DROPS phone numbers and free-text
// addresses from column B — build-spec requires scrubbing personal
// cell-phone numbers of individuals; only the business name, the contact
// person's NAME, and business email are retained.

import type {
  SupplierImportRow,
  SupplierOnboardingStepKey,
  SupplierOnboardingSteps,
  SupplierReturning,
  SupplierStanding,
} from "@quagga/types";

/**
 * Minimal RFC4180-ish CSV parser: handles quoted fields, doubled `""`
 * escapes, and embedded newlines inside quotes (AfrikaBurn's header row wraps
 * across physical lines this way). No external dependency.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Normalise CRLF up front so we don't have to special-case \r.
  const src = text.replace(/\r\n/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // Flush a trailing field/row that wasn't newline-terminated.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Phone-ish: digits with optional +, spaces, dashes, parens, dots — and
// nothing else (an address line always has letters/newlines, so it never
// matches this).
const PHONE_RE = /^[+\d][\d\s().+-]{5,}$/;

function cell(row: string[] | undefined, index: number): string {
  return (row?.[index] ?? "").trim();
}

// Column indices in the real AfrikaBurn Suppliers List export.
const COL_NAME = 0;
const COL_CONTACT = 1;
const COL_STATUS = 2;
const COL_CATEGORY = 3;
const COL_RETURNING = 4;
const COL_FEE_PHRASE = 5;
const COL_FEE_FLAG = 6;
const COL_NOTE = 7;

/** Map the sheet "Status" column to a supplier standing. Blank / unknown →
 * `good` (imported rows are listed, not judged, unless the sheet says otherwise). */
export function mapStatusToStanding(raw: string): SupplierStanding {
  switch (raw.trim().toLowerCase()) {
    case "in good standing":
      return "good";
    case "diligent first timer":
      return "diligent_first_timer";
    case "able & willing to adapt":
      return "adapting";
    case "absolute beginners":
    case "absolute beginner":
      return "absolute_beginner";
    default:
      return "good";
  }
}

/** Map the sheet "Returning Supplier?" column. Blank / unknown → null. */
export function mapReturning(raw: string): SupplierReturning | null {
  switch (raw.trim().toLowerCase()) {
    case "yes":
      return "returning";
    case "newbie":
      return "newbie";
    default:
      return null;
  }
}

/**
 * The service categories a supplier can pick when self-registering.
 *
 * Values are already in `normalizeCategory`'s output shape, so a self-registered
 * supplier and a sheet-imported one land in the same bucket. Lives here rather
 * than in a form component because BOTH supplier registration surfaces need it
 * (the sign-up screen and the "we couldn't match you" recovery form), and a
 * second hand-maintained copy would drift the moment one of them changed.
 */
export const SUPPLIER_SERVICE_CATEGORIES = [
  "Stretch Tents",
  "Transport",
  "Generators/Power Supply",
  "Firewood Delivery",
  "Sound & Lighting",
  "Water Delivery",
  "Ice Delivery",
  "Other",
] as const;

export type SupplierServiceCategory =
  (typeof SUPPLIER_SERVICE_CATEGORIES)[number];

/**
 * Normalise a raw Category cell: special-case Transportation→Transport and
 * FIREWOOD DELIVERY→Firewood Delivery, otherwise Title-Case each alphabetic
 * run (leaving separators like `/` and `&` intact). Blank → "".
 */
export function normalizeCategory(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower === "transportation" || lower === "transport") return "Transport";
  if (lower === "firewood delivery") return "Firewood Delivery";
  return trimmed.replace(
    /[a-zA-Z]+/g,
    (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase(),
  );
}

/** Map a fees/crew-pass progress phrase to the onboarding step it satisfies. */
export function feePhraseToStepKey(
  raw: string,
): SupplierOnboardingStepKey | null {
  switch (raw.trim().toLowerCase()) {
    case "refundable deposit paid":
      return "deposit_paid";
    case "supplier contract signed":
      return "agreement_signed";
    case "inventory log submitted":
      return "inventory_submitted";
    case "crew passes purchased":
      return "crew_details_submitted";
    case "supplier registration fee paid":
      return "registration_fee_paid";
    default:
      return null;
  }
}

/** True for the sheet's truthy flag column (a phrase marked done). */
function isTrueFlag(raw: string): boolean {
  return raw.trim().toLowerCase() === "true";
}

/**
 * Parse AfrikaBurn's public Suppliers List CSV export into normalised
 * `SupplierImportRow`s. Blank names, and the trailing "notes" rows Google
 * Sheets sometimes leaves as CSV padding, are skipped.
 */
export function parseSuppliersCsv(csvText: string): SupplierImportRow[] {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return [];

  // Header spans the sheet's first logical row (possibly multiple physical
  // lines due to embedded newlines, which parseCsv already folds into one
  // row). Everything after it is data.
  const dataRows = rows.slice(1);

  const blocks: string[][][] = [];
  let current: string[][] | null = null;

  for (const r of dataRows) {
    if (cell(r, 0) !== "") {
      current = [r];
      blocks.push(current);
    } else if (current) {
      current.push(r);
    }
    // Rows before any block starts (shouldn't happen) are ignored.
  }

  const out: SupplierImportRow[] = [];

  for (const block of blocks) {
    const name = cell(block[0], COL_NAME);
    if (!name) continue;

    const contactPerson = cell(block[0], COL_CONTACT);

    // Status/Returning live on the block's first physical row.
    const standing = mapStatusToStanding(cell(block[0], COL_STATUS));
    const returning = mapReturning(cell(block[0], COL_RETURNING));

    const rawCategories = new Set<string>();
    const normalizedCategories = new Set<string>();
    const emails: string[] = [];
    const notes: string[] = [];
    const onboarding: SupplierOnboardingSteps = {};

    for (const r of block) {
      const category = cell(r, COL_CATEGORY);
      if (category) {
        rawCategories.add(category);
        const normalized = normalizeCategory(category);
        if (normalized) normalizedCategories.add(normalized);
      }

      const note = cell(r, COL_NOTE);
      if (note && note !== " ") notes.push(note);

      // Fees/crew-pass progress phrase → onboarding step. A phrase marked TRUE
      // pre-populates its step as completed (deposit/fee are org-confirmed
      // steps, which is exactly what "…paid" on the sheet already implies).
      const stepKey = feePhraseToStepKey(cell(r, COL_FEE_PHRASE));
      if (stepKey && isTrueFlag(cell(r, COL_FEE_FLAG))) {
        onboarding[stepKey] = "completed";
      }
    }

    // Contact-column lines after the first row: keep emails, drop phone
    // numbers and free-text addresses (privacy scrub).
    for (let i = 0; i < block.length; i++) {
      const raw = cell(block[i], COL_CONTACT);
      if (i === 0 || !raw) continue;
      if (EMAIL_RE.test(raw)) {
        emails.push(raw);
      }
      // Anything else (phone number, postal address) is intentionally
      // dropped — never retained, even transiently.
      void PHONE_RE; // documents the recognised-but-dropped shape
    }

    const contactParts: string[] = [];
    if (contactPerson) contactParts.push(contactPerson);
    if (emails.length > 0) contactParts.push(emails.join(", "));

    const servicesParts: string[] = [];
    if (rawCategories.size > 0) {
      servicesParts.push([...rawCategories].join(" / "));
    }
    if (notes.length > 0) {
      servicesParts.push(notes.join("; "));
    }

    out.push({
      name,
      services: servicesParts.join(" — "),
      contact: contactParts.join(" "),
      website: "",
      category: [...normalizedCategories].join(" / "),
      returning,
      standing,
      onboarding,
    });
  }

  return out;
}
