"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import type { DefinitionIssue } from "@quagga/core";
import { cn } from "@quagga/ui/lib/utils";

// Rendering for @quagga/core's `validateQuestionnaireDefinition` output.
//
// The validator addresses every defect with a DOTTED PATH into the definition
// — `pages[2].questions[0].options[1].goTo`. This module is the only place that
// knows how to read one, so the builder can hang each issue on the exact
// section / question / option it belongs to instead of dumping a wall of text.
//
// Two path dialects arrive here and both are handled:
//   - structural issues:  pages[2].questions[0].options[1]
//   - Zod shape issues:   pages.2.questions.0.prompt

export interface IssueLocation {
  pageIndex: number | null;
  blockIndex: number | null;
  optionIndex: number | null;
}

function segmentIndex(path: string, key: string): number | null {
  const match = new RegExp(`${key}(?:\\[(\\d+)\\]|\\.(\\d+))`).exec(path);
  if (!match) return null;
  const raw = match[1] ?? match[2];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

/** Where in the definition an issue points. Nulls mean "not that specific". */
export function issueLocation(issue: DefinitionIssue): IssueLocation {
  return {
    pageIndex: segmentIndex(issue.path, "pages"),
    blockIndex: segmentIndex(issue.path, "questions"),
    optionIndex: segmentIndex(issue.path, "options"),
  };
}

/** Issues addressed at a section itself (its title, its `next` branch). */
export function sectionIssues(
  issues: readonly DefinitionIssue[],
  pageIndex: number,
): DefinitionIssue[] {
  return issues.filter((i) => {
    const loc = issueLocation(i);
    return loc.pageIndex === pageIndex && loc.blockIndex === null;
  });
}

/** Issues on one block — including the ones on its options. */
export function blockIssues(
  issues: readonly DefinitionIssue[],
  pageIndex: number,
  blockIndex: number,
): DefinitionIssue[] {
  return issues.filter((i) => {
    const loc = issueLocation(i);
    return loc.pageIndex === pageIndex && loc.blockIndex === blockIndex;
  });
}

/** Issues on one option of one block. */
export function optionIssues(
  issues: readonly DefinitionIssue[],
  pageIndex: number,
  blockIndex: number,
  optionIndex: number,
): DefinitionIssue[] {
  return issues.filter((i) => {
    const loc = issueLocation(i);
    return (
      loc.pageIndex === pageIndex &&
      loc.blockIndex === blockIndex &&
      loc.optionIndex === optionIndex
    );
  });
}

/** "Section 2 · Question 1 · Option 3" for the summary list. */
export function issueBreadcrumb(
  issue: DefinitionIssue,
  sectionTitles: readonly string[],
): string {
  const loc = issueLocation(issue);
  if (loc.pageIndex === null) return "Questionnaire";
  const parts = [
    sectionTitles[loc.pageIndex]?.trim() || `Section ${loc.pageIndex + 1}`,
  ];
  if (loc.blockIndex !== null) parts.push(`Block ${loc.blockIndex + 1}`);
  if (loc.optionIndex !== null) parts.push(`Option ${loc.optionIndex + 1}`);
  return parts.join(" · ");
}

/** The inline red note rendered next to an offending field. */
export function IssueNote({
  issues,
  className,
}: {
  issues: readonly DefinitionIssue[];
  className?: string;
}) {
  if (issues.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-1", className)}>
      {issues.map((issue, i) => (
        <li
          key={`${issue.path}-${i}`}
          className="flex items-start gap-1.5 text-xs text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The blocking-issues panel above the builder. Every issue is listed with the
 * place it belongs to — the author never has to guess which question broke.
 */
export function DefinitionIssuePanel({
  issues,
  sectionTitles,
}: {
  issues: readonly DefinitionIssue[];
  sectionTitles: readonly string[];
}) {
  if (issues.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        {issues.length === 1
          ? "1 problem is blocking this save"
          : `${issues.length} problems are blocking this save`}
      </p>
      <p className="text-xs text-muted-foreground">
        A questionnaire is only saved once it holds together — unique question
        ids, forward-only branches, every section reachable.
      </p>
      <ul className="flex flex-col gap-1.5">
        {issues.map((issue, i) => (
          <li key={`${issue.path}-${i}`} className="text-xs">
            <span className="font-medium text-foreground">
              {issueBreadcrumb(issue, sectionTitles)}
            </span>
            <span className="text-muted-foreground"> — {issue.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
