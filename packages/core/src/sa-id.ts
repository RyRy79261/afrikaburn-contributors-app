// South African ID number checksum (issue #32).
//
// A South African ID number is 13 digits, the last of which is a Luhn check
// digit over the first twelve. Checking it catches the typos that matter here —
// one digit wrong, two neighbours swapped — at the moment the burner can still
// fix them, rather than at the gate.
//
// ONLY WHEN THE BURNER SAYS IT IS AN SA ID. A passport number has no such
// digit, so the check keys on the document type they picked, never on the
// shape of the number.
//
// DELIBERATELY NOT CHECKED: the date of birth (digits 1–6) and the citizenship
// digit. Both are rules about how numbers are ISSUED, and a rule we get wrong
// refuses a real person's real ID, with no way round it on a form they must
// finish. The checksum is arithmetic: every issued number satisfies it.

/** The digits of an SA ID as typed, without the spaces people group it with. */
export function normaliseSaIdNumber(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

/** Luhn check over a digit string: true when its final digit checks out. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** True when `raw` is 13 digits (spaces and hyphens allowed) with a valid check digit. */
export function isValidSaIdNumber(raw: string): boolean {
  const digits = normaliseSaIdNumber(raw);
  return /^\d{13}$/.test(digits) && passesLuhn(digits);
}

export const SA_ID_LENGTH_ERROR =
  "A South African ID number is 13 digits. Check it against your ID document.";
export const SA_ID_CHECKSUM_ERROR =
  "That isn't a valid South African ID number — a digit may be mistyped. Check it against your ID document.";

/**
 * The error to show against the document number, or `null` when there is
 * nothing to say. Only an SA ID is checked; a blank number is not an error
 * (the identity document is optional).
 */
export function saIdNumberError(
  idType: string | null | undefined,
  idNumber: string | null | undefined,
): string | null {
  if (idType !== "sa_id") return null;
  const raw = (idNumber ?? "").trim();
  if (raw === "") return null;
  if (!/^\d{13}$/.test(normaliseSaIdNumber(raw))) return SA_ID_LENGTH_ERROR;
  return isValidSaIdNumber(raw) ? null : SA_ID_CHECKSUM_ERROR;
}
