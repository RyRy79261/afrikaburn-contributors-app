// FROZEN snapshot of a questionnaire definition as the pre-Builder-v2 builder
// wrote it — the exact JSON shape sitting in `questionnaire_definitions.definition`
// (and in every activation's snapshot) before Builder v2 landed.
//
// This file exists to make backward compatibility a TEST, not a promise:
// Builder v2 extends the definition jsonb in place, so every v1 definition
// must still parse, validate, resolve a path, validate responses, and
// aggregate — with no migration and no rewrite. DO NOT "modernise" this
// fixture. If a change here is needed to make a test pass, the change is a
// backward-compatibility break and belongs in a migration discussion instead.
//
// `unknown`-typed on purpose: the point is to feed genuinely untyped stored
// JSON through the parsers, exactly as a DB read does.

/** A camp-authored questionnaire in the pre-v2 shape (flat page, five kinds,
 * `{value,label}` options, no display/branching/validation fields). */
export const V1_CAMP_QUESTIONNAIRE: unknown = {
  version: "1",
  pages: [
    {
      id: "main",
      kind: "questions",
      title: "Build week logistics",
      subtitle: "Two minutes, promise.",
      questions: [
        {
          id: "arrival_day",
          kind: "single_select",
          prompt: "Which day are you arriving?",
          helper: "Gates open Sunday.",
          options: [
            { value: "sunday", label: "Sunday" },
            { value: "monday", label: "Monday" },
            { value: "tuesday", label: "Tuesday" },
          ],
          required: true,
        },
        {
          id: "skills",
          kind: "multi_select",
          prompt: "What can you help with?",
          options: [
            { value: "build", label: "Build crew" },
            { value: "kitchen", label: "Kitchen" },
            { value: "moop", label: "MOOP sweep" },
          ],
          required: false,
        },
        {
          id: "vehicle",
          kind: "short_text",
          prompt: "Vehicle registration",
          placeholder: "CA 123-456",
          maxLength: 200,
          required: true,
        },
        {
          id: "notes",
          kind: "long_text",
          prompt: "Anything the camp should know?",
          maxLength: 2000,
          required: false,
        },
        {
          id: "consent",
          kind: "boolean",
          prompt: "I have read the camp agreement",
          required: false,
        },
      ],
    },
  ],
};

/** A multi-page v1 definition with an intro interstitial — the Burner Bio
 * shape, which the code-side questionnaire registry still emits. */
export const V1_MULTIPAGE_QUESTIONNAIRE: unknown = {
  version: "2",
  pages: [
    {
      id: "intro",
      kind: "intro",
      heading: "Your Burner Bio",
      body: "A few things about you, once.",
    },
    {
      id: "identity",
      kind: "questions",
      title: "Who you are",
      questions: [
        {
          id: "displayName",
          kind: "short_text",
          prompt: "Playa name or display name",
          maxLength: 120,
          required: true,
        },
        {
          id: "contactEmail",
          kind: "email",
          prompt: "Best contact email",
          required: true,
        },
        {
          id: "phone",
          kind: "phone",
          prompt: "Mobile number",
          required: true,
        },
      ],
    },
    {
      id: "history",
      kind: "questions",
      title: "Your burns",
      questions: [
        {
          id: "firstTime",
          kind: "boolean",
          prompt: "Is this your first AfrikaBurn?",
          required: false,
        },
        {
          id: "attendedYears",
          kind: "years",
          prompt: "Which years have you been?",
          required: false,
        },
        {
          id: "birthday",
          kind: "date",
          prompt: "Date of birth",
          required: true,
        },
      ],
    },
  ],
};

/** Responses collected against `V1_CAMP_QUESTIONNAIRE` before Builder v2 —
 * stored jsonb, flat map keyed by question id. */
export const V1_STORED_RESPONSES: readonly Record<string, unknown>[] = [
  {
    arrival_day: "sunday",
    skills: ["build", "moop"],
    vehicle: "CA 123-456",
    notes: "Bringing the big shade structure.",
    consent: true,
  },
  {
    arrival_day: "monday",
    skills: ["kitchen"],
    vehicle: "CJ 998-112",
    consent: false,
  },
  {
    arrival_day: "sunday",
    skills: [],
    vehicle: "CY 400-001",
    notes: "",
    consent: true,
  },
];
