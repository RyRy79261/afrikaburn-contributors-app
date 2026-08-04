import { describe, it, expect } from "vitest";
import {
  AudienceSpec,
  OFFICER_AUDIENCE_LABELS,
  OFFICER_KEYS,
  ORG_OUTBOUND_SELECTORS,
  ORG_OUTBOUND_SELECTOR_LABELS,
  ProjectAudience,
  QuestionnaireActivationInput,
  QuestionnaireBuilderInput,
  authoredScopeForAudience,
  groupIdForAudience,
} from "../index";

// `authoredScopeForAudience` stamps `questionnaire_activations.authored_scope`,
// which this file's own source comment calls "the hard boundary results
// visibility never crosses". A project audience mis-stamped as `org` would
// expose one camp's questionnaire results to the Organiser Console.

const CAMP = "g-camp-404";

const SPECS: {
  spec: AudienceSpec;
  scope: "org" | "group";
  groupId: string | null;
}[] = [
  { spec: { kind: "org_internal" }, scope: "org", groupId: null },
  {
    spec: { kind: "org_outbound", selectors: ["camp_leads"] },
    scope: "org",
    groupId: null,
  },
  {
    spec: { kind: "org_officer", officerKeys: ["safety_officer"] },
    scope: "org",
    groupId: null,
  },
  { spec: { kind: "org_suppliers" }, scope: "org", groupId: null },
  {
    spec: { kind: "project", groupId: CAMP, mode: "everyone", roleIds: [] },
    scope: "group",
    groupId: CAMP,
  },
];

describe("audience → authored scope", () => {
  it("covers every audience kind in the union", () => {
    // Table-driven so a new audience kind cannot be added without a deliberate
    // org-vs-group scope decision being written down here.
    const unionKinds = AudienceSpec.options.map(
      (o) => o.shape.kind.value as string,
    );
    expect(SPECS.map((s) => s.spec.kind).sort()).toEqual(
      [...unionKinds].sort(),
    );
  });

  it("scopes a project audience to the group and everything else to the org", () => {
    for (const { spec, scope } of SPECS) {
      expect(authoredScopeForAudience(spec), spec.kind).toBe(scope);
    }
  });

  it("carries the group id only for a project audience", () => {
    for (const { spec, groupId } of SPECS) {
      expect(groupIdForAudience(spec), spec.kind).toBe(groupId);
    }
  });
});

describe("AudienceSpec validation", () => {
  it("refuses an unknown kind", () => {
    expect(AudienceSpec.safeParse({ kind: "everyone" }).success).toBe(false);
  });

  it("refuses an outbound or officer audience that targets nobody", () => {
    // An empty selector list is an authoring mistake, not a valid broadcast —
    // it would activate a blocking questionnaire against zero recipients.
    expect(
      AudienceSpec.safeParse({ kind: "org_outbound", selectors: [] }).success,
    ).toBe(false);
    expect(
      AudienceSpec.safeParse({ kind: "org_officer", officerKeys: [] }).success,
    ).toBe(false);
  });

  it("defaults a project audience's roleIds to an empty list", () => {
    const parsed = ProjectAudience.parse({
      kind: "project",
      groupId: CAMP,
      mode: "everyone",
    });
    expect(parsed.roleIds).toEqual([]);
  });
});

describe("picker labels", () => {
  it("labels every outbound selector", () => {
    // An unlabelled selector renders as a blank row in the audience picker.
    for (const selector of ORG_OUTBOUND_SELECTORS) {
      expect(ORG_OUTBOUND_SELECTOR_LABELS[selector], selector).toBeTruthy();
    }
    expect(Object.keys(ORG_OUTBOUND_SELECTOR_LABELS).sort()).toEqual(
      [...ORG_OUTBOUND_SELECTORS].sort(),
    );
  });

  it("labels every officer key", () => {
    for (const key of OFFICER_KEYS) {
      expect(OFFICER_AUDIENCE_LABELS[key], key).toBeTruthy();
    }
    expect(Object.keys(OFFICER_AUDIENCE_LABELS).sort()).toEqual(
      [...OFFICER_KEYS].sort(),
    );
  });
});

describe("activation + builder inputs", () => {
  const base = {
    questionnaireKey: "form-2",
    version: "1",
    title: "Form 2",
    editionId: "e-2027",
    audience: { kind: "org_outbound", selectors: ["registered_camp_leads"] },
  };

  it("defaults an activation to blocking with no due date", () => {
    // Blocking-by-default is the safer default for a gate: an activation that
    // silently became non-blocking would stop gating and nobody would notice.
    const parsed = QuestionnaireActivationInput.parse(base);
    expect(parsed.blocking).toBe(true);
    expect(parsed.dueAt).toBe(null);
  });

  it("refuses an activation with no edition and one with no audience", () => {
    const { editionId: _edition, ...noEdition } = base;
    const { audience: _audience, ...noAudience } = base;
    expect(QuestionnaireActivationInput.safeParse(noEdition).success).toBe(false);
    expect(QuestionnaireActivationInput.safeParse(noAudience).success).toBe(
      false,
    );
  });

  it("refuses a builder payload whose definition has no pages", () => {
    expect(
      QuestionnaireBuilderInput.safeParse({
        title: "Empty",
        definition: { version: "1", pages: [] },
      }).success,
    ).toBe(false);
    expect(
      QuestionnaireBuilderInput.safeParse({
        title: "Sound check",
        definition: {
          version: "1",
          pages: [
            {
              id: "p1",
              kind: "questions",
              title: "Sound",
              questions: [
                { id: "amps", kind: "short_text", prompt: "How many amps?" },
              ],
            },
          ],
        },
      }).success,
    ).toBe(true);
  });
});
