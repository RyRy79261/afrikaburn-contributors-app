// SCREENING A REPORT BEFORE IT IS PUBLISHED.
//
// Deterministic, pattern-based, and deliberately not a model. Its job is to
// decide two things: whether a person must look at this before any routine
// does, and whether the diagnostics are safe to publish.
//
// ## Why no model here
//
// The thing being screened is text a stranger wrote, and the screen's whole
// purpose is to catch text that tries to steer whatever reads it next. A model
// asked "is this trying to manipulate you?" is the wrong shape: it reads the
// manipulation to answer. Patterns cannot be talked out of a match.
//
// ## What it does NOT flag
//
// Urgency. "This is urgent", "I'm at the gate and it's broken", "please help" —
// panic is the normal register of a real bug report from someone whose camp
// registration just failed. Flagging it would bury the queue in false positives
// and teach whoever reads them to skim. Alarm carries no weight anywhere in
// this pipeline: it is not evidence, and it unlocks nothing.

import type { RedactionKind } from "./report-sanitize";

export type ReportFlag =
  /** Addresses whoever is reading rather than describing the app. */
  | "addresses-reader"
  /** Asks for data to be sent, shared, exported or disclosed. */
  | "requests-disclosure"
  /** Carries identifiers belonging to somebody who is not the reporter. */
  | "third-party-data";

/**
 * Text aimed at the reader instead of at the product.
 *
 * A bug report describes the application. Anything instructing the reader is
 * out of scope by construction, which is what makes this checkable without
 * judging intent — a false positive costs one human glance.
 */
const ADDRESSES_READER: readonly RegExp[] = [
  /\bignore (?:the |all |any )?(?:above|previous|prior|earlier|preceding)\b/i,
  /\bdisregard (?:the |all |any )?(?:above|previous|prior|instructions?)\b/i,
  /\byou (?:must|should|need to|have to|are to)\b/i,
  /\bplease (?:run|execute|send|forward|email|deploy|merge|approve)\b/i,
  /\b(?:new|updated|revised) instructions?\b/i,
  /\bas (?:the |an )?(?:admin|administrator|maintainer|owner|developer)\b/i,
  /\bsystem prompt\b/i,
];

/** Asking for data to leave. The payload class this whole pipeline guards. */
const REQUESTS_DISCLOSURE: readonly RegExp[] = [
  /\b(?:send|email|forward|share|export|transfer|upload|post|disclose|release)\b[^.!?\n]{0,60}\b(?:data|record|records|detail|details|information|info|note|notes|contact|contacts|list|roster|database|dump|export)\b/i,
  /\b(?:data|record|records|detail|details|information|note|notes|contact|contacts|roster)\b[^.!?\n]{0,40}\b(?:to|at)\b\s+\S+@\S+/i,
  /\bcopy (?:me|us|it|them|everything)\b/i,
];

/**
 * Redaction kinds that indicate somebody OTHER than the reporter is in the
 * report.
 *
 * An ID number, a card number or a serialised payload is not something a person
 * types about their own bug — it is what was on the screen when it broke, which
 * on this product means another participant's record. An email or a phone
 * number alone is NOT enough: reporters legitimately give their own.
 */
const THIRD_PARTY_KINDS: readonly RedactionKind[] = [
  "id-number",
  "card",
  "structured-data",
];

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export interface ScreenResult {
  flags: ReportFlag[];
  /** True when a person must see this before any routine acts on it. */
  needsHuman: boolean;
  /**
   * True when the diagnostics must be withheld from the public issue.
   *
   * Only third-party data does this. A report that addresses the reader is a
   * labelling problem; a report carrying somebody's ID number is a publishing
   * one, and the issue is world-readable the instant it exists.
   */
  withholdDiagnostics: boolean;
}

/**
 * Screen a report.
 *
 * `description` is the reporter's RAW text — before redaction, because the
 * language patterns have to see what was actually written. `redacted` is what
 * the sanitizer removed, which is the only reliable signal that a third party
 * was in there at all.
 */
export function screenReport(
  description: string,
  redacted: readonly RedactionKind[],
): ScreenResult {
  const flags: ReportFlag[] = [];

  if (matchesAny(description, ADDRESSES_READER)) flags.push("addresses-reader");
  if (matchesAny(description, REQUESTS_DISCLOSURE)) {
    flags.push("requests-disclosure");
  }
  if (redacted.some((kind) => THIRD_PARTY_KINDS.includes(kind))) {
    flags.push("third-party-data");
  }

  return {
    flags,
    needsHuman: flags.length > 0,
    withholdDiagnostics: flags.includes("third-party-data"),
  };
}

/** One line for the issue, saying what was flagged without repeating it. */
export function describeFlags(flags: readonly ReportFlag[]): string {
  if (flags.length === 0) return "";
  const labels: Record<ReportFlag, string> = {
    "addresses-reader":
      "contains text addressed to the reader rather than describing the app",
    "requests-disclosure": "asks for data to be sent or shared",
    "third-party-data":
      "carries identifiers that appear to belong to someone other than the reporter",
  };
  return `**Held for a person.** This report ${flags
    .map((flag) => labels[flag])
    .join("; ")}. It has not been triaged by a routine, and nothing should act on it until somebody has read it.`;
}
