"use client";

import { Check } from "lucide-react";
import type { Question, QuestionnaireResponseValue } from "@quagga/types";
import { Input } from "@quagga/ui/components/input";
import { Textarea } from "@quagga/ui/components/textarea";
import { cn } from "@quagga/ui/lib/utils";

interface FieldProps {
  question: Question;
  value: QuestionnaireResponseValue | undefined;
  error?: string;
  onChange: (value: QuestionnaireResponseValue) => void;
}

/**
 * Render one questionnaire question as a labelled control. Ported from the
 * participant runner (apps/web) but trimmed to the field kinds the console
 * builder produces (short_text, long_text, single_select, multi_select,
 * boolean) — the fill view still handles any kind the engine defines so seeded
 * definitions render too.
 */
export function QuestionField({
  question,
  value,
  error,
  onChange,
}: FieldProps) {
  const describedBy = error
    ? `${question.id}-error`
    : question.helper
      ? `${question.id}-help`
      : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={question.id} className="text-sm font-medium">
        {question.prompt}
        {"required" in question && question.required && (
          <span className="ml-1 text-accent" aria-hidden>
            *
          </span>
        )}
      </label>
      {question.helper && (
        <p id={`${question.id}-help`} className="text-xs text-muted-foreground">
          {question.helper}
        </p>
      )}

      <Control
        question={question}
        value={value}
        onChange={onChange}
        describedBy={describedBy}
      />

      {error && (
        <p id={`${question.id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Control({
  question,
  value,
  onChange,
  describedBy,
}: FieldProps & { describedBy?: string }) {
  switch (question.kind) {
    case "short_text":
    case "email":
    case "phone":
      return (
        <Input
          id={question.id}
          type={question.kind === "email" ? "email" : "text"}
          value={typeof value === "string" ? value : ""}
          placeholder={
            "placeholder" in question ? question.placeholder : undefined
          }
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "long_text":
      return (
        <Textarea
          id={question.id}
          rows={5}
          value={typeof value === "string" ? value : ""}
          placeholder={question.placeholder}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "date":
      return (
        <Input
          id={question.id}
          type="date"
          value={typeof value === "string" ? value : ""}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "boolean":
      return (
        <div className="flex gap-2">
          {[
            { v: true, label: "Yes" },
            { v: false, label: "No" },
          ].map(({ v, label }) => (
            <button
              key={label}
              type="button"
              aria-pressed={value === v}
              onClick={() => onChange(v)}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                value === v
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-input bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      );

    case "single_select":
      return (
        <div
          className="flex flex-col gap-1.5"
          role="radiogroup"
          aria-describedby={describedBy}
        >
          {question.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={value === opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors",
                value === opt.value
                  ? "border-accent bg-accent/10"
                  : "border-input bg-background hover:bg-muted",
              )}
            >
              <span>{opt.label}</span>
              {value === opt.value && <Check className="h-4 w-4 text-accent" />}
            </button>
          ))}
        </div>
      );

    case "multi_select": {
      const selected = new Set(Array.isArray(value) ? value : []);
      return (
        <div className="flex flex-wrap gap-2" aria-describedby={describedBy}>
          {question.options.map((opt) => {
            const on = selected.has(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(selected);
                  if (on) next.delete(opt.value);
                  else next.add(opt.value);
                  onChange([...next]);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                  on
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-input bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                {on && <Check className="h-3.5 w-3.5 text-accent" />}
                {opt.label}
              </button>
            );
          })}
        </div>
      );
    }

    case "time":
      return (
        <Input
          id={question.id}
          type="time"
          className="max-w-[10rem]"
          value={typeof value === "string" ? value : ""}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "file_link":
      return (
        <Input
          id={question.id}
          type="url"
          inputMode="url"
          value={typeof value === "string" ? value : ""}
          placeholder={question.placeholder ?? "https://…"}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "linear_scale": {
      const current = typeof value === "number" ? value : null;
      const steps: number[] = [];
      for (let n = question.min; n <= question.max; n++) steps.push(n);
      return (
        <div className="flex flex-col gap-1.5">
          <div
            role="radiogroup"
            aria-describedby={describedBy}
            className="flex flex-wrap gap-2"
          >
            {steps.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={current === n}
                onClick={() => onChange(n)}
                className={cn(
                  "h-9 w-9 rounded-full border text-sm tabular-nums transition-colors",
                  current === n
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-input bg-background hover:bg-muted",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          {(question.minLabel || question.maxLabel) && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{question.minLabel ?? ""}</span>
              <span>{question.maxLabel ?? ""}</span>
            </div>
          )}
        </div>
      );
    }

    case "rating": {
      const current = typeof value === "number" ? value : 0;
      const steps = Array.from({ length: question.steps }, (_, i) => i + 1);
      return (
        <div
          role="radiogroup"
          aria-describedby={describedBy}
          className="flex flex-wrap gap-1"
        >
          {steps.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={current === n}
              aria-label={`${n} out of ${question.steps}`}
              onClick={() => onChange(n)}
              className={cn(
                "h-9 w-9 rounded-md border text-sm tabular-nums transition-colors",
                current === n
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-input bg-background hover:bg-muted",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      );
    }

    case "multi_choice_grid":
    case "checkbox_grid": {
      const single = question.kind === "multi_choice_grid";
      const answer: Record<string, string[]> =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, string[]>)
          : {};
      const setCell = (rowId: string, columnValue: string) => {
        const current = answer[rowId] ?? [];
        const on = current.includes(columnValue);
        const nextRow = single
          ? on
            ? []
            : [columnValue]
          : on
            ? current.filter((v) => v !== columnValue)
            : [...current, columnValue];
        const next: Record<string, string[]> = { ...answer };
        if (nextRow.length === 0) delete next[rowId];
        else next[rowId] = nextRow;
        onChange(next);
      };
      return (
        <div className="overflow-x-auto">
          <table
            className="w-full border-collapse text-sm"
            aria-describedby={describedBy}
          >
            <thead>
              <tr>
                <td className="p-2" />
                {question.columns.map((column) => (
                  <th
                    key={column.value}
                    scope="col"
                    className="p-2 text-center text-xs font-medium text-muted-foreground"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {question.rows.map((row) => {
                const picks = answer[row.id] ?? [];
                return (
                  <tr key={row.id} className="border-t border-border">
                    <th
                      scope="row"
                      className="p-2 text-left text-sm font-normal text-foreground"
                    >
                      {row.label}
                    </th>
                    {question.columns.map((column) => {
                      const on = picks.includes(column.value);
                      return (
                        <td key={column.value} className="p-2 text-center">
                          <button
                            type="button"
                            role={single ? "radio" : "checkbox"}
                            aria-checked={on}
                            aria-label={`${row.label}: ${column.label}`}
                            onClick={() => setCell(row.id, column.value)}
                            className={cn(
                              "inline-flex h-6 w-6 items-center justify-center border transition-colors",
                              single ? "rounded-full" : "rounded",
                              on
                                ? "border-accent bg-accent text-accent-foreground"
                                : "border-input bg-background hover:bg-muted",
                            )}
                          >
                            {on && (
                              <Check className="h-3.5 w-3.5" aria-hidden />
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    // The console builder never emits these, but seeded definitions may — render
    // a plain text fallback so the fill view never breaks on an unknown kind.
    case "years":
      return (
        <Input
          id={question.id}
          value={Array.isArray(value) ? value.join(", ") : ""}
          placeholder="e.g. 2024, 2025"
          aria-describedby={describedBy}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      );
  }
}
