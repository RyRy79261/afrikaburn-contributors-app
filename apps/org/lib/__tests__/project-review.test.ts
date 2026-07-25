import { describe, it, expect } from "vitest";
import type { QuestionnaireResponses } from "@quagga/types";
import {
  answerBool,
  answerString,
  answerStringArray,
  buildProjectMeta,
  buildProjectSections,
  officersCopy,
  PROJECT_SUBJECT_NOUN,
  type ProjectRegistrationView,
} from "../project-review";

const EMPTY_VIEW: ProjectRegistrationView = {
  contactEmail: null,
  areaDimensions: null,
  imageUrls: [],
  soundRaw: null,
  placementNotes: null,
  lntPlan: null,
  grantsInterest: null,
};

describe("answer coercers — malformed jsonb degrades, never throws", () => {
  const answers: QuestionnaireResponses = {
    str: "hello",
    blank: "   ",
    num: 42,
    bool: true,
    arr: ["a", "b"],
    mixedArr: ["a", 2, "b"] as unknown as string[],
  };

  it("answerString returns trimmed non-empty strings only", () => {
    expect(answerString(answers, "str")).toBe("hello");
    expect(answerString(answers, "blank")).toBeNull();
    expect(answerString(answers, "num")).toBeNull();
    expect(answerString(answers, "missing")).toBeNull();
    expect(answerString(null, "str")).toBeNull();
  });

  it("answerBool returns booleans only", () => {
    expect(answerBool(answers, "bool")).toBe(true);
    expect(answerBool(answers, "str")).toBeNull();
    expect(answerBool(null, "bool")).toBeNull();
  });

  it("answerStringArray filters to strings", () => {
    expect(answerStringArray(answers, "arr")).toEqual(["a", "b"]);
    expect(answerStringArray(answers, "mixedArr")).toEqual(["a", "b"]);
    expect(answerStringArray(answers, "str")).toEqual([]);
    expect(answerStringArray(null, "arr")).toEqual([]);
  });
});

describe("buildProjectSections — mutant vehicle", () => {
  const answers: QuestionnaireResponses = {
    base_vehicle: "1987 Land Cruiser",
    mutation_description: "A rolling dragon",
    photos: ["https://x/1.jpg"],
    soop_level: "level_2",
    flame_effects: true,
    night_driving: false,
    acknowledgements: ["speed_limit", "testing_station", "driver_indemnity"],
  };
  const view: ProjectRegistrationView = {
    ...EMPTY_VIEW,
    contactEmail: "crew@example.com",
    imageUrls: ["https://x/1.jpg"],
    soundRaw: "level_2",
  };

  const sections = buildProjectSections("mutant_vehicle", "Dragon", view, answers);

  it("uses distinct section keys (no thread collision)", () => {
    const keys = sections.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never uses camp vocabulary in labels", () => {
    const labels = sections.map((s) => s.label).join(" ");
    expect(labels.toLowerCase()).not.toContain("camp");
    expect(labels.toLowerCase()).not.toContain("gifting");
  });

  it("surfaces the base vehicle, flame + night flags, and acks", () => {
    const identity = sections.find((s) => s.key === "identity")!;
    expect(
      identity.fields.some(
        (f) => f.value.type === "text" && f.value.value === "1987 Land Cruiser",
      ),
    ).toBe(true);

    const ops = sections.find((s) => s.key === "participation")!;
    expect(
      ops.fields.some((f) => f.value.type === "yesno" && f.value.value === true),
    ).toBe(true);
    expect(
      ops.fields.some(
        (f) => f.value.type === "yesno" && f.value.value === false,
      ),
    ).toBe(true);

    const acksSection = sections.find((s) => s.key === "lnt")!;
    const acks = acksSection.fields[0]!.value;
    expect(acks.type).toBe("acks");
    if (acks.type === "acks") {
      expect(acks.ackedKeys).toHaveLength(3);
    }
  });
});

describe("buildProjectSections — artwork", () => {
  const answers: QuestionnaireResponses = {
    artist_or_collective: "The Dust Collective",
    description: "A mirrored monolith",
    images: ["https://x/1.jpg"],
    width_m: 4,
    depth_m: 4,
    height_m: 12,
    placement_notes: "Deep playa",
    burn_intent: true,
    power_needs: ["solar_battery"],
    build_plan: "Modular steel frame",
    strike_plan: "Full LNT sweep",
    grant_interest: true,
  };
  const view: ProjectRegistrationView = {
    ...EMPTY_VIEW,
    contactEmail: "art@example.com",
    areaDimensions: "4 m W × 4 m D × 12 m H",
    imageUrls: ["https://x/1.jpg"],
    placementNotes: "Deep playa",
    lntPlan: "Full LNT sweep",
    grantsInterest: true,
  };

  const sections = buildProjectSections("artwork", "Monolith", view, answers);

  it("uses distinct section keys and includes the build & grant section", () => {
    const keys = sections.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("suppliers_commerce");
  });

  it("surfaces footprint, burn intent, power, and grant interest", () => {
    const footprint = sections.find((s) => s.key === "size_logistics")!;
    expect(
      footprint.fields.some(
        (f) =>
          f.value.type === "text" &&
          f.value.value === "4 m W × 4 m D × 12 m H",
      ),
    ).toBe(true);

    const burning = sections.find((s) => s.key === "participation")!;
    const power = burning.fields.find((f) => f.value.type === "power")!.value;
    if (power.type === "power") {
      expect(power.keys).toEqual(["solar_battery"]);
    }

    const grant = sections.find((s) => s.key === "suppliers_commerce")!;
    expect(
      grant.fields.some(
        (f) => f.value.type === "yesno" && f.value.value === true,
      ),
    ).toBe(true);
  });
});

describe("buildProjectMeta — honest, never 'campers'", () => {
  it("mutant vehicle: submitted · SOOP · cohort", () => {
    const meta = buildProjectMeta("mutant_vehicle", {
      submittedAt: new Date("2027-01-15T00:00:00Z"),
      cohort: "new",
      view: { ...EMPTY_VIEW, soundRaw: "level_3" },
      answers: null,
    });
    expect(meta.join(" ")).toContain("SOOP Level 3");
    expect(meta.join(" ")).toContain("New mutant vehicle");
    expect(meta.join(" ").toLowerCase()).not.toContain("camper");
  });

  it("artwork: submitted · footprint · burn intent · cohort", () => {
    const meta = buildProjectMeta("artwork", {
      submittedAt: null,
      cohort: "returning",
      view: { ...EMPTY_VIEW, areaDimensions: "2 m W × 2 m D × 8 m H" },
      answers: { burn_intent: true },
    });
    expect(meta).toContain("Not yet submitted");
    expect(meta).toContain("2 m W × 2 m D × 8 m H");
    expect(meta).toContain("Intends to burn");
    expect(meta).toContain("Returning artwork");
  });

  it("omits burn chip when burn intent is unanswered", () => {
    const meta = buildProjectMeta("artwork", {
      submittedAt: null,
      cohort: "new",
      view: EMPTY_VIEW,
      answers: null,
    });
    expect(meta.some((m) => m.includes("burn"))).toBe(false);
  });
});

describe("per-kind vocabulary", () => {
  it("subject nouns are honest", () => {
    expect(PROJECT_SUBJECT_NOUN.theme_camp).toBe("camp");
    expect(PROJECT_SUBJECT_NOUN.mutant_vehicle).toBe("mutant vehicle");
    expect(PROJECT_SUBJECT_NOUN.artwork).toBe("artwork");
  });

  it("officers copy never says 'camp' for projects", () => {
    expect(officersCopy("mutant_vehicle").empty.toLowerCase()).not.toContain(
      "camp",
    );
    expect(officersCopy("artwork").title.toLowerCase()).not.toContain("camp");
    expect(officersCopy("theme_camp").title).toBe("Camp officers");
  });
});
