import { describe, it, expect } from "vitest";
import {
  buildOnboardingPreset,
  validateOnboardingDefinition,
} from "@quagga/core";
import {
  definitionFromSections,
  sectionProblem,
  sectionsFromDefinition,
  type OnboardingSectionModel,
} from "@/components/questionnaire/onboarding-model";

// The builder's editing model (A2) ↔ the stored definition. The server
// validates what this produces, so the round trip must (a) survive the
// server's validator and (b) never lose an acknowledgement id — those ids key
// every member's ticks.

describe("onboarding builder model", () => {
  it("round-trips the preset through the builder and back, still valid", () => {
    const preset = buildOnboardingPreset();
    const back = definitionFromSections(sectionsFromDefinition(preset));
    expect(back.preset).toBe("onboarding");
    expect(back.pages.map((p) => p.id)).toEqual(preset.pages.map((p) => p.id));
    expect(validateOnboardingDefinition(back).ok).toBe(true);
  });

  it("keeps acknowledgement ids stable (they key the members' answers)", () => {
    const preset = buildOnboardingPreset();
    const back = definitionFromSections(sectionsFromDefinition(preset));
    const ids = (d: typeof preset) =>
      d.pages.flatMap((p) =>
        p.kind === "questions"
          ? p.questions.filter((q) => q.kind === "acknowledgement").map((q) => q.id)
          : [],
      );
    expect(ids(back)).toEqual(ids(preset));
  });

  it("writes a video as a link card, and a section's parts in order", () => {
    const s: OnboardingSectionModel = {
      id: "welcome",
      heading: "Welcome",
      subtitle: "",
      body: "Hello",
      video: { title: "Tour", url: "https://youtu.be/x" },
      acks: [{ id: "ack_1", prompt: "I will." }],
    };
    const def = definitionFromSections([s]);
    const page = def.pages[0]!;
    expect(page.kind === "questions" && page.questions.map((q) => q.kind)).toEqual([
      "info_block",
      "video_link",
      "acknowledgement",
    ]);
    expect(validateOnboardingDefinition(def).ok).toBe(true);
  });

  it("names what is wrong with a section, in words", () => {
    const empty: OnboardingSectionModel = {
      id: "s",
      heading: "Rules",
      subtitle: "",
      body: "",
      video: null,
      acks: [],
    };
    expect(sectionProblem(empty)).toMatch(/text, a video link or a tick box/);
    expect(sectionProblem({ ...empty, heading: "" })).toMatch(/heading/);
    expect(
      sectionProblem({
        ...empty,
        video: { title: "T", url: "http://insecure.example" },
      }),
    ).toMatch(/https/);
    expect(sectionProblem({ ...empty, body: "ok" })).toBeNull();
  });
});
