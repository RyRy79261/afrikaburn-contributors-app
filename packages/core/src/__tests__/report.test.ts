import { describe, it, expect } from "vitest";

import {
  assembleIssue,
  GITHUB_LABELS,
  ReportRequestSchema,
  reportLabels,
  type AssembleIssueInput,
} from "../report";

// The issue this builds is PUBLIC and is authored by the maintainer's GitHub
// account, from words a participant typed. Both of those facts have to survive
// into the rendered body, and nothing personal may.

const base: AssembleIssueInput = {
  type: "bug",
  surface: "web",
  description: "The roster page shows the wrong members.",
  structured: null,
  dictated: false,
  diagnostics: { environment: [], errorLogs: [] },
};

describe("reportLabels", () => {
  it("always marks a filed report as needing triage", () => {
    // The whole reason the server files these: nobody has looked at it yet,
    // and an issue created by the maintainer's token otherwise reads as though
    // somebody had.
    expect(reportLabels("bug", "web")).toContain("needs-triage");
    expect(reportLabels("feature", "org")).toContain("needs-triage");
  });

  it("marks the provenance and the app it came from", () => {
    expect(reportLabels("feature", "suppliers")).toEqual([
      "type: feature",
      "needs-triage",
      "source: in-app",
      "app: suppliers",
    ]);
  });

  it("keeps every label within what GitHub will accept", () => {
    // Found the hard way: GitHub rejects a description over 100 characters with
    // a 422, and `pnpm labels:sync` reports it as one failed label among
    // twenty-eight successes — easy to miss, and the reporter then files issues
    // carrying a label the repository does not have.
    for (const label of GITHUB_LABELS) {
      expect(
        label.description.length,
        `${label.name}: description is ${label.description.length} chars`,
      ).toBeLessThanOrEqual(100);
      expect(label.color, `${label.name}: colour`).toMatch(/^[0-9a-f]{6}$/);
      expect(label.name.length, `${label.name}: name`).toBeLessThanOrEqual(50);
    }
  });

  it("has no duplicate label names", () => {
    const names = GITHUB_LABELS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only uses labels the sync script actually creates", () => {
    const known = new Set(GITHUB_LABELS.map((l) => l.name));
    for (const type of ["bug", "feature"] as const) {
      for (const surface of ["web", "org", "suppliers"] as const) {
        for (const label of reportLabels(type, surface)) {
          expect(known, `${label} is missing from GITHUB_LABELS`).toContain(
            label,
          );
        }
      }
    }
  });
});

describe("assembleIssue", () => {
  it("says the words are not the account holder's", () => {
    // An issue filed under someone's name, containing someone else's words,
    // with nothing saying so, is the failure this line exists to prevent.
    const { body } = assembleIssue(base);
    expect(body).toContain("a user's words, not the account holder's");
    expect(body).toContain("nobody has triaged it yet");
  });

  it("titles a template-fallback report from its first line", () => {
    const { title } = assembleIssue({
      ...base,
      description: "Roster is wrong\n\nIt lists members from another camp.",
    });
    expect(title).toBe("Roster is wrong");
  });

  it("still produces a title when the description has no usable first line", () => {
    expect(assembleIssue({ ...base, description: "   " }).title).toBe(
      "Bug report",
    );
    expect(
      assembleIssue({ ...base, type: "feature", description: "   " }).title,
    ).toBe("Feature request");
  });

  it("redacts personal data out of the description", () => {
    const { body } = assembleIssue({
      ...base,
      description: "Ring the lead on 082 123 4567 or lead@camp.example",
    });
    expect(body).not.toContain("082 123 4567");
    expect(body).not.toContain("lead@camp.example");
    expect(body).toContain("[phone]");
    expect(body).toContain("[email]");
  });

  it("redacts Claude's restructuring too, not just the raw report", () => {
    // The model's output is DERIVED from the report, so it can carry anything
    // the report carried. Trusting it because a model wrote it would put the
    // phone number back after the sanitizer took it out.
    const { title, body } = assembleIssue({
      ...base,
      structured: {
        title: "Roster wrong for 082 123 4567",
        summary: "The member lead@camp.example sees other camps' members.",
        stepsToReproduce: ["Sign in as 8001015009087", "Open the roster"],
        expected: "Own camp only",
        actual: "Everyone",
      },
    });
    expect(title).toBe("Roster wrong for [phone]");
    expect(body).not.toContain("lead@camp.example");
    expect(body).not.toContain("8001015009087");
  });

  it("keeps the report as filed alongside a restructured summary", () => {
    // A summary is an interpretation. The triager should be able to read what
    // was actually said without going back to the reporter.
    const { body } = assembleIssue({
      ...base,
      description: "it just breaks when i hit save",
      structured: { title: "Save fails on the roster", summary: "Saving errors." },
    });
    expect(body).toContain("The report as filed");
    expect(body).toContain("it just breaks when i hit save");
  });

  it("reports what it removed, and never claims the report is clean", () => {
    const dirty = assembleIssue({
      ...base,
      description: "call 082 123 4567",
    });
    expect(dirty.body).toContain("Recognised and removed before filing");
    expect(dirty.body).toContain("phone numbers");
    expect(dirty.body).not.toContain("anonymised");

    const clean = assembleIssue({ ...base, description: "the button is grey" });
    expect(clean.body).toContain("No personal data was recognised");
    // Even then it must not read as a guarantee.
    expect(clean.body).toContain("not a guarantee");
  });

  it("accounts for redactions made inside the diagnostics blocks", () => {
    // The note is rendered above the diagnostics in the body, so it would be
    // stale if it were computed before them. It has to describe the whole issue.
    const { body } = assembleIssue({
      ...base,
      description: "the roster is wrong",
      diagnostics: {
        environment: [],
        errorLogs: [
          {
            timestamp: 0,
            source: "console",
            message: 'Failed to render {"phone":"082 123 4567"}',
          },
        ],
      },
    });
    expect(body).not.toContain("082 123 4567");
    expect(body).toContain("Recognised and removed before filing");
    expect(body).toContain("structured data");
  });

  it("survives a report that tries to break out of the diagnostics fence", () => {
    // Without defusing, ``` closes the block early and the rest renders as
    // markdown — inside an issue authored by the maintainer's account.
    const { body } = assembleIssue({
      ...base,
      diagnostics: {
        environment: [{ label: "UA", value: "```\n# Injected heading" }],
        errorLogs: [],
      },
    });
    expect(body).not.toContain("```\n# Injected heading");
    // Defused, not deleted — the triager still sees what was sent.
    expect(body).toContain("'''");
    expect(body).toContain("# Injected heading");
  });

  it("does not fall over on an unrenderable timestamp", () => {
    const { body } = assembleIssue({
      ...base,
      diagnostics: {
        environment: [],
        errorLogs: [
          { timestamp: Number.NaN, source: "console", message: "boom" },
        ],
      },
    });
    expect(body).toContain("unknown time");
    expect(body).toContain("boom");
  });

  it("stays under GitHub's body limit on a maximal report", () => {
    const { body } = assembleIssue({
      ...base,
      description: "x".repeat(5_000),
      diagnostics: {
        environment: Array.from({ length: 25 }, (_, i) => ({
          label: `field ${i}`,
          value: "y".repeat(500),
        })),
        errorLogs: Array.from({ length: 20 }, () => ({
          timestamp: 0,
          source: "console",
          message: "z".repeat(2_000),
          stack: "s".repeat(4_000),
        })),
      },
    });
    expect(body.length).toBeLessThanOrEqual(60_000);
  });
});

describe("ReportRequestSchema", () => {
  it("accepts a minimal report and defaults the rest", () => {
    const parsed = ReportRequestSchema.parse({
      type: "bug",
      description: "it broke",
    });
    expect(parsed.useAi).toBe(true);
    expect(parsed.dictated).toBe(false);
    expect(parsed.diagnostics).toEqual({ environment: [], errorLogs: [] });
  });

  it("refuses an empty description", () => {
    expect(
      ReportRequestSchema.safeParse({ type: "bug", description: "" }).success,
    ).toBe(false);
  });

  it("refuses more diagnostics than the caps allow", () => {
    // The caps are the first line of defence — the sanitizer is the second.
    const tooManyLogs = ReportRequestSchema.safeParse({
      type: "bug",
      description: "it broke",
      diagnostics: {
        environment: [],
        errorLogs: Array.from({ length: 21 }, () => ({
          timestamp: 0,
          source: "console",
          message: "x",
        })),
      },
    });
    expect(tooManyLogs.success).toBe(false);

    const oversizedMessage = ReportRequestSchema.safeParse({
      type: "bug",
      description: "it broke",
      diagnostics: {
        environment: [],
        errorLogs: [
          { timestamp: 0, source: "console", message: "x".repeat(2_001) },
        ],
      },
    });
    expect(oversizedMessage.success).toBe(false);
  });
});
