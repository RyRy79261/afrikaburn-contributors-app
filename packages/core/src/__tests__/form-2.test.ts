import { describe, it, expect } from "vitest";

import { FORM_2_COLUMNS, FORM_2_FIELD_MAP, mapForm2Answers } from "../form-2";

// Form 2's answers are mirrored into the registration row (roadmap M4-20),
// because the sound answer is what `getOfficerStatus` derives a camp's required
// officers from, and the review screen, the camp summary and placement all read
// the same typed columns. An answer that stayed in jsonb would be an answer the
// rest of the product cannot act on.
//
// The mapping is editable data — the org authors this questionnaire in the
// console — so the interesting cases here are the ones where the form and the
// map have drifted apart.

function fullAnswers() {
  return {
    expected_population: 45,
    first_arrival_date: "2027-04-22",
    area_dimensions: "20m x 15m",
    layout_diagram: ["https://blob.example/layout.png"],
    has_generator: "yes",
    has_fire: "yes",
    fire_kinds: ["braai_brazier", "gas_cooking_heating"],
    has_gas_or_fuel: "no",
    amplified_music: "Level 1 — Car stereo",
    sound_plan: "Low background music, off during quiet hours.",
    placement_first_choice: "Binnekring — back line",
    family_friendly: "Yes",
  };
}

describe("mapForm2Answers", () => {
  it("fills every column Form 2 owns from a complete response", () => {
    const { columns, unmapped, unfilled } = mapForm2Answers(fullAnswers());

    expect(columns).toEqual({
      s4ExpectedPopulation: 45,
      s4FirstArrivalDate: "2027-04-22",
      s4AreaDimensions: "20m x 15m",
      s4LayoutUploadUrls: ["https://blob.example/layout.png"],
      s4HasGenerator: true,
      s4HasFire: true,
      s4FireKinds: ["braai_brazier", "gas_cooking_heating"],
      s4HasGasOrFuel: false,
      s5AmplifiedMusic: "Level 1 — Car stereo",
      s5SoundPlan: "Low background music, off during quiet hours.",
      s5PlacementFirstChoice: "Binnekring — back line",
      s5FamilyFriendly: "Yes",
    });
    expect(unmapped).toEqual([]);
    expect(unfilled).toEqual([]);
  });

  it("REPORTS a renamed question rather than silently dropping the column", () => {
    // The failure this whole design exists for. An org editing the form renames
    // `amplified_music`; the response still saves, the form still looks right,
    // and without this report the camp believes it declared its sound level
    // while the console believes it never did — and no sound officer is ever
    // required of a camp with a sound system.
    const { amplified_music: _renamed, ...rest } = fullAnswers();
    void _renamed;
    const { columns, unmapped, unfilled } = mapForm2Answers({
      ...rest,
      sound_level: "Level 3 — Full rig",
    });

    expect(columns.s5AmplifiedMusic).toBeUndefined();
    expect(unmapped).toEqual(["sound_level"]);
    expect(unfilled).toEqual(["s5AmplifiedMusic"]);
  });

  it("treats an org's ADDED question as unmapped, not as an error", () => {
    // Authoring extra questions is the point of Form 2 being a questionnaire.
    // They live in the response and simply have no column.
    const { columns, unmapped, unfilled } = mapForm2Answers({
      ...fullAnswers(),
      generator_kva: "6.5",
      moop_plan: "Sweep line twice daily",
    });
    expect(unmapped).toEqual(["generator_kva", "moop_plan"]);
    expect(unfilled).toEqual([]);
    expect(columns.s4ExpectedPopulation).toBe(45);
  });

  it("reports every unanswered column on an empty response", () => {
    const { columns, unmapped, unfilled } = mapForm2Answers({});
    expect(columns).toEqual({});
    expect(unmapped).toEqual([]);
    expect(unfilled).toEqual([...FORM_2_COLUMNS]);
  });

  it("does not write a column for a blank or whitespace answer", () => {
    // "" is what an optional question returns when skipped. Writing it would
    // overwrite a real earlier answer with nothing.
    const { columns, unfilled } = mapForm2Answers({
      ...fullAnswers(),
      sound_plan: "   ",
      area_dimensions: "",
    });
    expect(columns.s5SoundPlan).toBeUndefined();
    expect(columns.s4AreaDimensions).toBeUndefined();
    expect(unfilled).toEqual(["s4AreaDimensions", "s5SoundPlan"]);
  });

  it("trims text answers", () => {
    const { columns } = mapForm2Answers({
      ...fullAnswers(),
      placement_first_choice: "  Binnekring — back line  ",
    });
    expect(columns.s5PlacementFirstChoice).toBe("Binnekring — back line");
  });

  it("accepts a single-select answer delivered as a one-element array", () => {
    const { columns } = mapForm2Answers({
      ...fullAnswers(),
      amplified_music: ["Level 2 — Small PA"],
    });
    expect(columns.s5AmplifiedMusic).toBe("Level 2 — Small PA");
  });

  describe("population", () => {
    it("accepts a numeric string, because a number authored as text is still a number", () => {
      expect(
        mapForm2Answers({ ...fullAnswers(), expected_population: "60" }).columns
          .s4ExpectedPopulation,
      ).toBe(60);
    });

    it("refuses zero, negatives and nonsense rather than writing them", () => {
      for (const bad of [0, -5, "many", "", null, true]) {
        const { columns, unfilled } = mapForm2Answers({
          ...fullAnswers(),
          expected_population: bad as never,
        });
        expect(columns.s4ExpectedPopulation).toBeUndefined();
        expect(unfilled).toContain("s4ExpectedPopulation");
      }
    });

    it("truncates a fractional count — 40.7 people is 40 people", () => {
      expect(
        mapForm2Answers({ ...fullAnswers(), expected_population: 40.7 }).columns
          .s4ExpectedPopulation,
      ).toBe(40);
    });
  });

  describe("the layout diagram", () => {
    it("accepts a bare string as one upload", () => {
      expect(
        mapForm2Answers({
          ...fullAnswers(),
          layout_diagram: "https://blob.example/one.png",
        }).columns.s4LayoutUploadUrls,
      ).toEqual(["https://blob.example/one.png"]);
    });

    it("caps at four, matching the wizard's own limit", () => {
      const six = Array.from({ length: 6 }, (_, i) => `https://b/${i}.png`);
      expect(
        mapForm2Answers({ ...fullAnswers(), layout_diagram: six }).columns
          .s4LayoutUploadUrls,
      ).toHaveLength(4);
    });

    it("drops blanks and non-strings instead of storing them as uploads", () => {
      expect(
        mapForm2Answers({
          ...fullAnswers(),
          layout_diagram: ["  ", "https://b/real.png", ""] as never,
        }).columns.s4LayoutUploadUrls,
      ).toEqual(["https://b/real.png"]);
    });
  });

  it("keeps the field map and the column list in step", () => {
    // FORM_2_COLUMNS is derived from FORM_2_FIELD_MAP, so this pins that they
    // describe the same set and that nothing was added to one alone.
    expect([...FORM_2_COLUMNS].sort()).toEqual(
      Object.values(FORM_2_FIELD_MAP)
        .map((f) => f.column)
        .sort(),
    );
    expect(new Set(FORM_2_COLUMNS).size).toBe(FORM_2_COLUMNS.length);
  });
});

describe("mapForm2Answers — the safety gates (registration-safety-spec)", () => {
  it("parses the contract VALUES yes/no, not labels", () => {
    const { columns, invalid } = mapForm2Answers({
      has_generator: "no",
      has_fire: ["yes"],
      fire_kinds: ["fire_pit"],
      has_gas_or_fuel: "yes",
    });
    expect(columns.s4HasGenerator).toBe(false);
    expect(columns.s4HasFire).toBe(true);
    expect(columns.s4FireKinds).toEqual(["fire_pit"]);
    expect(columns.s4HasGasOrFuel).toBe(true);
    expect(invalid).toEqual([]);
  });

  it("reports an unknown gate value as invalid and fills nothing", () => {
    // A label pasted where the value belongs: "Ja" is a fine LABEL, never a value.
    const { columns, invalid, unfilled } = mapForm2Answers({
      has_generator: "Ja",
    });
    expect(columns.s4HasGenerator).toBeUndefined();
    expect(invalid).toEqual([{ questionId: "has_generator", value: "Ja" }]);
    expect(unfilled).toContain("s4HasGenerator");
  });

  it("keeps known fire kinds and reports an unknown one", () => {
    const { columns, invalid } = mapForm2Answers({
      has_fire: "yes",
      fire_kinds: ["fire_pit", "bonfire", "fire_pit"],
    });
    expect(columns.s4FireKinds).toEqual(["fire_pit"]);
    expect(invalid).toEqual([{ questionId: "fire_kinds", value: "bonfire" }]);
  });

  it("clears the kinds when fire is no, and does not report them unfilled", () => {
    const { columns, unfilled } = mapForm2Answers({
      has_fire: "no",
      fire_kinds: ["fire_pit"],
    });
    expect(columns.s4HasFire).toBe(false);
    expect(columns.s4FireKinds).toEqual([]);
    expect(unfilled).not.toContain("s4FireKinds");
  });

  it("an unanswered gate is unfilled, not invalid", () => {
    const { invalid, unfilled } = mapForm2Answers({ has_generator: "" });
    expect(invalid).toEqual([]);
    expect(unfilled).toContain("s4HasGenerator");
  });

  it("maps the four contract question ids", () => {
    expect(FORM_2_FIELD_MAP.has_generator?.column).toBe("s4HasGenerator");
    expect(FORM_2_FIELD_MAP.has_fire?.column).toBe("s4HasFire");
    expect(FORM_2_FIELD_MAP.fire_kinds?.column).toBe("s4FireKinds");
    expect(FORM_2_FIELD_MAP.has_gas_or_fuel?.column).toBe("s4HasGasOrFuel");
  });
});
