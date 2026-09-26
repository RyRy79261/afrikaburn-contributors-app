import { describe, it, expect } from "vitest";
import {
  carriedProjectAnswerKeys,
  nonCarriedProjectAnswerKeys,
  type ProjectRegistrationKind,
} from "@quagga/core";
import type { QuestionnaireResponses } from "@quagga/types";
import {
  ArtworkRegistrationInput,
  buildArtworkPayload,
} from "@/app/(app)/artworks/new/shared";
import {
  VehicleRegistrationInput,
  buildVehiclePayload,
} from "@/app/(app)/vehicles/new/shared";

// THE CARRY-FORWARD POLICY AND THE FORMS MUST AGREE ON THE KEYS.
//
// @quagga/core `project-registration` is an allow-list: a key it does not name
// starts empty in a new edition. That is the safe direction for a NEW question,
// but it silently breaks carry-forward for a RENAMED one — rename
// `build_plan` in the payload builder and last year's build plan would quietly
// stop coming across, with every test still green. So every key the builders
// write must be classified, one way or the other, by the core policy.

function classified(kind: ProjectRegistrationKind): Set<string> {
  return new Set([
    ...carriedProjectAnswerKeys(kind),
    ...nonCarriedProjectAnswerKeys(kind),
  ]);
}

function unclassified(
  kind: ProjectRegistrationKind,
  answers: QuestionnaireResponses,
): string[] {
  const known = classified(kind);
  return Object.keys(answers).filter((k) => !known.has(k));
}

describe("project answer keys are all classified for carry-forward", () => {
  it("artwork", () => {
    const answers = buildArtworkPayload(
      ArtworkRegistrationInput.parse({ name: "The Whispering Baobab" }),
    ).answers;
    expect(Object.keys(answers).length).toBeGreaterThan(0);
    expect(unclassified("artwork", answers)).toEqual([]);
  });

  it("mutant vehicle", () => {
    const answers = buildVehiclePayload(
      VehicleRegistrationInput.parse({ name: "The Teapot" }),
    ).answers;
    expect(Object.keys(answers).length).toBeGreaterThan(0);
    expect(unclassified("mutant_vehicle", answers)).toEqual([]);
  });

  it("every classified key is one the builder actually writes", () => {
    // The reverse direction: a policy entry naming a key no form writes is a
    // typo that carries nothing.
    const art = Object.keys(
      buildArtworkPayload(ArtworkRegistrationInput.parse({ name: "Baobab" }))
        .answers,
    );
    for (const key of classified("artwork")) expect(art).toContain(key);
    const mv = Object.keys(
      buildVehiclePayload(VehicleRegistrationInput.parse({ name: "Teapot" }))
        .answers,
    );
    for (const key of classified("mutant_vehicle")) expect(mv).toContain(key);
  });
});
