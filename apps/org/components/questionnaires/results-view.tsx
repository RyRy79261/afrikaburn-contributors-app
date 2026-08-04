"use client";

import * as React from "react";
import { Download, FileWarning, Star } from "lucide-react";
import type { QuestionAggregate, QuestionnaireResults } from "@quagga/core";
import {
  isOtherAnswer,
  otherAnswerText,
  type Question,
  type Questionnaire,
  type QuestionnaireResponses,
  type QuestionnaireResponseValue,
} from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@quagga/ui/components/tabs";
import { cn } from "@quagga/ui/lib/utils";

import { ResponseViewer } from "@/components/questionnaire/response-viewer";

// Results v2 (questionnaire-spec §"Author/admin features": response summary
// with per-question charts + CSV export).
//
// Every number on this screen comes from @quagga/core's `aggregateResponses`;
// nothing is counted here. This module only decides which shape each aggregate
// deserves — bar rows for choices, a histogram for scales, a star distribution
// for ratings, buckets for dates/times, a plain list for free text.

export interface ResultRowView {
  userId: string;
  email: string | null;
  status: "pending" | "completed" | "waived" | "expired";
  completedLabel: string;
  responses: QuestionnaireResponses | null;
}

const STATUS_STYLE: Record<
  string,
  { label: string; variant: "success" | "warning" | "secondary" | "outline" }
> = {
  completed: { label: "Completed", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  waived: { label: "Waived", variant: "secondary" },
  expired: { label: "Expired", variant: "outline" },
};

const CHART_LABEL: Record<QuestionAggregate["chart"], string> = {
  choice: "Choice",
  scale: "Linear scale",
  rating: "Rating",
  boolean: "Yes / No",
  timeline: "Dates & times",
  text: "Text answers",
  grid: "Grid",
};

export function ResultsView({
  summary,
  rows,
  questions,
  questionnaire,
  exportName,
}: {
  summary: QuestionnaireResults;
  rows: readonly ResultRowView[];
  questions: readonly Question[];
  questionnaire: Questionnaire;
  exportName: string;
}) {
  return (
    <Tabs defaultValue="summary">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="individual">Individual</TabsTrigger>
        </TabsList>
        <CsvExportButton
          rows={rows}
          questions={questions}
          exportName={exportName}
        />
      </div>

      <TabsContent value="summary">
        {summary.totalResponses === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No one has submitted answers yet — there is nothing to summarise.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <OrphanDisclosure orphans={summary.orphans} />
            {summary.questions.map((aggregate) => (
              <QuestionSummary
                key={aggregate.questionId}
                aggregate={aggregate}
              />
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="individual">
        {rows.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No one matched this audience when it was sent. Grant-requester
              audiences stay empty until the MV/art registration flows ship.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Completed</TableHead>
                      <TableHead className="text-right">Response</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const style =
                        STATUS_STYLE[row.status] ?? STATUS_STYLE.pending!;
                      return (
                        <TableRow key={row.userId}>
                          <TableCell className="font-medium">
                            {row.email ?? "Unknown user"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={style.variant}>{style.label}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.completedLabel}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.responses ? (
                              <ResponseViewer
                                questionnaire={questionnaire}
                                responses={row.responses}
                                respondent={row.email ?? "Unknown user"}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
}

/**
 * Answers whose question no longer exists in the definition. The engine keeps
 * them rather than dropping them silently, so the author can see the data was
 * collected before they deleted the question.
 */
function OrphanDisclosure({
  orphans,
}: {
  orphans: QuestionnaireResults["orphans"];
}) {
  if (orphans.length === 0) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
      <FileWarning
        className="mt-0.5 h-5 w-5 shrink-0 text-warning"
        aria-hidden
      />
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-semibold text-foreground">
          {orphans.length === 1
            ? "1 question was removed after people answered it"
            : `${orphans.length} questions were removed after people answered them`}
        </p>
        <p className="text-muted-foreground">
          These answers are still stored against the response — they just have
          no question to chart any more.
        </p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {orphans.map((o) => (
            <li key={o.questionId} className="text-xs">
              <span className="font-mono text-foreground">{o.questionId}</span>
              <span className="text-muted-foreground">
                {" "}
                — {o.count} {o.count === 1 ? "answer" : "answers"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function QuestionSummary({ aggregate }: { aggregate: QuestionAggregate }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Badge variant="outline">{CHART_LABEL[aggregate.chart]}</Badge>
            <h3 className="text-base font-semibold">{aggregate.prompt}</h3>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {aggregate.responded} answered · {aggregate.skipped} skipped
          </span>
        </div>
        <AggregateChart aggregate={aggregate} />
      </CardContent>
    </Card>
  );
}

function AggregateChart({ aggregate }: { aggregate: QuestionAggregate }) {
  if (aggregate.responded === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nobody answered this question.
      </p>
    );
  }

  switch (aggregate.chart) {
    case "choice":
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {aggregate.options.map((option) => (
              <BarRow
                key={option.value}
                label={option.label || option.value}
                count={option.count}
                percent={option.percent}
              />
            ))}
          </div>
          {aggregate.other.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-3">
              <span className="text-xs font-medium text-muted-foreground">
                “Other…” answers
              </span>
              <ul className="flex flex-col gap-0.5">
                {aggregate.other.map((o) => (
                  <li key={o.text} className="text-sm">
                    {o.text || <em className="text-muted-foreground">blank</em>}
                    <span className="text-muted-foreground"> × {o.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );

    case "boolean":
      return (
        <div className="flex flex-col gap-2">
          <BarRow
            label="Yes"
            count={aggregate.yes}
            percent={aggregate.percentYes}
          />
          <BarRow
            label="No"
            count={aggregate.no}
            percent={Math.round((100 - aggregate.percentYes) * 10) / 10}
          />
        </div>
      );

    case "scale":
      return (
        <div className="flex flex-col gap-3">
          <Histogram buckets={aggregate.buckets} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {aggregate.minLabel
                ? `${aggregate.min} — ${aggregate.minLabel}`
                : aggregate.min}
            </span>
            <span className="font-medium text-foreground">
              Average{" "}
              <span className="tabular-nums">{aggregate.average ?? "—"}</span>
            </span>
            <span>
              {aggregate.maxLabel
                ? `${aggregate.max} — ${aggregate.maxLabel}`
                : aggregate.max}
            </span>
          </div>
        </div>
      );

    case "rating":
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {[...aggregate.buckets].reverse().map((bucket) => (
              <BarRow
                key={bucket.value}
                label={
                  <span className="flex items-center gap-1">
                    <span className="tabular-nums">{bucket.value}</span>
                    <Star
                      className="h-3.5 w-3.5 fill-current text-warning"
                      aria-hidden
                    />
                  </span>
                }
                count={bucket.count}
                percent={bucket.percent}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Average{" "}
            <span className="font-medium tabular-nums text-foreground">
              {aggregate.average ?? "—"}
            </span>{" "}
            out of {aggregate.steps}
          </p>
        </div>
      );

    case "timeline":
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {aggregate.buckets.map((bucket) => (
              <BarRow
                key={bucket.value}
                label={bucket.value}
                count={bucket.count}
                percent={bucket.percent}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Earliest {aggregate.earliest ?? "—"} · latest{" "}
            {aggregate.latest ?? "—"}
          </p>
        </div>
      );

    case "text":
      return <TextAnswers answers={aggregate.answers} />;

    case "grid":
      return (
        <div className="flex flex-col gap-4">
          {aggregate.rows.map((row) => (
            <div key={row.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{row.label}</span>
                <span className="text-xs text-muted-foreground">
                  {row.responded}{" "}
                  {row.responded === 1 ? "response" : "responses"}
                </span>
              </div>
              {row.responded === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nobody answered this row.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {row.columns.map((column) => (
                    <BarRow
                      key={column.value}
                      label={column.label || column.value}
                      count={column.count}
                      percent={column.percent}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      );
  }
}

function BarRow({
  label,
  count,
  percent,
}: {
  label: React.ReactNode;
  count: number;
  percent: number;
}) {
  // The label/value gutters are fixed at md+ so bars line up down the card. On
  // a 360px phone those same widths (160 + 112 + gaps) left the track ~24px —
  // invisible — so below md the label goes full-width above the bar and the
  // count sits in a narrow gutter beside it (frame nRtO7 keeps a real track).
  return (
    <div className="flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
      <span
        className="truncate text-sm md:w-40 md:shrink-0"
        title={typeof label === "string" ? label : undefined}
      >
        {label}
      </span>
      <div className="flex items-center gap-2 md:contents">
        <div className="h-6 flex-1 overflow-hidden rounded-sm bg-muted">
          <div
            className="h-full rounded-sm bg-accent transition-all"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground md:w-28">
          {count} · {percent}%
        </span>
      </div>
    </div>
  );
}

function Histogram({
  buckets,
}: {
  buckets: readonly { value: number; count: number; percent: number }[];
}) {
  const peak = buckets.reduce((max, b) => Math.max(max, b.count), 0) || 1;
  return (
    <div className="flex items-end gap-2" style={{ height: 160 }}>
      {buckets.map((bucket) => (
        <div
          key={bucket.value}
          className="flex flex-1 flex-col items-center justify-end gap-1"
        >
          <span className="text-xs tabular-nums text-muted-foreground">
            {bucket.count}
          </span>
          <div
            className={cn(
              "w-full rounded-t-sm bg-accent",
              bucket.count === 0 && "bg-muted",
            )}
            style={{ height: `${Math.max(2, (bucket.count / peak) * 110)}px` }}
            title={`${bucket.value}: ${bucket.count} (${bucket.percent}%)`}
          />
          <span className="text-xs tabular-nums">{bucket.value}</span>
        </div>
      ))}
    </div>
  );
}

function TextAnswers({ answers }: { answers: readonly string[] }) {
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded ? answers : answers.slice(0, 5);
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {shown.map((answer, i) => (
          <li key={`${i}-${answer.slice(0, 24)}`} className="px-3 py-2 text-sm">
            {answer}
          </li>
        ))}
      </ul>
      {answers.length > 5 ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Show fewer" : `View all ${answers.length} answers`}
        </Button>
      ) : null}
    </div>
  );
}

// --- CSV export ----------------------------------------------------------

function optionLabelMap(questions: readonly Question[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const q of questions) {
    if (q.kind === "single_select" || q.kind === "multi_select") {
      for (const o of q.options) labels.set(`${q.id}:${o.value}`, o.label);
    }
    if (q.kind === "multi_choice_grid" || q.kind === "checkbox_grid") {
      for (const row of q.rows) labels.set(`${q.id}:row:${row.id}`, row.label);
      for (const col of q.columns)
        labels.set(`${q.id}:col:${col.value}`, col.label);
    }
  }
  return labels;
}

function formatCell(
  questionId: string,
  value: QuestionnaireResponseValue | undefined,
  labels: Map<string, string>,
): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const one = (v: string) =>
    isOtherAnswer(v)
      ? `Other: ${otherAnswerText(v)}`
      : (labels.get(`${questionId}:${v}`) ?? v);
  if (Array.isArray(value)) return value.map(one).join("; ");
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    // Grid answer: { rowId: columnValue[] } → "Row: Col A, Col B | Row2: …".
    const parts: string[] = [];
    for (const [rowId, picks] of Object.entries(value)) {
      if (!Array.isArray(picks) || picks.length === 0) continue;
      const rowLabel = labels.get(`${questionId}:row:${rowId}`) ?? rowId;
      const cols = picks
        .map((v) => labels.get(`${questionId}:col:${v}`) ?? v)
        .join(", ");
      parts.push(`${rowLabel}: ${cols}`);
    }
    return parts.join(" | ");
  }
  return one(value);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function CsvExportButton({
  rows,
  questions,
  exportName,
}: {
  rows: readonly ResultRowView[];
  questions: readonly Question[];
  exportName: string;
}) {
  function download() {
    const labels = optionLabelMap(questions);
    const header = [
      "Recipient",
      "Status",
      "Completed",
      ...questions.map((q) => q.prompt),
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const row of rows) {
      const cells = [
        row.email ?? "Unknown user",
        row.status,
        row.completedLabel === "—" ? "" : row.completedLabel,
        ...questions.map((q) =>
          formatCell(q.id, row.responses?.[q.id], labels),
        ),
      ];
      lines.push(cells.map(csvCell).join(","));
    }
    // BOM so Excel opens UTF-8 answers correctly.
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${exportName}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={download}
      disabled={rows.length === 0}
    >
      <Download aria-hidden />
      Export CSV
    </Button>
  );
}
