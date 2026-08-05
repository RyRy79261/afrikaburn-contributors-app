// The issue forms and the label taxonomy, checked against each other.
//
// `report.test.ts` already asserts that every label the IN-APP REPORTER applies
// exists in `GITHUB_LABELS`. Nothing asserted the same of the labels in
// `.github/ISSUE_TEMPLATE/*.yml`, and they drifted the whole way apart:
//
//   · `bug.yml` applied `bug` and `feature.yml` applied `enhancement` — which
//     exist, but only because they are GitHub's DEFAULT labels. A parallel
//     vocabulary next to `type: bug` and `type: enhancement`, describing the
//     same thing in a namespace triage does not read.
//   · `copy.yml` and `design.yml` applied `copy` and `design`, which the
//     repository has never had. GitHub drops a label a form asks for and the
//     repository does not have — SILENTLY — so those issues landed unlabelled.
//   · No form applied `needs-triage`, the entry state `docs/triage.md` calls
//     the thing everything starts at. Only the reporter ever set it, so no
//     issue a person typed into GitHub entered the queue at all.
//
// Each of those is invisible in review — the YAML is valid and the form works.
// It only shows up as issues quietly arriving wrong, weeks later.
//
// The forms are parsed with a regex rather than a YAML dependency: `labels:` is
// written in flow style on one line in every form, and a form that stops
// matching fails this test rather than skipping it.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GITHUB_LABELS } from "../report";

const FORM_DIR = join(
  // src/__tests__ → src → core → packages → repo root
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  ".github",
  "ISSUE_TEMPLATE",
);

/** Every issue FORM. `config.yml` is the chooser's config, not a form. */
function formFiles(): string[] {
  return readdirSync(FORM_DIR)
    .filter((name) => name.endsWith(".yml") && name !== "config.yml")
    .sort();
}

/** The `labels:` line of a form, as a list of label names. */
function formLabels(file: string): string[] {
  const source = readFileSync(join(FORM_DIR, file), "utf8");
  // Top-level only: `labels:` at column 0, flow style, on one line.
  const list = /^labels:[ \t]*(\[.*\])[ \t]*$/m.exec(source)?.[1];
  if (list === undefined) {
    throw new Error(
      `${file}: no top-level flow-style \`labels: [...]\` line. If the form now ` +
        `uses block style, teach this test to read it — do not delete the check.`,
    );
  }
  return JSON.parse(list) as string[];
}

describe("issue forms", () => {
  const files = formFiles();

  it("has forms to check", () => {
    // A glob that matches nothing passes every `for` loop under it in silence.
    expect(files.length).toBeGreaterThan(0);
  });

  it("only applies labels the sync script actually creates", () => {
    const known = new Set(GITHUB_LABELS.map((l) => l.name));
    for (const file of files) {
      for (const label of formLabels(file)) {
        expect(
          known,
          `${file} applies "${label}", which is not in GITHUB_LABELS. GitHub ` +
            `drops it without saying so and the issue lands unlabelled.`,
        ).toContain(label);
      }
    }
  });

  it("starts every issue at needs-triage", () => {
    // The entry state. An issue that skips it looks like one somebody has
    // already thought about, and everything keying on it never sees the issue.
    for (const file of files) {
      expect(formLabels(file), `${file}`).toContain("needs-triage");
    }
  });

  it("gives every issue exactly one type:", () => {
    // `docs/triage.md`: exactly one `type:`. Two is a triager's coin toss.
    for (const file of files) {
      const types = formLabels(file).filter((l) => l.startsWith("type: "));
      expect(types, `${file}`).toHaveLength(1);
    }
  });

  it("never lets a form set priority: — that is triage's alone", () => {
    // Not a convention, a boundary: a reporter who can state their own
    // priority states it in the line a triager reads first. See report.ts.
    for (const file of files) {
      for (const label of formLabels(file)) {
        expect(label.startsWith("priority: "), `${file}: ${label}`).toBe(false);
      }
    }
  });
});
