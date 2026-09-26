import { describe, it, expect } from "vitest";
import { MembershipRole } from "@quagga/types";

import {
  PROJECT_REGISTRATION_KINDS,
  SafetyDocumentInput,
  SafetyDocumentList,
  MAX_SAFETY_DOCUMENTS,
  WorkAccessPassRequest,
  asProjectRegistrationKind,
  buildProjectCarryForwardAnswers,
  canManageProjectSafetyDocuments,
  carriedDraftIsIncomplete,
  carriedProjectAnswerKeys,
  carriedSafetyDocuments,
  isIsoCalendarDate,
  mergeCarriedSafetyDocuments,
  mergeProjectCarryForward,
  nonCarriedProjectAnswerKeys,
  projectCarriedColumns,
  projectQuestionnairesPath,
  safetyDocumentValidity,
} from "../project-registration";

// Fully-answered prior payloads, with the exact keys the web forms write
// (apps/web/app/(app)/{artworks,vehicles}/new/shared.ts). The web package has a
// test pinning that every key those builders emit is classified here.
const PRIOR_ARTWORK = {
  artist_or_collective: "Karoo Kombuis Collective",
  description: "A twelve-metre steel baobab.",
  images: ["https://blob.example/baobab.jpg"],
  width_m: 4,
  depth_m: 4,
  height_m: 12,
  placement_notes: "Open Binnekring, clear sightlines from 6ish.",
  burn_intent: true,
  power_needs: ["solar_battery"],
  build_plan: "Pre-welded frame, three days on site.",
  strike_plan: "Full disassembly by Tuesday.",
  grant_interest: true,
  work_access_passes: 6,
};

const PRIOR_VEHICLE = {
  base_vehicle: "1974 Land Rover Series III",
  mutation_description: "A driveable teapot with a steam spout.",
  photos: ["https://blob.example/teapot.jpg"],
  soop_level: "amplified_small",
  flame_effects: false,
  night_driving: true,
  acknowledgements: ["speed_limit", "testing_station", "driver_indemnity"],
  work_access_passes: 3,
};

describe("asProjectRegistrationKind", () => {
  it("narrows only the two creative kinds", () => {
    expect(asProjectRegistrationKind("artwork")).toBe("artwork");
    expect(asProjectRegistrationKind("mutant_vehicle")).toBe("mutant_vehicle");
    expect(asProjectRegistrationKind("theme_camp")).toBeNull();
    expect(asProjectRegistrationKind("org")).toBeNull();
    expect(asProjectRegistrationKind(undefined)).toBeNull();
  });
});

describe("WorkAccessPassRequest", () => {
  it("accepts a whole number and treats absence as not asked", () => {
    expect(WorkAccessPassRequest.parse(4)).toBe(4);
    expect(WorkAccessPassRequest.parse(null)).toBeNull();
    expect(WorkAccessPassRequest.parse(undefined)).toBeNull();
  });

  it.each([-1, 2.5, 100_001])("refuses %s", (n) => {
    expect(WorkAccessPassRequest.safeParse(n).success).toBe(false);
  });
});

describe("project carry-forward", () => {
  it("never carries what is new every year, or any intent or consent", () => {
    const art = buildProjectCarryForwardAnswers("artwork", PRIOR_ARTWORK);
    for (const key of nonCarriedProjectAnswerKeys("artwork")) {
      expect(art).not.toHaveProperty(key);
    }
    const mv = buildProjectCarryForwardAnswers("mutant_vehicle", PRIOR_VEHICLE);
    for (const key of nonCarriedProjectAnswerKeys("mutant_vehicle")) {
      expect(mv).not.toHaveProperty(key);
    }
    // Named explicitly, because these are the ones that would forge consent.
    expect(mv).not.toHaveProperty("acknowledgements");
    expect(art).not.toHaveProperty("grant_interest");
    expect(art).not.toHaveProperty("work_access_passes");
  });

  it("carries the project's own words", () => {
    expect(buildProjectCarryForwardAnswers("artwork", PRIOR_ARTWORK)).toEqual({
      artist_or_collective: PRIOR_ARTWORK.artist_or_collective,
      description: PRIOR_ARTWORK.description,
      images: PRIOR_ARTWORK.images,
      power_needs: PRIOR_ARTWORK.power_needs,
      build_plan: PRIOR_ARTWORK.build_plan,
      strike_plan: PRIOR_ARTWORK.strike_plan,
    });
    expect(
      buildProjectCarryForwardAnswers("mutant_vehicle", PRIOR_VEHICLE),
    ).toEqual({
      base_vehicle: PRIOR_VEHICLE.base_vehicle,
      mutation_description: PRIOR_VEHICLE.mutation_description,
      photos: PRIOR_VEHICLE.photos,
    });
  });

  it("is an allow-list: an unknown key starts empty", () => {
    const patch = buildProjectCarryForwardAnswers("artwork", {
      ...PRIOR_ARTWORK,
      some_future_question: "last year's answer",
    });
    expect(patch).not.toHaveProperty("some_future_question");
  });

  it("drops blank values so they cannot overwrite anything", () => {
    const patch = buildProjectCarryForwardAnswers("mutant_vehicle", {
      base_vehicle: "   ",
      photos: [],
      mutation_description: "Teapot",
    });
    expect(patch).toEqual({ mutation_description: "Teapot" });
  });

  it("returns nothing for a first-timer", () => {
    expect(buildProjectCarryForwardAnswers("artwork", null)).toEqual({});
  });

  it("classifies carried and non-carried keys disjointly", () => {
    for (const kind of PROJECT_REGISTRATION_KINDS) {
      const carried = new Set(carriedProjectAnswerKeys(kind));
      for (const key of nonCarriedProjectAnswerKeys(kind)) {
        expect(carried.has(key)).toBe(false);
      }
    }
  });

  it("fills only empty keys and reports which", () => {
    const patch = buildProjectCarryForwardAnswers("artwork", PRIOR_ARTWORK);
    const { answers, filled } = mergeProjectCarryForward(
      { build_plan: "This year's plan", description: "" },
      patch,
    );
    // Typed this year → kept. Blank this year → filled.
    expect(answers.build_plan).toBe("This year's plan");
    expect(answers.description).toBe(PRIOR_ARTWORK.description);
    expect(filled).not.toContain("build_plan");
    expect(filled).toContain("description");
    expect(filled).toHaveLength(Object.keys(patch).length - 1);
  });

  it("a carried draft is never complete — the submit gate still refuses it", () => {
    for (const [kind, prior] of [
      ["artwork", PRIOR_ARTWORK],
      ["mutant_vehicle", PRIOR_VEHICLE],
    ] as const) {
      const { answers } = mergeProjectCarryForward(
        null,
        buildProjectCarryForwardAnswers(kind, prior),
      );
      expect(carriedDraftIsIncomplete(kind, answers)).toBe(true);
      // ...and the check itself can go false, so it is not vacuous.
      expect(carriedDraftIsIncomplete(kind, prior)).toBe(false);
    }
  });

  it("derives the mirrored columns from the merged answers", () => {
    const art = buildProjectCarryForwardAnswers("artwork", PRIOR_ARTWORK);
    expect(projectCarriedColumns("artwork", art)).toEqual({
      s4LayoutUploadUrls: PRIOR_ARTWORK.images,
      s2LntPlan: PRIOR_ARTWORK.strike_plan,
    });
    const mv = buildProjectCarryForwardAnswers("mutant_vehicle", PRIOR_VEHICLE);
    expect(projectCarriedColumns("mutant_vehicle", mv)).toEqual({
      s4LayoutUploadUrls: PRIOR_VEHICLE.photos,
    });
  });
});

describe("SafetyDocumentInput", () => {
  const ok = {
    title: "Structural engineer sign-off",
    url: "https://blob.example/cert.pdf",
    expiresOn: "2027-12-31",
  };

  it("accepts a titled https document with a real expiry date", () => {
    expect(SafetyDocumentInput.safeParse(ok).success).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "http://blob.example/cert.pdf",
    "data:application/pdf;base64,AAAA",
    "not a url",
  ])("refuses the link %s", (url) => {
    expect(SafetyDocumentInput.safeParse({ ...ok, url }).success).toBe(false);
  });

  it.each(["", "2027-02-30", "31/12/2027", "2027-13-01"])(
    "refuses the expiry %s",
    (expiresOn) => {
      expect(SafetyDocumentInput.safeParse({ ...ok, expiresOn }).success).toBe(
        false,
      );
    },
  );

  it("caps the list", () => {
    const many = Array.from({ length: MAX_SAFETY_DOCUMENTS + 1 }, () => ok);
    expect(SafetyDocumentList.safeParse(many).success).toBe(false);
    expect(
      SafetyDocumentList.safeParse(many.slice(0, MAX_SAFETY_DOCUMENTS)).success,
    ).toBe(true);
  });
});

describe("isIsoCalendarDate", () => {
  it("accepts real dates and refuses impossible ones", () => {
    expect(isIsoCalendarDate("2028-02-29")).toBe(true);
    expect(isIsoCalendarDate("2027-02-29")).toBe(false);
  });
});

describe("safetyDocumentValidity", () => {
  // AfrikaBurn 2027 · 26 April – 2 May 2027.
  const edition = { endDate: "2027-05-02" };

  it("is valid only when in force on the event's last day", () => {
    expect(safetyDocumentValidity("2027-05-02", edition, "2027-01-10")).toBe(
      "valid",
    );
    expect(safetyDocumentValidity("2027-04-28", edition, "2027-01-10")).toBe(
      "expires_during_event",
    );
    expect(safetyDocumentValidity("2026-12-31", edition, "2027-01-10")).toBe(
      "expired",
    );
  });
});

describe("carriedSafetyDocuments", () => {
  it("copies only documents still valid through the new edition's end", () => {
    const docs = [
      { id: "a", expiresOn: "2028-05-10" },
      { id: "b", expiresOn: "2028-04-30" },
      { id: "c", expiresOn: "2027-12-31" },
      // In force ON the last day covers the burn.
      { id: "d", expiresOn: "2028-05-07" },
    ];
    expect(
      carriedSafetyDocuments(docs, { endDate: "2028-05-07" }).map((d) => d.id),
    ).toEqual(["a", "d"]);
  });
});

describe("mergeCarriedSafetyDocuments", () => {
  const doc = (n: number) => ({ url: `https://blob.example/${n}.pdf` });

  it("never takes a draft past MAX_SAFETY_DOCUMENTS", () => {
    const existing = [1, 2, 3, 4, 5].map(doc);
    const result = mergeCarriedSafetyDocuments(existing, [6, 7, 8].map(doc));
    expect(result.add.map((d) => d.url)).toEqual([doc(6).url]);
    expect(result.skippedFull).toBe(2);
    expect(existing.length + result.add.length).toBe(MAX_SAFETY_DOCUMENTS);
  });

  it("adds nothing to a draft that is already full", () => {
    const existing = [1, 2, 3, 4, 5, 6].map(doc);
    expect(mergeCarriedSafetyDocuments(existing, [doc(7)])).toEqual({
      add: [],
      skippedDuplicate: 0,
      skippedFull: 1,
    });
  });

  it("skips a file the draft already holds, and a repeat within the carry", () => {
    const result = mergeCarriedSafetyDocuments(
      [{ url: " https://blob.example/1.pdf " }],
      [doc(1), doc(2), doc(2)],
    );
    expect(result.add.map((d) => d.url)).toEqual([doc(2).url]);
    expect(result.skippedDuplicate).toBe(2);
    expect(result.skippedFull).toBe(0);
  });

  it("takes everything into an empty draft, in order", () => {
    const carried = [3, 1, 2].map(doc);
    expect(mergeCarriedSafetyDocuments([], carried).add).toEqual(carried);
  });
});

describe("canManageProjectSafetyDocuments", () => {
  it("is the structural lead/admin and nobody else", () => {
    const allowed = MembershipRole.options.filter((r) =>
      canManageProjectSafetyDocuments(r),
    );
    expect([...allowed].sort()).toEqual(["admin", "lead"]);
    expect(canManageProjectSafetyDocuments(null)).toBe(false);
  });
});

describe("projectQuestionnairesPath", () => {
  it("routes each kind to its own base", () => {
    expect(projectQuestionnairesPath("artwork", "baobab")).toBe(
      "/artworks/baobab/questionnaires",
    );
    expect(projectQuestionnairesPath("mutant_vehicle", "teapot")).toBe(
      "/vehicles/teapot/questionnaires",
    );
    expect(projectQuestionnairesPath("theme_camp", "mad-hatters")).toBe(
      "/camps/mad-hatters/questionnaires",
    );
  });
});
