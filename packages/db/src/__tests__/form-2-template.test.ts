import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { FORM_2_FIELD_MAP } from "@quagga/core";

// THE CONTRACT BETWEEN THE SEEDED FORM AND THE MIRROR (roadmap M4-20).
//
// Form 2 ships as a questionnaire so AfrikaBurn can release and edit it without
// a deploy, and its answers are mirrored into the registration columns the
// wizard used to write — which is what keeps the sound answer driving a camp's
// required officers, and the review screen's Size panel populated.
//
// That mirror is keyed on QUESTION IDS. Two files therefore have to agree:
// `FORM_2_FIELD_MAP` in @quagga/core, and the seeded `org-theme-camp-form-2-*`
// definition here. They are in different packages and nothing but this test
// makes them move together.
//
// `mapForm2Answers` degrades honestly when they drift — it reports the column as
// unfilled rather than throwing — which is right at runtime and useless as a
// warning, because nobody is reading a field report while authoring a seed. So
// the drift is caught here, at build time, where it is cheap.
//
// A SOURCE ASSERTION, deliberately: seed.ts opens a database connection at
// import, so this reads the file rather than importing it. The seeded ids were
// separately confirmed against a real seeded database.

function seedSource(): string {
  return readFileSync(
    fileURLToPath(new URL("../seed.ts", import.meta.url)),
    "utf8",
  );
}

/** The question ids the Form-2 template declares, in source order. */
function templateQuestionIds(): string[] {
  const src = seedSource();
  const start = src.indexOf("const form2: Questionnaire =");
  expect(
    start,
    "the Form-2 template should still be in seed.ts",
  ).toBeGreaterThan(-1);
  const end = src.indexOf("org-theme-camp-form-2", start);
  const block = src.slice(start, end);
  return (
    [...block.matchAll(/^\s*id: "([a-z0-9_]+)",$/gm)]
      .map((m) => m[1]!)
      // Page ids sit at the same nesting as question ids in the literal; the
      // mirror only knows about questions, and the page ids are not columns.
      .filter((id) => !["size", "fire", "sound_placement"].includes(id))
  );
}

describe("the Form 2 template and the mirror agree", () => {
  it("asks a question for every column the mirror fills", () => {
    const asked = new Set(templateQuestionIds());
    const mapped = Object.keys(FORM_2_FIELD_MAP);
    // A column with no question is a column that can never be filled — the camp
    // is never asked, and the console shows an empty Size panel forever.
    const neverAsked = mapped.filter((id) => !asked.has(id));
    expect(neverAsked).toEqual([]);
  });

  it("maps every question the template asks", () => {
    const asked = templateQuestionIds();
    // A question with no column is an answer that stays in jsonb — legitimate
    // for an extra question the ORG adds later, but never for one shipped in the
    // seed, because the seed's whole job is to fill those columns.
    const unmapped = asked.filter((id) => !(id in FORM_2_FIELD_MAP));
    expect(unmapped).toEqual([]);
  });

  it("names the sound question the mirror expects", () => {
    // Called out on its own because this is the one whose drift is silent AND
    // safety-relevant: `getOfficerStatus` derives a camp's required officers
    // from this column, so a rename means a camp with a full rig owes no sound
    // officer and nothing on any screen says why.
    expect(FORM_2_FIELD_MAP.amplified_music?.column).toBe("s5AmplifiedMusic");
    expect(templateQuestionIds()).toContain("amplified_music");
  });
});

describe("the safety gates (registration-safety-spec)", () => {
  const src = () => {
    const all = seedSource();
    const start = all.indexOf("const form2: Questionnaire =");
    return all.slice(start, all.indexOf("org-theme-camp-form-2", start));
  };

  it("asks the four contract question ids", () => {
    expect(templateQuestionIds()).toEqual(
      expect.arrayContaining([
        "has_generator",
        "has_fire",
        "fire_kinds",
        "has_gas_or_fuel",
      ]),
    );
  });

  it("uses the contract option VALUES yes/no for each gate", () => {
    for (const id of ["has_generator", "has_fire", "has_gas_or_fuel"]) {
      const at = src().indexOf(`id: "${id}"`);
      const block = src().slice(at, src().indexOf("],", at));
      expect(block, id).toContain('value: "yes"');
      expect(block, id).toContain('value: "no"');
    }
  });

  it("branches Yes on fire to the fire-kinds page and No past it", () => {
    const at = src().indexOf('id: "has_fire"');
    const block = src().slice(at, src().indexOf("],", at));
    expect(block).toContain('{ value: "yes", label: "Yes", goTo: "fire" }');
    expect(block).toContain(
      '{ value: "no", label: "No", goTo: "sound_placement" }',
    );
  });

  it("offers fire kinds from the stable keys, not a hand-written list", () => {
    const at = src().indexOf('id: "fire_kinds"');
    const block = src().slice(at, src().indexOf("],", at) + 200);
    expect(block).toContain("FIRE_KINDS.map");
  });
});
