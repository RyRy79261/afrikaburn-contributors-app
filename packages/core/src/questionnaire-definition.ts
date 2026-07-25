// Questionnaire DEFINITION validation (questionnaire-spec §"Builder v2 —
// Google Forms parity"). Zod gives us the shape; this module gives us the
// STRUCTURAL integrity that a shape check can't express:
//
//   - ids are globally unique and stable (responses are keyed by question id,
//     so a duplicate id silently overwrites someone's answer),
//   - option values are unique and don't collide with the `other:` encoding,
//   - every branch target exists and points FORWARD — which is what makes
//     loops and dead ends impossible by construction rather than by luck,
//   - every section is reachable from the first one,
//   - min/max rules are internally consistent.
//
// Builders call this before saving; the runner and results engine may assume a
// validated definition (and still degrade gracefully if handed a legacy one).
//
// Pure — no I/O, no env.

import {
  OTHER_PREFIX,
  Questionnaire,
  SUBMIT_TARGET,
  isAnswerableBlock,
  pageBlocks,
  type PageBlock,
  type Question,
  type QuestionnairePage,
} from "@quagga/types";

export type DefinitionIssueCode =
  | "shape"
  | "duplicate_id"
  | "reserved_id"
  | "duplicate_option_value"
  | "reserved_option_value"
  | "unknown_branch_target"
  | "backward_branch"
  | "self_branch"
  | "branch_not_allowed"
  | "unreachable_page"
  | "invalid_range";

/** One structural defect, addressed to a place in the definition. */
export interface DefinitionIssue {
  /** Dotted path into the definition, e.g. `pages[2].questions[0].options[1]`. */
  path: string;
  code: DefinitionIssueCode;
  message: string;
}

export type DefinitionValidation =
  | { ok: true; definition: Questionnaire; issues: readonly [] }
  | { ok: false; issues: DefinitionIssue[] };

/** Branch targets declared by one block (single-choice options only). */
function optionBranchTargets(
  block: PageBlock,
): { index: number; target: string }[] {
  if (block.kind !== "single_select") return [];
  const out: { index: number; target: string }[] = [];
  block.options.forEach((o, index) => {
    if (o.goTo) out.push({ index, target: o.goTo });
  });
  return out;
}

/** The page a branch-free traversal falls through to: the explicit `next`, or
 * the following page, or submit when this is the last page. */
function fallthroughTarget(
  page: QuestionnairePage,
  index: number,
  pages: readonly QuestionnairePage[],
): string {
  if (page.next) return page.next;
  const following = pages[index + 1];
  return following ? following.id : SUBMIT_TARGET;
}

function rangeIssues(q: Question, path: string): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const bad = (message: string) =>
    issues.push({ path, code: "invalid_range", message });

  if (q.kind === "short_text" || q.kind === "long_text") {
    if (q.minLength != null && q.minLength > q.maxLength) {
      bad(`minLength ${q.minLength} exceeds maxLength ${q.maxLength}`);
    }
  }
  if (q.kind === "short_text") {
    if (q.min != null && q.max != null && q.min > q.max) {
      bad(`min ${q.min} exceeds max ${q.max}`);
    }
    const numeric = q.format === "number" || q.format === "integer";
    if (!numeric && (q.min != null || q.max != null)) {
      bad("min/max only apply when format is number or integer");
    }
  }
  if (q.kind === "multi_select") {
    const ceiling = q.options.length + (q.allowOther ? 1 : 0);
    if (
      q.minSelections != null &&
      q.maxSelections != null &&
      q.minSelections > q.maxSelections
    ) {
      bad(
        `minSelections ${q.minSelections} exceeds maxSelections ${q.maxSelections}`,
      );
    }
    if (q.minSelections != null && q.minSelections > ceiling) {
      bad(`minSelections ${q.minSelections} exceeds the ${ceiling} options`);
    }
    if (q.maxSelections != null && q.maxSelections > ceiling) {
      bad(`maxSelections ${q.maxSelections} exceeds the ${ceiling} options`);
    }
  }
  if (q.kind === "linear_scale" && q.max <= q.min) {
    bad(`max ${q.max} must be greater than min ${q.min}`);
  }
  return issues;
}

/**
 * Validate a raw questionnaire definition. Returns the PARSED definition on
 * success (Zod defaults applied) or the full list of structural issues.
 *
 * Backward compatible by construction: every Builder v2 addition is optional,
 * so a pre-v2 definition produces zero issues and parses unchanged.
 */
export function validateQuestionnaireDefinition(
  raw: unknown,
): DefinitionValidation {
  const parsed = Questionnaire.safeParse(raw);
  if (!parsed.success) {
    const issues: DefinitionIssue[] = parsed.error.issues.map((i) => ({
      path: i.path.length ? i.path.join(".") : "definition",
      code: "shape" as const,
      message: i.message,
    }));
    return { ok: false, issues };
  }

  const definition = parsed.data;
  const pages = definition.pages;
  const issues: DefinitionIssue[] = [];

  // --- ids: one flat namespace, globally unique ---------------------------
  // Question ids key the response map; page ids are branch targets. Sharing a
  // namespace keeps "go to section X" unambiguous.
  const seenIds = new Map<string, string>();
  const pageIndexById = new Map<string, number>();

  const claimId = (id: string, path: string) => {
    if (id === SUBMIT_TARGET) {
      issues.push({
        path,
        code: "reserved_id",
        message: `"${SUBMIT_TARGET}" is reserved for the submit branch target`,
      });
      return;
    }
    const previous = seenIds.get(id);
    if (previous) {
      issues.push({
        path,
        code: "duplicate_id",
        message: `id "${id}" is already used at ${previous} — ids must be unique so responses stay attached to the right question`,
      });
      return;
    }
    seenIds.set(id, path);
  };

  pages.forEach((page, pageIndex) => {
    const pagePath = `pages[${pageIndex}]`;
    claimId(page.id, pagePath);
    if (!pageIndexById.has(page.id)) pageIndexById.set(page.id, pageIndex);

    pageBlocks(page).forEach((block, blockIndex) => {
      const blockPath = `${pagePath}.questions[${blockIndex}]`;
      claimId(block.id, blockPath);

      if (!isAnswerableBlock(block)) return;
      issues.push(...rangeIssues(block, blockPath));

      if (block.kind !== "single_select" && block.kind !== "multi_select") {
        return;
      }
      const seenValues = new Set<string>();
      block.options.forEach((option, optionIndex) => {
        const optionPath = `${blockPath}.options[${optionIndex}]`;
        if (option.value.startsWith(OTHER_PREFIX)) {
          issues.push({
            path: optionPath,
            code: "reserved_option_value",
            message: `option values may not start with "${OTHER_PREFIX}" — that prefix encodes an "Other…" answer`,
          });
        }
        if (seenValues.has(option.value)) {
          issues.push({
            path: optionPath,
            code: "duplicate_option_value",
            message: `duplicate option value "${option.value}"`,
          });
        }
        seenValues.add(option.value);

        if (option.goTo && block.kind === "multi_select") {
          issues.push({
            path: optionPath,
            code: "branch_not_allowed",
            message:
              "branching is only available on single-choice questions (radio / dropdown)",
          });
        }
      });
    });
  });

  // --- branch targets: must exist and point forward ------------------------
  const checkTarget = (
    target: string,
    fromIndex: number,
    path: string,
  ): boolean => {
    if (target === SUBMIT_TARGET) return true;
    const targetIndex = pageIndexById.get(target);
    if (targetIndex === undefined) {
      issues.push({
        path,
        code: "unknown_branch_target",
        message: `"${target}" is not a section in this questionnaire`,
      });
      return false;
    }
    if (targetIndex === fromIndex) {
      issues.push({
        path,
        code: "self_branch",
        message: "a section cannot branch to itself — that is an infinite loop",
      });
      return false;
    }
    if (targetIndex < fromIndex) {
      issues.push({
        path,
        code: "backward_branch",
        message: `"${target}" comes earlier in the questionnaire — branches must move forward so a respondent can never loop`,
      });
      return false;
    }
    return true;
  };

  const edges: string[][] = pages.map(() => []);
  pages.forEach((page, pageIndex) => {
    const pagePath = `pages[${pageIndex}]`;
    const out = edges[pageIndex];
    if (!out) return;

    // The fall-through edge is always live: an explicit `next` replaces the
    // linear one, and a branching question only diverts the options that
    // actually carry a `goTo`.
    if (page.next) {
      if (checkTarget(page.next, pageIndex, `${pagePath}.next`)) {
        out.push(page.next);
      }
    } else {
      out.push(fallthroughTarget(page, pageIndex, pages));
    }

    pageBlocks(page).forEach((block, blockIndex) => {
      for (const { index, target } of optionBranchTargets(block)) {
        const path = `${pagePath}.questions[${blockIndex}].options[${index}].goTo`;
        if (checkTarget(target, pageIndex, path)) out.push(target);
      }
    });
  });

  // --- reachability: every section must be arrivable from the first --------
  // Forward-only edges make this a single left-to-right sweep; no cycle
  // detection is needed because a cycle cannot be expressed.
  if (issues.length === 0 && pages.length > 0) {
    const reachable = new Set<string>();
    const first = pages[0];
    if (first) reachable.add(first.id);
    pages.forEach((page, pageIndex) => {
      if (!reachable.has(page.id)) return;
      for (const target of edges[pageIndex] ?? []) {
        if (target !== SUBMIT_TARGET) reachable.add(target);
      }
    });
    pages.forEach((page, pageIndex) => {
      if (!reachable.has(page.id)) {
        issues.push({
          path: `pages[${pageIndex}]`,
          code: "unreachable_page",
          message: `section "${page.id}" can never be reached — no branch or fall-through leads to it`,
        });
      }
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, definition, issues: [] };
}

/** Convenience: is this raw value a structurally valid definition? */
export function isValidQuestionnaireDefinition(raw: unknown): boolean {
  return validateQuestionnaireDefinition(raw).ok;
}
