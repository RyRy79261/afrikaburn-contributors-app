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

import type { SupplierImportRow, VettingStatus } from "@quagga/types";

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

/** Map the sheet's free-text "Status" column to our vetting-status enum. */
function mapVettingStatus(status: string): VettingStatus {
  return status.trim() === "" ? "listed" : "registered";
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
    const name = cell(block[0], 0);
    if (!name) continue;

    const status = cell(block[0], 2);
    const contactPerson = cell(block[0], 1);

    const categories = new Set<string>();
    const emails: string[] = [];
    const notes: string[] = [];

    for (const r of block) {
      const category = cell(r, 3);
      if (category) categories.add(category);

      const note = cell(r, 7);
      if (note && note !== " ") notes.push(note);
    }

    // Contact-column lines after the first row: keep emails, drop phone
    // numbers and free-text addresses (privacy scrub).
    for (let i = 0; i < block.length; i++) {
      const raw = cell(block[i], 1);
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
    if (categories.size > 0) {
      servicesParts.push([...categories].join(" / "));
    }
    if (notes.length > 0) {
      servicesParts.push(notes.join("; "));
    }

    out.push({
      name,
      services: servicesParts.join(" — "),
      contact: contactParts.join(" "),
      website: "",
      vettingStatus: mapVettingStatus(status),
    });
  }

  return out;
}
