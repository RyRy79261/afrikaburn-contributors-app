// Supplier reference codes — `SUP-2027-0416` (the canvas chip).
//
// A supplier's human-quotable identifier: the number the Supplier Depot reads off
// a gate list, a camp quotes on a delivery request, and the supplier writes on
// their own paperwork.
//
// STORED, NOT DERIVED — the decision, and why:
//   * The code leaves the platform. Once it is on a printed depot list or in a
//     supplier's email, it is a promise. A derived code re-keys itself silently
//     whenever an input moves — a business renames itself, the sheet re-imports
//     in a different order, a row is inserted — and the promise breaks with no
//     migration and no audit trail.
//   * There is nothing stable to derive a sequence FROM. Suppliers are not
//     edition-scoped (one `suppliers` row spans years) and carry no per-edition
//     ordinal, so any derivation would have to invent an ordering — i.e. depend
//     on row order, the least stable thing in the database.
//   * `suppliers.code` is UNIQUE, so the database enforces what a derivation only
//     hopes for.
// Compare `memberships.ref_code` (`MAH-M017`), which is stored for the same
// reason. The format is DETERMINISTIC given (year, sequence); only the sequence
// allocation touches the database.
//
// Format: `SUP-{YYYY}-{NNNN}`
//   `SUP`  — fixed prefix, so the code is self-describing out of context.
//   `YYYY` — the edition year the supplier was first issued a code in.
//   `NNNN` — zero-padded issuance sequence within that year, from 1.

/** The fixed prefix every supplier code carries. */
export const SUPPLIER_CODE_PREFIX = "SUP";

/** Minimum digits in the sequence segment (wider sequences keep their width). */
export const SUPPLIER_CODE_SEQUENCE_PAD = 4;

const SUPPLIER_CODE_RE = /^SUP-(\d{4})-(\d{4,})$/;

/**
 * Format a supplier code. `formatSupplierCode(2027, 416)` → `"SUP-2027-0416"`.
 * Throws on inputs that cannot produce a well-formed code — an invalid code must
 * never reach storage, where the unique constraint would enshrine it.
 */
export function formatSupplierCode(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error("Supplier code year must be a four-digit year.");
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Supplier code sequence must be a positive integer.");
  }
  return `${SUPPLIER_CODE_PREFIX}-${year}-${String(sequence).padStart(
    SUPPLIER_CODE_SEQUENCE_PAD,
    "0",
  )}`;
}

/** True when a string is a well-formed supplier code. */
export function isValidSupplierCode(code: string): boolean {
  return SUPPLIER_CODE_RE.test(code);
}

/** Parse a supplier code into year + sequence, or null when malformed. */
export function parseSupplierCode(
  code: string,
): { year: number; sequence: number } | null {
  const m = SUPPLIER_CODE_RE.exec(code.trim());
  const year = m?.[1];
  const sequence = m?.[2];
  if (year === undefined || sequence === undefined) return null;
  return { year: Number(year), sequence: Number(sequence) };
}

/**
 * The next sequence to issue for `year`: one past the highest already issued in
 * that year (so 1 when the year is fresh). Codes from other years are ignored,
 * and unparseable values are skipped rather than throwing — a legacy or
 * hand-entered value must not be able to stall issuance.
 */
export function nextSupplierSequence(
  year: number,
  existingCodes: Iterable<string | null | undefined>,
): number {
  let max = 0;
  for (const code of existingCodes) {
    if (!code) continue;
    const parsed = parseSupplierCode(code);
    if (parsed && parsed.year === year && parsed.sequence > max) {
      max = parsed.sequence;
    }
  }
  return max + 1;
}

/**
 * Issue the next code for a year given the codes already in use. Deterministic:
 * the same year and the same set always yield the same code, which is what makes
 * a retried insert idempotent rather than a gap-maker.
 */
export function issueSupplierCode(
  year: number,
  existingCodes: Iterable<string | null | undefined>,
): string {
  return formatSupplierCode(year, nextSupplierSequence(year, existingCodes));
}
