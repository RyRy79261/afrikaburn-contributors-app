// Camp-scoped member reference codes (Ryan, 24 Jul 2026). When a burner joins a
// camp they get a stable per-membership code like `MAH-M017` that the CAMP's own
// treasurer quotes for off-platform EFT reconciliation ("EFT with this reference
// please"). This is CAMP-internal (camper → the camp's own bank account) — NOT an
// AfrikaBurn payment. The platform never touches money; this is only an
// identifier the camp matches on its own bank statement.
//
// Format: `{PREFIX}-M{NNN}` — PREFIX is a 3–4 letter code derived from the camp
// name (same spirit as AB container codes like MAH-1), `M` marks it a member
// reference, NNN is a per-camp zero-padded sequence. Pure + framework-agnostic.

const DIACRITICS = /[̀-ͯ]/g;

/** Letter-only, uppercased word tokens of a name (digits/punctuation split on). */
function letterWords(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
}

/**
 * Derive a camp's base prefix: 3–4 uppercase letters. The first word contributes
 * its first two letters, every later word its first letter (e.g. "Mad Hatters" →
 * "MAH", "The Velvet Mirage" → "THVM"). Single/short names are back-filled from
 * the first word, then padded with X. Empty ⇒ "XXX".
 */
export function deriveCampPrefix(name: string): string {
  const words = letterWords(name);
  const first = words[0];
  if (first === undefined) return "XXX";
  const rest = words.slice(1);
  let code = (
    first.slice(0, 2) + rest.map((w) => w.slice(0, 1)).join("")
  ).slice(0, 4);
  if (code.length < 3) code = (code + first.slice(2)).slice(0, 4);
  while (code.length < 3) code += "X";
  return code;
}

/**
 * Derive a camp prefix that does not collide with any already-taken prefix —
 * deterministic so two similarly-named camps ("Mad Hatters" vs "Mad
 * Haberdashery", both base "MAH") always resolve the same way given the same
 * taken set. Tries the base, then the 3-letter core plus A–Z, then core plus a
 * numeric suffix.
 */
export function disambiguateCampPrefix(
  name: string,
  taken: Iterable<string>,
): string {
  const base = deriveCampPrefix(name);
  const takenSet = new Set([...taken].map((p) => p.toUpperCase()));
  if (!takenSet.has(base)) return base;

  const core = base.slice(0, 3);
  const candidates: string[] = [];
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") candidates.push(core + c);
  for (let n = 2; n <= 999; n++) candidates.push(core + n);
  for (const cand of candidates) {
    if (!takenSet.has(cand)) return cand;
  }
  // Practically unreachable given the candidate space.
  return `${core}${takenSet.size + 1}`;
}

/** Format a member reference code, e.g. `formatMemberRefCode("MAH", 17)` →
 * `"MAH-M017"`. Sequence is 1-based and zero-padded to at least 3 digits. */
export function formatMemberRefCode(prefix: string, sequence: number): string {
  const cleanPrefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleanPrefix === "") {
    throw new Error("Member ref code prefix must contain a letter or digit.");
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Member ref code sequence must be a positive integer.");
  }
  return `${cleanPrefix}-M${String(sequence).padStart(3, "0")}`;
}

const MEMBER_REF_RE = /^([A-Z0-9]{2,8})-M(\d{3,})$/;

/** True when a string is a well-formed member reference code. */
export function isValidMemberRefCode(code: string): boolean {
  return MEMBER_REF_RE.test(code);
}

/** Parse a member reference code into its prefix + sequence, or null if invalid. */
export function parseMemberRefCode(
  code: string,
): { prefix: string; sequence: number } | null {
  const m = MEMBER_REF_RE.exec(code);
  const prefix = m?.[1];
  const seq = m?.[2];
  if (prefix === undefined || seq === undefined) return null;
  return { prefix, sequence: Number(seq) };
}

/**
 * The prefix already established for a camp, read from any existing member code —
 * so every member of a camp shares one stable prefix. Null when the camp has no
 * coded members yet.
 */
export function establishedCampPrefix(
  existingCodes: Iterable<string>,
): string | null {
  for (const code of existingCodes) {
    const parsed = parseMemberRefCode(code);
    if (parsed) return parsed.prefix;
  }
  return null;
}

/** The next per-camp sequence: one past the highest existing sequence (min 1). */
export function nextMemberSequence(existingCodes: Iterable<string>): number {
  let max = 0;
  for (const code of existingCodes) {
    const parsed = parseMemberRefCode(code);
    if (parsed && parsed.sequence > max) max = parsed.sequence;
  }
  return max + 1;
}
