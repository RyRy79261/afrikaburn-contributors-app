// Regression tests for task #59 — the questionnaire-activation snapshot.
//
// THE BUG: activations resolved their definition via a LIVE join to
// `questionnaire_definitions`, so editing a definition after it was sent
// retroactively changed what in-flight and already-submitted respondents were
// rendered/validated/aggregated against — silently orphaning answers.
//
// THE FIX: the definition is snapshotted onto the activation at send time and
// read back through `resolveActivationDefinition(snapshot, liveFallback)`, which
// prefers the snapshot and only falls back to the live definition for
// pre-snapshot rows (null snapshot). These tests prove the two properties that
// are the whole point of the task:
//   1. Editing (or re-versioning) the definition AFTER activation does not
//      change what the activation renders / validates / aggregates against.
//   2. A null snapshot (a row created before the column existed) still falls
//      back to the live definition correctly.

import { describe, it, expect } from "vitest";
import { Questionnaire } from "@quagga/types";
import { resolveActivationDefinition } from "../questionnaire-activation";
import { validateSubmission } from "../questionnaire-runtime";
import { aggregateResponses } from "../questionnaire-results";

/** The definition AS SENT (snapshotted at activation time). */
const SENT_DEFINITION = Questionnaire.parse({
  version: "1",
  pages: [
    {
      id: "p1",
      kind: "questions",
      title: "Crew briefing",
      questions: [
        {
          id: "shift",
          kind: "single_select",
          prompt: "Which shift suits you?",
          options: [
            { value: "afternoon", label: "Afternoon" },
            { value: "evening", label: "Evening" },
          ],
          required: true,
        },
      ],
    },
  ],
});

/** The SAME definition after the author edited it post-send: the original
 * question is gone and a NEW required question took its place, and the version
 * was bumped. This is exactly what used to leak through the live join. */
const EDITED_DEFINITION = Questionnaire.parse({
  version: "2",
  pages: [
    {
      id: "p1",
      kind: "questions",
      title: "Crew briefing (revised)",
      questions: [
        {
          id: "arrival",
          kind: "single_select",
          prompt: "Which day do you arrive?",
          options: [
            { value: "wed", label: "Wednesday" },
            { value: "thu", label: "Thursday" },
          ],
          required: true,
        },
      ],
    },
  ],
});

describe("resolveActivationDefinition", () => {
  it("prefers the snapshot over the live definition", () => {
    const resolved = resolveActivationDefinition(
      SENT_DEFINITION,
      EDITED_DEFINITION,
    );
    expect(resolved).toBe(SENT_DEFINITION);
    expect(resolved.version).toBe("1");
  });

  it("falls back to the live definition when the snapshot is null (pre-snapshot row)", () => {
    expect(resolveActivationDefinition(null, EDITED_DEFINITION)).toBe(
      EDITED_DEFINITION,
    );
    expect(resolveActivationDefinition(undefined, EDITED_DEFINITION)).toBe(
      EDITED_DEFINITION,
    );
  });

  it("snapshots the new version on RE-ACTIVATION (v2 snapshot wins over a later v3 live edit)", () => {
    const V3_LIVE = Questionnaire.parse({
      ...EDITED_DEFINITION,
      version: "3",
    });
    // A re-activation stored EDITED_DEFINITION (v2) as its snapshot; a later v3
    // edit to the live row must not bleed into it.
    const resolved = resolveActivationDefinition(EDITED_DEFINITION, V3_LIVE);
    expect(resolved).toBe(EDITED_DEFINITION);
    expect(resolved.version).toBe("2");
  });
});

describe("editing a definition after activation does not change what it validates against", () => {
  const sentAnswer = { shift: "evening" };

  it("validates a respondent's submission against the SNAPSHOT, not the live edit", () => {
    const definition = resolveActivationDefinition(
      SENT_DEFINITION,
      EDITED_DEFINITION,
    );
    const result = validateSubmission(definition, sentAnswer);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.responses).toEqual({ shift: "evening" });
  });

  it("proves the bug: validating the SAME answer against the live edit would reject it and demand the new question", () => {
    // This is what the live join used to do — the snapshot exists to prevent it.
    const wrong = validateSubmission(EDITED_DEFINITION, sentAnswer);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      // The now-required v2 question the respondent never saw blocks them.
      expect(wrong.errors).toHaveProperty("arrival");
    }
  });
});

describe("results aggregate against the snapshot, preserving answers as sent", () => {
  const submitted = [{ shift: "evening" }, { shift: "afternoon" }];

  it("aggregates against the SNAPSHOT: the sent question is summarised, the live-edit question is absent", () => {
    const definition = resolveActivationDefinition(
      SENT_DEFINITION,
      EDITED_DEFINITION,
    );
    const results = aggregateResponses(definition, submitted);

    expect(results.questions.map((q) => q.questionId)).toEqual(["shift"]);
    const shift = results.questions[0];
    expect(shift?.chart).toBe("choice");
    if (shift?.chart === "choice") {
      const evening = shift.options.find((o) => o.value === "evening");
      expect(evening?.count).toBe(1);
    }
    // No orphans: every answer maps to a question in the snapshot it was sent as.
    expect(results.orphans).toEqual([]);
  });

  it("proves the bug: aggregating against the live edit orphans every real answer under the deleted question", () => {
    const results = aggregateResponses(EDITED_DEFINITION, submitted);
    // The live definition only knows "arrival" — the actual "shift" answers are
    // now orphans, exactly the silent data loss the snapshot prevents.
    expect(results.questions.map((q) => q.questionId)).toEqual(["arrival"]);
    expect(results.orphans).toEqual([{ questionId: "shift", count: 2 }]);
  });
});

describe("pre-snapshot rows still work via the live-definition fallback", () => {
  it("a null-snapshot activation validates + aggregates against the live definition", () => {
    // No snapshot was ever taken (row predates the column): fall back to live.
    const definition = resolveActivationDefinition(null, SENT_DEFINITION);
    const result = validateSubmission(definition, { shift: "afternoon" });
    expect(result.ok).toBe(true);

    const results = aggregateResponses(definition, [{ shift: "afternoon" }]);
    expect(results.questions.map((q) => q.questionId)).toEqual(["shift"]);
    expect(results.orphans).toEqual([]);
  });
});
