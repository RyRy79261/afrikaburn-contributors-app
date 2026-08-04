import { describe, it, expect } from "vitest";
import {
  Questionnaire,
  toOtherAnswer,
  type QuestionnaireResponses,
} from "@quagga/types";
import {
  aggregateQuestion,
  aggregateResponses,
  type QuestionAggregate,
} from "../questionnaire-results";
import { allQuestions } from "../questionnaire-runtime";
import {
  V1_CAMP_QUESTIONNAIRE,
  V1_STORED_RESPONSES,
} from "../__fixtures__/questionnaire-v1";

const DEF = Questionnaire.parse({
  version: "1",
  pages: [
    {
      id: "p",
      kind: "questions",
      title: "Feedback",
      questions: [
        { id: "note", kind: "info_block", body: "Thanks for coming." },
        {
          id: "camp_type",
          kind: "single_select",
          prompt: "What kind of camp?",
          allowOther: true,
          options: [
            { value: "sound", label: "Sound camp" },
            { value: "quiet", label: "Quiet camp" },
          ],
          required: false,
        },
        {
          id: "helped",
          kind: "multi_select",
          prompt: "What did you help with?",
          options: [
            { value: "build", label: "Build" },
            { value: "kitchen", label: "Kitchen" },
            { value: "moop", label: "MOOP" },
          ],
          required: false,
        },
        {
          id: "rating",
          kind: "rating",
          prompt: "Rate the burn",
          steps: 5,
          required: false,
        },
        {
          id: "loudness",
          kind: "linear_scale",
          prompt: "How loud were we?",
          min: 1,
          max: 5,
          minLabel: "Ambient",
          maxLabel: "Dance floor",
          required: false,
        },
        {
          id: "returning",
          kind: "boolean",
          prompt: "Coming back?",
          required: false,
        },
        {
          id: "arrival",
          kind: "date",
          prompt: "Arrival day",
          required: false,
        },
        {
          id: "comment",
          kind: "long_text",
          prompt: "Anything else?",
          maxLength: 500,
          required: false,
        },
      ],
    },
  ],
});

const RESPONSES: QuestionnaireResponses[] = [
  {
    camp_type: "sound",
    helped: ["build", "moop"],
    rating: 5,
    loudness: 4,
    returning: true,
    arrival: "2027-04-26",
    comment: "Best year yet",
  },
  {
    camp_type: "sound",
    helped: ["kitchen"],
    rating: 4,
    loudness: 5,
    returning: true,
    arrival: "2027-04-27",
    comment: "",
  },
  {
    camp_type: "quiet",
    helped: [],
    rating: 3,
    loudness: 1,
    returning: false,
    arrival: "2027-04-26",
  },
  {
    camp_type: toOtherAnswer("Mutant vehicle crew"),
    rating: 5,
  },
];

function get(id: string): QuestionAggregate {
  const found = aggregateResponses(DEF, RESPONSES).questions.find(
    (q) => q.questionId === id,
  );
  if (!found) throw new Error(`no aggregate for ${id}`);
  return found;
}

describe("aggregation shape", () => {
  it("aggregates one entry per answerable question, skipping content blocks", () => {
    const results = aggregateResponses(DEF, RESPONSES);
    expect(results.totalResponses).toBe(4);
    expect(results.questions.map((q) => q.questionId)).toEqual([
      "camp_type",
      "helped",
      "rating",
      "loudness",
      "returning",
      "arrival",
      "comment",
    ]);
  });

  it("handles an empty response set without dividing by zero", () => {
    const results = aggregateResponses(DEF, []);
    expect(results.totalResponses).toBe(0);
    for (const q of results.questions) {
      expect(q.responded).toBe(0);
      expect(q.skipped).toBe(0);
    }
    const choice = results.questions[0];
    if (choice?.chart !== "choice") throw new Error("expected choice");
    expect(choice.options.every((o) => o.percent === 0)).toBe(true);
  });
});

describe("choice aggregation", () => {
  it("counts single-choice options with percentages of respondents", () => {
    const agg = get("camp_type");
    if (agg.chart !== "choice") throw new Error("expected choice");
    expect(agg.responded).toBe(4);
    expect(agg.skipped).toBe(0);
    expect(agg.options).toEqual([
      { value: "sound", label: "Sound camp", count: 2, percent: 50 },
      { value: "quiet", label: "Quiet camp", count: 1, percent: 25 },
    ]);
    expect(agg.other).toEqual([{ text: "Mutant vehicle crew", count: 1 }]);
  });

  it("counts multi-choice selections and treats [] as a skip", () => {
    const agg = get("helped");
    if (agg.chart !== "choice") throw new Error("expected choice");
    expect(agg.responded).toBe(2);
    expect(agg.skipped).toBe(2);
    expect(agg.options).toEqual([
      { value: "build", label: "Build", count: 1, percent: 50 },
      { value: "kitchen", label: "Kitchen", count: 1, percent: 50 },
      { value: "moop", label: "MOOP", count: 1, percent: 50 },
    ]);
  });

  it("keeps a row for an option deleted after the answers came in", () => {
    const q = allQuestions(DEF).find((x) => x.id === "camp_type")!;
    if (q.kind !== "single_select") throw new Error("expected single_select");
    const narrowed = { ...q, options: [q.options[0]!] };
    const agg = aggregateQuestion(narrowed, RESPONSES);
    if (agg.chart !== "choice") throw new Error("expected choice");
    expect(agg.options.map((o) => o.value)).toEqual(["sound", "quiet"]);
    expect(agg.options[1]).toEqual({
      value: "quiet",
      label: "quiet",
      count: 1,
      percent: 25,
    });
  });
});

describe("scale and rating aggregation", () => {
  it("builds a star distribution with an average", () => {
    const agg = get("rating");
    if (agg.chart !== "rating") throw new Error("expected rating");
    expect(agg.steps).toBe(5);
    expect(agg.buckets).toEqual([
      { value: 1, count: 0, percent: 0 },
      { value: 2, count: 0, percent: 0 },
      { value: 3, count: 1, percent: 25 },
      { value: 4, count: 1, percent: 25 },
      { value: 5, count: 2, percent: 50 },
    ]);
    expect(agg.average).toBe(4.25);
  });

  it("builds a linear-scale histogram with end labels", () => {
    const agg = get("loudness");
    if (agg.chart !== "scale") throw new Error("expected scale");
    expect(agg.min).toBe(1);
    expect(agg.max).toBe(5);
    expect(agg.minLabel).toBe("Ambient");
    expect(agg.maxLabel).toBe("Dance floor");
    expect(agg.buckets.map((b) => b.count)).toEqual([1, 0, 0, 1, 1]);
    expect(agg.average).toBe(3.33);
    expect(agg.responded).toBe(3);
    expect(agg.skipped).toBe(1);
  });

  it("returns a null average when nobody answered", () => {
    const agg = aggregateResponses(DEF, []).questions.find(
      (q) => q.questionId === "rating",
    );
    if (agg?.chart !== "rating") throw new Error("expected rating");
    expect(agg.average).toBeNull();
  });

  it("keeps out-of-range answers when a scale is narrowed after collection", () => {
    const q = allQuestions(DEF).find((x) => x.id === "loudness")!;
    if (q.kind !== "linear_scale") throw new Error("expected linear_scale");
    const agg = aggregateQuestion({ ...q, max: 3 }, RESPONSES);
    if (agg.chart !== "scale") throw new Error("expected scale");
    expect(agg.buckets.map((b) => b.value)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("boolean, timeline and text aggregation", () => {
  it("splits a yes/no question", () => {
    const agg = get("returning");
    if (agg.chart !== "boolean") throw new Error("expected boolean");
    expect(agg.yes).toBe(2);
    expect(agg.no).toBe(1);
    expect(agg.percentYes).toBe(66.7);
  });

  it("buckets dates in order with earliest/latest", () => {
    const agg = get("arrival");
    if (agg.chart !== "timeline") throw new Error("expected timeline");
    expect(agg.buckets).toEqual([
      { value: "2027-04-26", count: 2, percent: 66.7 },
      { value: "2027-04-27", count: 1, percent: 33.3 },
    ]);
    expect(agg.earliest).toBe("2027-04-26");
    expect(agg.latest).toBe("2027-04-27");
  });

  it("lists free-text answers and counts blanks as skips", () => {
    const agg = get("comment");
    if (agg.chart !== "text") throw new Error("expected text");
    expect(agg.answers).toEqual(["Best year yet"]);
    expect(agg.responded).toBe(1);
    expect(agg.skipped).toBe(3);
  });
});

describe("definition drift", () => {
  it("surfaces answers whose question was deleted", () => {
    const results = aggregateResponses(DEF, [
      ...RESPONSES,
      { camp_type: "sound", removed_question: "an answer nobody can see" },
    ]);
    expect(results.orphans).toEqual([
      { questionId: "removed_question", count: 1 },
    ]);
  });

  it("reports honest skips for a question added after collection", () => {
    const withNew = Questionnaire.parse({
      ...DEF,
      pages: [
        {
          ...DEF.pages[0],
          questions: [
            ...(DEF.pages[0]?.kind === "questions"
              ? DEF.pages[0].questions
              : []),
            {
              id: "brand_new",
              kind: "short_text",
              prompt: "Added later",
              maxLength: 50,
              required: false,
            },
          ],
        },
      ],
    });
    const agg = aggregateResponses(withNew, RESPONSES).questions.find(
      (q) => q.questionId === "brand_new",
    );
    expect(agg?.responded).toBe(0);
    expect(agg?.skipped).toBe(4);
    expect(agg?.total).toBe(4);
  });
});

describe("backward compatibility — v1 responses aggregate", () => {
  it("aggregates responses collected before Builder v2", () => {
    const def = Questionnaire.parse(V1_CAMP_QUESTIONNAIRE);
    const results = aggregateResponses(
      def,
      V1_STORED_RESPONSES as QuestionnaireResponses[],
    );
    expect(results.totalResponses).toBe(3);
    expect(results.orphans).toEqual([]);

    const arrival = results.questions.find(
      (q) => q.questionId === "arrival_day",
    );
    if (arrival?.chart !== "choice") throw new Error("expected choice");
    expect(arrival.options).toEqual([
      { value: "sunday", label: "Sunday", count: 2, percent: 66.7 },
      { value: "monday", label: "Monday", count: 1, percent: 33.3 },
      { value: "tuesday", label: "Tuesday", count: 0, percent: 0 },
    ]);
    expect(arrival.other).toEqual([]);

    const consent = results.questions.find((q) => q.questionId === "consent");
    if (consent?.chart !== "boolean") throw new Error("expected boolean");
    expect(consent.yes).toBe(2);
    expect(consent.no).toBe(1);
  });
});
