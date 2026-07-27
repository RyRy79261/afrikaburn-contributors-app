"use client";

import * as React from "react";
import { Check, Heart, Star } from "lucide-react";
import {
  attendedYearOptions,
  isOtherAnswer,
  otherAnswerText,
  toOtherAnswer,
  type Question,
  type QuestionOption,
  type QuestionnaireResponseValue,
} from "@quagga/types";
import { FileUpload } from "@quagga/ui/components/file-upload";
import { Input } from "@quagga/ui/components/input";
import { Textarea } from "@quagga/ui/components/textarea";
import { PhoneInput } from "@quagga/ui/components/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { cn } from "@quagga/ui/lib/utils";

interface FieldProps {
  question: Question;
  value: QuestionnaireResponseValue | undefined;
  error?: string;
  onChange: (value: QuestionnaireResponseValue) => void;
  /** Presentation-ordered options (from `presentationOptions` — seeded shuffle).
   * Falls back to the definition's own order. */
  options?: readonly QuestionOption[];
  /** Deployment has BLOB_READ_WRITE_TOKEN → file_link questions get a real
   *  uploader instead of only the URL-paste field. */
  blobConfigured?: boolean;
}

/** Sentinel for the "Other…" choice in a dropdown (never a stored value — the
 * stored value is always `other:<text>`; see @quagga/types OTHER_PREFIX). */
const OTHER_SENTINEL = "__other__";

/** Render one questionnaire question as a labelled control. Data-driven — the
 * `kind` (and, for choice questions, the `display` variant) picks the control;
 * the value shape follows the question kind. */
export function QuestionField({
  question,
  value,
  error,
  onChange,
  options,
  blobConfigured = false,
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
          <span className="ml-1 text-primary" aria-hidden>
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
        options={options}
        describedBy={describedBy}
        blobConfigured={blobConfigured}
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
  options,
  describedBy,
  blobConfigured = false,
}: FieldProps & { describedBy?: string }) {
  switch (question.kind) {
    case "short_text":
    case "email":
      return (
        <Input
          id={question.id}
          type={inputTypeFor(question)}
          value={typeof value === "string" ? value : ""}
          placeholder={
            "placeholder" in question ? question.placeholder : undefined
          }
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "phone":
      return (
        <PhoneInput
          id={question.id}
          value={typeof value === "string" ? value : ""}
          placeholder={question.placeholder}
          describedBy={describedBy}
          onChange={(v) => onChange(v)}
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

    // Builder v2: time of day, 24h hh:mm.
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

    // Builder v2 "file upload": a real Blob uploader when the deployment has
    // BLOB_READ_WRITE_TOKEN; otherwise the respondent pastes a URL to a file
    // they host. The stored value is a URL either way.
    case "file_link": {
      const url = typeof value === "string" ? value : "";
      return (
        <div className="flex flex-col gap-1.5">
          <FileUpload
            value={url ? [url] : []}
            onChange={(urls) => onChange(urls[0] ?? "")}
            blobConfigured={blobConfigured}
            handleUploadUrl="/api/blob/upload"
            kind="questionnaire-files"
            variant="file"
            maxFiles={1}
            maxSizeBytes={25 * 1024 * 1024}
            hint="PDF, image, or document — up to 25 MB"
            urlPlaceholder={question.placeholder ?? "https://…"}
            ariaLabel="Upload your file"
          />
        </div>
      );
    }

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
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-input bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      );

    // Builder v2: 0/1..max scale with optional end labels.
    case "linear_scale": {
      const current = typeof value === "number" ? value : null;
      const steps: number[] = [];
      for (let n = question.min; n <= question.max; n++) steps.push(n);
      return (
        <div className="flex flex-col gap-1.5">
          <div
            role="radiogroup"
            aria-describedby={describedBy}
            aria-label={question.prompt}
            className="flex flex-wrap items-end gap-2"
          >
            {steps.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={current === n}
                onClick={() => onChange(n)}
                className="flex w-10 flex-col items-center gap-1"
              >
                <span className="text-xs tabular-nums text-muted-foreground">
                  {n}
                </span>
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
                    current === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-muted",
                  )}
                >
                  {current === n && <Check className="h-4 w-4" aria-hidden />}
                </span>
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

    // Builder v2: 3–10 step rating, star/heart/number glyph.
    case "rating": {
      const current = typeof value === "number" ? value : 0;
      const steps = Array.from({ length: question.steps }, (_, i) => i + 1);
      const Glyph = question.glyph === "heart" ? Heart : Star;
      return (
        <div className="flex flex-col gap-1.5">
          <div
            role="radiogroup"
            aria-describedby={describedBy}
            aria-label={question.prompt}
            className="flex flex-wrap items-center gap-1"
          >
            {steps.map((n) => {
              const on = current >= n;
              const label = `${n} out of ${question.steps}`;
              if (question.glyph === "number") {
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={current === n}
                    aria-label={label}
                    onClick={() => onChange(n)}
                    className={cn(
                      "h-9 w-9 rounded-md border text-sm tabular-nums transition-colors",
                      current === n
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-muted",
                    )}
                  >
                    {n}
                  </button>
                );
              }
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={current === n}
                  aria-label={label}
                  onClick={() => onChange(n)}
                  className="rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Glyph
                    className={cn(
                      "h-7 w-7 transition-colors",
                      on ? "fill-accent text-accent" : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {current > 0
              ? `${current} out of ${question.steps}`
              : `Tap to rate — up to ${question.steps}`}
          </p>
        </div>
      );
    }

    case "single_select": {
      const opts = options ?? question.options;
      const raw = typeof value === "string" ? value : "";
      const other = isOtherAnswer(raw);
      const otherText = otherAnswerText(raw);

      // Long option lists render as a dropdown (Builder v2 `display`).
      if (question.display === "dropdown") {
        return (
          <div className="flex flex-col gap-2">
            <Select
              value={other ? OTHER_SENTINEL : raw || undefined}
              onValueChange={(v) =>
                onChange(v === OTHER_SENTINEL ? toOtherAnswer(otherText) : v)
              }
            >
              <SelectTrigger id={question.id} aria-describedby={describedBy}>
                <SelectValue placeholder="Choose an option" />
              </SelectTrigger>
              <SelectContent>
                {opts.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
                {question.allowOther && (
                  <SelectItem value={OTHER_SENTINEL}>
                    {question.otherLabel ?? "Other…"}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {other && (
              <OtherInput
                id={`${question.id}-other`}
                value={otherText}
                onChange={(text) => onChange(toOtherAnswer(text))}
              />
            )}
          </div>
        );
      }

      // Image grid — multiple-choice-with-images.
      if (question.display === "image_grid") {
        return (
          <div className="flex flex-col gap-2">
            <div
              role="radiogroup"
              aria-describedby={describedBy}
              aria-label={question.prompt}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {opts.map((opt) => (
                <ImageOption
                  key={opt.value}
                  option={opt}
                  selected={raw === opt.value}
                  role="radio"
                  onToggle={() => onChange(opt.value)}
                />
              ))}
            </div>
            {question.allowOther && (
              <OtherChoiceRow
                label={question.otherLabel ?? "Other…"}
                selected={other}
                text={otherText}
                inputId={`${question.id}-other`}
                onSelect={() => onChange(toOtherAnswer(otherText))}
                onText={(text) => onChange(toOtherAnswer(text))}
              />
            )}
          </div>
        );
      }

      // Default: radio rows (with option thumbnails when the author set them).
      return (
        <div
          className="flex flex-col gap-1.5"
          role="radiogroup"
          aria-describedby={describedBy}
          aria-label={question.prompt}
        >
          {opts.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={raw === opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                raw === opt.value
                  ? "border-primary bg-primary/10"
                  : "border-input bg-background hover:bg-muted",
              )}
            >
              {opt.imageUrl && (
                <OptionThumb
                  url={opt.imageUrl}
                  alt={opt.imageAlt ?? opt.label}
                />
              )}
              <span className="min-w-0 flex-1">{opt.label}</span>
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  raw === opt.value ? "border-primary" : "border-input",
                )}
                aria-hidden
              >
                {raw === opt.value && (
                  <Check className="h-3.5 w-3.5 text-primary" />
                )}
              </span>
            </button>
          ))}
          {question.allowOther && (
            <OtherChoiceRow
              label={question.otherLabel ?? "Other…"}
              selected={other}
              text={otherText}
              inputId={`${question.id}-other`}
              onSelect={() => onChange(toOtherAnswer(otherText))}
              onText={(text) => onChange(toOtherAnswer(text))}
            />
          )}
        </div>
      );
    }

    case "multi_select": {
      const opts = options ?? question.options;
      const selected = Array.isArray(value) ? value.map(String) : [];
      const selectedSet = new Set(selected);
      const otherValue = selected.find((v) => isOtherAnswer(v));
      const otherText = otherValue ? otherAnswerText(otherValue) : "";

      const toggle = (v: string) => {
        const next = selected.filter((s) => s !== v);
        if (next.length === selected.length) next.push(v);
        onChange(next);
      };
      const setOther = (text: string) => {
        const next = selected.filter((s) => !isOtherAnswer(s));
        next.push(toOtherAnswer(text));
        onChange(next);
      };
      const clearOther = () =>
        onChange(selected.filter((s) => !isOtherAnswer(s)));

      const limits = selectionHint(
        question.minSelections,
        question.maxSelections,
      );

      if (question.display === "image_grid") {
        return (
          <div className="flex flex-col gap-2">
            <div
              aria-describedby={describedBy}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {opts.map((opt) => (
                <ImageOption
                  key={opt.value}
                  option={opt}
                  selected={selectedSet.has(opt.value)}
                  role="checkbox"
                  onToggle={() => toggle(opt.value)}
                />
              ))}
            </div>
            {question.allowOther && (
              <OtherChoiceRow
                label={question.otherLabel ?? "Other…"}
                selected={otherValue !== undefined}
                text={otherText}
                inputId={`${question.id}-other`}
                onSelect={() =>
                  otherValue === undefined ? setOther("") : clearOther()
                }
                onText={setOther}
              />
            )}
            {limits && (
              <p className="text-xs text-muted-foreground">{limits}</p>
            )}
          </div>
        );
      }

      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2" aria-describedby={describedBy}>
            {opts.map((opt) => {
              const on = selectedSet.has(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(opt.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                    on
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-input bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  {on && <Check className="h-3.5 w-3.5 text-primary" />}
                  {opt.label}
                </button>
              );
            })}
          </div>
          {question.allowOther && (
            <OtherChoiceRow
              label={question.otherLabel ?? "Other…"}
              selected={otherValue !== undefined}
              text={otherText}
              inputId={`${question.id}-other`}
              onSelect={() =>
                otherValue === undefined ? setOther("") : clearOther()
              }
              onText={setOther}
            />
          )}
          {limits && <p className="text-xs text-muted-foreground">{limits}</p>}
        </div>
      );
    }

    case "multi_choice_grid":
    case "checkbox_grid":
      return (
        <GridControl
          question={question}
          value={value}
          onChange={onChange}
          describedBy={describedBy}
        />
      );

    case "years": {
      const selected = Array.isArray(value) ? value.map((v) => String(v)) : [];
      return (
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={selected}
          onValueChange={(vals) => onChange(vals)}
          aria-describedby={describedBy}
          className="justify-start"
        >
          {attendedYearOptions().map(({ year, disabled }) => (
            <ToggleGroupItem
              key={year}
              value={String(year)}
              disabled={disabled}
              aria-label={disabled ? `${year} — no burn was held` : `${year}`}
              title={disabled ? "No burn was held this year" : undefined}
              className="h-auto flex-col gap-0 py-1.5"
            >
              <span className="text-sm tabular-nums">{year}</span>
              {disabled && (
                <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                  no burn
                </span>
              )}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      );
    }
  }
}

/** Grid question control — rows down the side, shared columns across. A
 * multiple-choice grid takes one column per row (radio); a checkbox grid takes
 * any number (checkbox). The value is a `{ [rowId]: columnValue[] }` map. */
function GridControl({
  question,
  value,
  onChange,
  describedBy,
}: {
  question: Extract<Question, { kind: "multi_choice_grid" | "checkbox_grid" }>;
  value: QuestionnaireResponseValue | undefined;
  onChange: (value: QuestionnaireResponseValue) => void;
  describedBy?: string;
}) {
  const single = question.kind === "multi_choice_grid";
  const answer: Record<string, string[]> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, string[]>)
      : {};

  function setCell(rowId: string, columnValue: string) {
    const current = answer[rowId] ?? [];
    const on = current.includes(columnValue);
    const nextRow = single
      ? on
        ? [] // clicking the chosen column again clears the row
        : [columnValue]
      : on
        ? current.filter((v) => v !== columnValue)
        : [...current, columnValue];
    const next: Record<string, string[]> = { ...answer };
    if (nextRow.length === 0) delete next[rowId];
    else next[rowId] = nextRow;
    onChange(next);
  }

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
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-muted",
                        )}
                      >
                        {on && <Check className="h-3.5 w-3.5" aria-hidden />}
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

/** The `<input type>` for a short-text question, following its format preset. */
function inputTypeFor(question: Question): string {
  if (question.kind === "email") return "email";
  if (question.kind !== "short_text") return "text";
  switch (question.format) {
    case "email":
      return "email";
    case "url":
      return "url";
    case "phone":
      return "tel";
    case "number":
    case "integer":
      return "number";
    default:
      return "text";
  }
}

function selectionHint(
  min: number | undefined,
  max: number | undefined,
): string | null {
  if (min != null && max != null) return `Pick ${min}–${max} options.`;
  if (min != null) return `Pick at least ${min}.`;
  if (max != null) return `Pick at most ${max}.`;
  return null;
}

function OptionThumb({ url, alt }: { url: string; alt: string }) {
  return (
    // Author-supplied remote URL — next/image would need host allowlisting we
    // deliberately don't configure (no blob infra yet).
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className="h-12 w-12 shrink-0 rounded-md border border-border object-cover"
    />
  );
}

function ImageOption({
  option,
  selected,
  role,
  onToggle,
}: {
  option: QuestionOption;
  selected: boolean;
  role: "radio" | "checkbox";
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      onClick={onToggle}
      className={cn(
        "flex flex-col gap-2 rounded-md border p-2 text-left text-sm transition-colors",
        selected
          ? "border-primary bg-primary/10"
          : "border-input bg-background hover:bg-muted",
      )}
    >
      {option.imageUrl ? (
        <img
          src={option.imageUrl}
          alt={option.imageAlt ?? option.label}
          loading="lazy"
          className="aspect-video w-full rounded-sm border border-border object-cover"
        />
      ) : (
        <span
          className="flex aspect-video w-full items-center justify-center rounded-sm bg-muted text-xs text-muted-foreground"
          aria-hidden
        >
          No image
        </span>
      )}
      <span className="flex items-center gap-1.5">
        {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
        <span className="min-w-0 truncate">{option.label}</span>
      </span>
    </button>
  );
}

/** The "Other…" row on a choice question: a selectable row plus its free-text
 * input. The stored value is `other:<text>` (@quagga/types OTHER_PREFIX). */
function OtherChoiceRow({
  label,
  selected,
  text,
  inputId,
  onSelect,
  onText,
}: {
  label: string;
  selected: boolean;
  text: string;
  inputId: string;
  onSelect: () => void;
  onText: (text: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
          selected
            ? "border-primary bg-primary/10"
            : "border-input bg-background text-muted-foreground hover:bg-muted",
        )}
      >
        {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
        {label}
      </button>
      {selected && <OtherInput id={inputId} value={text} onChange={onText} />}
    </div>
  );
}

function OtherInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <Input
      id={id}
      value={value}
      placeholder="Tell us more…"
      aria-label="Your other answer"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
