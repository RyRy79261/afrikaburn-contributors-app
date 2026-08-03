// REDACTING A BUG REPORT BEFORE IT BECOMES A PUBLIC GITHUB ISSUE.
//
// The in-app reporter lets someone file a bug without leaving the app, with
// recent client errors attached. Those issues are created in a PUBLIC
// repository: world-readable the instant they exist, indexed, and with an edit
// history that survives redaction. Deleting a leaked comment does not unpublish
// it.
//
// ## Why this is stricter than the version it was ported from
//
// Adapted from RyRy79261/intake-tracker, where the same feature files the same
// kind of issue. The difference is whose data is at risk. There, a leak exposes
// the author's own health data to the author. Here, the person filing is
// looking at OTHER PEOPLE: a camp lead reporting "the roster looks wrong" is on
// a screen listing members' phone numbers, emergency contacts and medical
// notes, and the error in their console may well contain the payload that
// rendered it.
//
// So this adds, beyond the original's email/phone/ID/card patterns:
//
//   · SOUTH AFRICAN LOCAL PHONE FORMATS. The original catches `0821234567` and
//     `082-123-4567` but not `082 123 4567`, which is how South Africans
//     actually write them — and this product's users are almost entirely South
//     African. That gap was the whole reason to review the patterns rather than
//     copy them.
//   · UUIDs, which are how this schema names people, camps and registrations.
//   · Our own reference codes (`MAH-M017`, `SUP-2027-0416`).
//   · JSON-SHAPED FRAGMENTS. The highest-risk payload is not a phone number in
//     prose; it is a serialised bio or roster inside an error message. No
//     pattern can catch a person's NAME or a free-text medical note, so the
//     structure carrying them is removed wholesale.
//
// ## What this cannot do
//
// Redaction is pattern-matching, and pattern-matching fails open: anything it
// does not recognise passes through. It is a second line, not the first. The
// first is collecting little enough that there is not much to leak — see the
// route's diagnostics caps — and the third is that a human reads the issue.
//
// Never present this as "the report is anonymised". It is "we removed what we
// could recognise".

/** What a redaction replaced, for the placeholders that appear in output. */
export type RedactionKind =
  | "email"
  | "phone"
  | "id-number"
  | "card"
  | "date"
  | "uuid"
  | "ref-code"
  | "structured-data";

export interface RedactionResult {
  text: string;
  /** Which kinds were found, for an honest "we removed X" note on the issue. */
  redacted: RedactionKind[];
}

/**
 * ORDER MATTERS and is not arbitrary.
 *
 * Structured data goes first: a JSON blob may contain every other pattern, and
 * removing the blob whole is better than leaving a shredded husk of `[email]`
 * placeholders that still reveals the shape of what was there.
 *
 * Then the longest, most specific numeric patterns before the shorter ones — a
 * 13-digit SA ID would otherwise be partly eaten by the phone rule and escape
 * as `[phone]3`, which is both wrong and still leaks three digits.
 */
const RULES: readonly { kind: RedactionKind; pattern: RegExp; to: string }[] = [
  // A JSON object or array of any size. Bounded repetition rather than a greedy
  // `.*` so a pathological input cannot backtrack quadratically.
  {
    kind: "structured-data",
    pattern: /[[{][^[\]{}]{0,4000}[\]}]/g,
    to: "[structured data removed]",
  },
  {
    kind: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    to: "[email]",
  },
  // South African ID: 13 consecutive digits. BEFORE any phone rule.
  { kind: "id-number", pattern: /\b\d{13}\b/g, to: "[id-number]" },
  {
    kind: "card",
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    to: "[card]",
  },
  // International: +27 82 123 4567, +49-123-4567890.
  //
  // Consumes the WHOLE number. The narrower three-group form this was ported
  // from stopped after `+27 82 123` and left ` 4567` behind — redacting a phone
  // number down to its last four digits is not redacting it.
  {
    kind: "phone",
    pattern: /\+\d[\d\s.()-]{5,18}\d/g,
    to: "[phone]",
  },
  // SOUTH AFRICAN LOCAL: 082 123 4567 / 082-123-4567 / 0821234567.
  // The space-separated form is the common written one and the original missed
  // it entirely.
  {
    kind: "phone",
    pattern: /\b0\d{2}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    to: "[phone]",
  },
  // Generic 3-3-4, for anything written the American way.
  { kind: "phone", pattern: /\b\d{3}[-.]\d{3}[-.]\d{4}\b/g, to: "[phone]" },
  {
    kind: "uuid",
    pattern:
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    to: "[id]",
  },
  // Supplier codes (SUP-2027-0416) BEFORE the generic form: the generic pattern
  // matches `SUP-2027` and would leave `-0416` dangling — a partial redaction
  // that still publishes the sequence.
  { kind: "ref-code", pattern: /\bSUP-\d{4}-\d{3,5}\b/g, to: "[ref]" },
  // Member ref codes (MAH-M017).
  { kind: "ref-code", pattern: /\b[A-Z]{2,4}-[A-Z]?\d{3,4}\b/g, to: "[ref]" },
  // Dates, which in this product are usually a date of birth or an arrival.
  { kind: "date", pattern: /\b\d{4}-\d{2}-\d{2}\b/g, to: "[date]" },
  { kind: "date", pattern: /\b\d{2}\/\d{2}\/\d{4}\b/g, to: "[date]" },
];

/**
 * Strip markup with a single linear scan.
 *
 * Deliberately not `replace(/<[^>]*>/g, "")`: that backtracks quadratically on
 * input like `<<<<…` and leaves unterminated tags such as `<script` behind.
 * Kept from the original, where CodeQL flagged exactly that.
 */
function stripMarkup(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, lt);
    const gt = text.indexOf(">", lt + 1);
    if (gt === -1) break; // unterminated tag — drop the remainder
    i = gt + 1;
  }
  return out;
}

/**
 * Redact a free-text field bound for a public issue.
 *
 * Keeps newlines (stack traces and log excerpts need them) and reports what it
 * removed, so the issue can say so plainly instead of implying the report was
 * clean.
 */
export function sanitizeReportText(
  input: string,
  maxLength = 8000,
): RedactionResult {
  if (typeof input !== "string" || input.length === 0) {
    return { text: "", redacted: [] };
  }

  let text = stripMarkup(input);
  const found = new Set<RedactionKind>();

  for (const rule of RULES) {
    // `pattern` carries /g, so reset lastIndex — a shared regex is stateful and
    // reusing it across calls otherwise skips matches non-deterministically.
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) {
      found.add(rule.kind);
      rule.pattern.lastIndex = 0;
      text = text.replace(rule.pattern, rule.to);
    }
  }

  return {
    text: text.trim().slice(0, maxLength),
    redacted: [...found],
  };
}

/**
 * One honest sentence about what was stripped, for the bottom of the issue.
 *
 * Says "recognised and removed", never "anonymised" — the difference is the
 * whole point, and someone reading the issue should know redaction was
 * best-effort rather than assume the report is safe to quote.
 */
export function describeRedactions(kinds: readonly RedactionKind[]): string {
  if (kinds.length === 0) {
    return "No personal data was recognised in this report. That is not a guarantee none is present — redaction is pattern-based.";
  }
  const labels: Record<RedactionKind, string> = {
    email: "email addresses",
    phone: "phone numbers",
    "id-number": "ID numbers",
    card: "card numbers",
    date: "dates",
    uuid: "internal ids",
    "ref-code": "reference codes",
    "structured-data": "structured data (JSON fragments)",
  };
  const list = kinds.map((k) => labels[k]).join(", ");
  return `Recognised and removed before filing: ${list}. Redaction is pattern-based and fails open — treat anything here as potentially still sensitive.`;
}
