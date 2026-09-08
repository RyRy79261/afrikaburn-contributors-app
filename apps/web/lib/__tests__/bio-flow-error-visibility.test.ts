import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildBurnerBioQuestionnaire } from "@quagga/core";
import { flattenQuestions } from "@quagga/types";

// NOTHING THE SERVER REFUSES MAY BE SILENT.
//
// `saveBio` validates EVERY question in the Burner Bio questionnaire and
// returns errors keyed by question id. `bio-flow.tsx` rendered exactly one of
// them — `username` — plus the two form-level keys. Every other refusal set
// state that nothing drew: 1000 characters of medical notes, a 41-character ID
// number, a malformed emergency-contact phone, an impossible attended year. The
// burner pressed "Save & continue", the page did not move, and no text on
// screen changed. That is the same report this branch started from ("the button
// does nothing"), reached by a different route — and PR #28's scroll-to-the-
// first-error made it worse, not better: the page now jumps to a field that
// still says nothing about why it was refused.
//
// It is not only fields the burner can see. `initialResponses` prefills from
// the stored bio and the whole map is posted back on every save, so a stored
// `bio`, `skills`, `firstTime` or `contactEmail` — none of which the flow
// renders a control for — round-trips through the same validation. A row whose
// `about` text predates the 1500-character cap refuses every save the burner
// attempts, for ever, with nothing on screen to explain it.
//
// WHY A SOURCE ASSERTION AND NOT A COMPONENT TEST. `apps/web/vitest.config.ts`
// is `environment: "node"` with `include: ["lib/**/__tests__/**/*.test.ts"]`,
// and the workspace carries neither jsdom nor @testing-library — a test
// mounting `BioFlow` would not be collected. The behavioural half belongs in
// the new-burner persona suite, where a real browser can paste 1200 characters
// of medical notes and read the refusal off the screen; that spec is in
// `e2e/specs/new-burner/burner-bio.spec.ts`. This pins the structure that spec
// cannot: that the wiring covers EVERY question, not the two the spec types
// into.

const FLOW = readFileSync(
  fileURLToPath(new URL("../../components/onboarding/bio-flow.tsx", import.meta.url)),
  "utf8",
);

const QUESTION_IDS = new Set(
  flattenQuestions(buildBurnerBioQuestionnaire()).map((q) => q.id),
);

/** The ids listed in `DETAILS_INLINE_ERROR_IDS`, read out of the source. */
function inlineIds(): string[] {
  const start = FLOW.indexOf("const DETAILS_INLINE_ERROR_IDS");
  expect(start, "the inline-error id set still exists").toBeGreaterThan(-1);
  const literal = FLOW.slice(start, FLOW.indexOf("]);", start));
  const ids = [...literal.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
  // The username sits in the set as the shared constant, not a literal.
  if (literal.includes("USERNAME_QUESTION_ID")) ids.push("username");
  return ids;
}

/** Everything handed to a `fieldError(…)` call — i.e. actually drawn beside a
 *  control by the details step. */
function drawnIds(): Set<string> {
  const out = new Set<string>();
  for (const call of FLOW.matchAll(/fieldError\(([^)]*)\)/g)) {
    for (const m of (call[1] ?? "").matchAll(/"([^"]+)"/g)) out.add(m[1] as string);
  }
  return out;
}

/** Question ids the details step renders a control with an `id` for. */
function controlIds(): Set<string> {
  const step = FLOW.slice(FLOW.indexOf("function DetailsStep("));
  const out = new Set<string>();
  for (const m of step.matchAll(/\bid="([A-Za-z_.]+)"/g)) {
    if (QUESTION_IDS.has(m[1] as string)) out.add(m[1] as string);
  }
  // The username control is keyed by the imported constant, not a literal.
  if (step.includes("id={USERNAME_QUESTION_ID}")) out.add("username");
  return out;
}

describe("every server refusal reaches the burner's eyes", () => {
  it("draws an inline error for each id it suppresses from the banner", () => {
    // THE FAILURE THIS EXISTS FOR. The banner deliberately skips ids in
    // `DETAILS_INLINE_ERROR_IDS` so a message is not printed twice. An id in
    // that set which no `fieldError(…)` call draws is therefore suppressed from
    // the banner AND absent beside its control — silence again, arrived at by
    // the very mechanism meant to end it.
    const drawn = drawnIds();
    // `username` is drawn by its own `error={errors[USERNAME_QUESTION_ID]}`.
    drawn.add("username");
    for (const id of inlineIds()) {
      expect(drawn, `\`${id}\` is suppressed from the banner`).toContain(id);
    }
  });

  it("suppresses only ids that are real questions", () => {
    for (const id of inlineIds()) {
      expect(QUESTION_IDS, `\`${id}\` is not a bio question`).toContain(id);
    }
  });

  it("gives every on-screen field its own refusal, not the banner", () => {
    // A message about the medical notes box belongs against the medical notes
    // box, not in a list under the buttons several screens below it.
    const inline = new Set(inlineIds());
    for (const id of controlIds()) {
      expect(inline, `\`${id}\` has a control but no inline error`).toContain(id);
    }
  });

  it("keeps a catch-all for questions with no control at all", () => {
    // `bio`, `skills`, `firstTime` and `contactEmail` are validated on every
    // save and rendered nowhere in this flow — they round-trip through
    // `initialResponses`. Without the banner their refusal has no surface.
    const uncontrolled = [...QUESTION_IDS].filter((id) => !controlIds().has(id));
    expect(
      uncontrolled.length,
      "if every question gained a control, the banner would be belt-and-braces",
    ).toBeGreaterThan(0);

    expect(FLOW).toContain("unshownErrors.length > 0 &&");
    expect(FLOW).toContain("unshownErrors.map(([id, message])");
    // It has to announce itself; a burner who has scrolled past does not see a
    // new paragraph appear.
    const banner = FLOW.slice(FLOW.indexOf("{unshownErrors.length > 0 && ("));
    expect(banner.slice(0, 300)).toContain('role="alert"');
  });

  it("subtracts nothing from the banner but the form keys and the inline set", () => {
    const start = FLOW.indexOf("const unshownErrors = Object.entries(errors).filter(");
    expect(start, "the catch-all still derives from every error key").toBeGreaterThan(-1);
    const filter = FLOW.slice(start, FLOW.indexOf("  );", start));

    expect(filter).toContain("NON_FIELD_ERROR_KEYS");
    expect(filter).toContain("DETAILS_INLINE_ERROR_IDS.has(key)");
    // …and the inline set only applies while the details step is on screen: an
    // error on a details field refused during the FINAL save, pressed from the
    // privacy step, has no control on that step to draw it.
    expect(filter).toContain('step === "details" && DETAILS_INLINE_ERROR_IDS.has(key)');
  });

  it("names the field a refusal belongs to", () => {
    // The server's messages are field-agnostic ("Enter a valid phone number").
    // In a list under the buttons, that is not enough to act on.
    expect(FLOW).toContain("QUESTION_PROMPTS.get(id)");
    expect(FLOW).toContain(
      "flattenQuestions(buildBurnerBioQuestionnaire()).map((q) => [q.id, q.prompt])",
    );
  });

  it("speaks for both halves of a two-control field", () => {
    // `onsite.phone` and `offsite.phone` have no id of their own — they share a
    // Field with the name input, and the server refuses them separately.
    expect(FLOW).toContain('fieldError("onsite.name", "onsite.phone")');
    expect(FLOW).toContain('fieldError("offsite.name", "offsite.phone")');
    expect(FLOW).toContain('fieldError("id.type", "id.number")');
    // Both messages, not the first one found.
    expect(FLOW).toContain('found.join(" · ")');
  });
});
