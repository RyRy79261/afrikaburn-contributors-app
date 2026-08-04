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
