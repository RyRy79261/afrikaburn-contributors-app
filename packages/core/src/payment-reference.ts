// Human-readable payment reference generator (build-spec §Schema `payments`,
// §Core logic). The platform never processes money — a reference like
// `QP-2027-MAH-001` is what AfrikaBurn reconciles against off-platform.

/** Default reference prefix — "Quagga Portal". */
export const PAYMENT_REFERENCE_PREFIX = "QP";

export interface PaymentReferenceParts {
  /** Reference prefix. Defaults to `QP`. */
  prefix?: string;
  /** Edition year, e.g. 2027. */
  year: number;
  /** Short subject code, e.g. a camp code `MAH`. Non-alphanumerics are dropped. */
  code: string;
  /** Monotonic sequence within (year, code). Zero-padded to 3 digits. */
  sequence: number;
}

/**
 * Build a reference of the form `QP-2027-MAH-001`. The code is upper-cased,
 * stripped to A–Z0–9, and capped at 6 chars; the sequence is zero-padded to at
 * least 3 digits (wider for 4+ digit sequences).
 */
export function generatePaymentReference({
  prefix = PAYMENT_REFERENCE_PREFIX,
  year,
  code,
  sequence,
}: PaymentReferenceParts): string {
  const cleanCode = code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  if (cleanCode === "") {
    throw new Error("Payment reference code must contain a letter or digit.");
  }
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error(
      "Payment reference sequence must be a non-negative integer.",
    );
  }
  const seq = String(sequence).padStart(3, "0");
  return `${prefix}-${year}-${cleanCode}-${seq}`;
}

/**
 * Derive a short subject code from a name — the first up-to-3 alphanumeric
 * characters, upper-cased. e.g. "Mad Hatters" → "MAD", "Dusty Prototype" →
 * "DUS". Callers may override with a bespoke code (e.g. an AB-assigned one).
 */
export function deriveSubjectCode(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, 3) || "XXX";
}
