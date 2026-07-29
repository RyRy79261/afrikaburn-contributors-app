"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { countWords, CAMP_DESCRIPTION_WORD_LIMIT } from "@quagga/core";
import { Input } from "@quagga/ui/components/input";
import { Textarea } from "@quagga/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";

// Small controlled form primitives shared across the six registration section
// panels. Each fires `onCommit` on blur so the wizard can autosave; `onChange`
// keeps the live value flowing for counters and completeness indicators.

/**
 * Label + hint wrapper.
 *
 * Two modes, because only ONE of them can use a `<label>` honestly:
 *  · `htmlFor` — a single labelable control (input / textarea). Real `<label>`,
 *    clicking it focuses the control.
 *  · `labelId` — a GROUP of buttons or a Radix trigger. `<label for=…>` cannot
 *    name those (the spec only allows it to point at labelable elements), so
 *    the caller wires `aria-labelledby={labelId}` on its own group wrapper and
 *    this renders a plain `<span>` — a `<label>` pointing at nothing is a lie to
 *    both the browser and the accessibility tree.
 *
 * Passing neither leaves the control ANONYMOUS to a screen reader, which is what
 * used to happen for every button-group and select field here: the visible text
 * "Operating hours *" sat next to a row of pills announced only as "Day",
 * "Night" — the question itself was never read out.
 */
export function Labeled({
  label,
  htmlFor,
  labelId,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** Id stamped on the label text, for a group's `aria-labelledby`. */
  labelId?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const labelText = (
    <>
      {label}
      {required && (
        <span className="ml-1 text-accent" aria-hidden>
          *
        </span>
      )}
    </>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="text-sm font-medium text-foreground"
        >
          {labelText}
        </label>
      ) : (
        <span id={labelId} className="text-sm font-medium text-foreground">
          {labelText}
        </span>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  onCommit,
  hint,
  required,
  type = "text",
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  onCommit: () => void;
  hint?: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  /** Restricted rather than hidden — pair with a `hint` saying why. */
  disabled?: boolean;
}) {
  return (
    <Labeled label={label} htmlFor={id} hint={hint} required={required}>
      <Input
        id={id}
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
      />
    </Labeled>
  );
}

/**
 * Parse what the user typed against the same rule the server enforces
 * (`nullableInt`: an integer, at least `min`). Empty is "not answered", not an
 * error.
 */
function parseWholeNumber(
  raw: string,
  min: number,
): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null, error: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, error: "Enter a number." };
  if (!Number.isInteger(n)) {
    return { value: null, error: "Whole numbers only — no decimals." };
  }
  if (n < min) return { value: null, error: `Enter ${min} or more.` };
  return { value: n, error: null };
}

/**
 * Whole-number field. The typed TEXT lives here and only a value that passes
 * `parseWholeNumber` is handed up to the draft.
 *
 * It used to pass `Number(raw)` up unconditionally. The server schema is
 * `z.number().int().min(0)`, so a single "4.5" or "-3" — both of which a
 * `type="number"` input accepts happily — made the whole autosave payload fail
 * Zod. The camp then saw a permanent "Save failed — we'll retry" (the wizard
 * keeps the draft dirty and retries the same rejected payload forever), submit
 * refused because `handleSubmit` will not submit an unflushed draft, and the
 * only explanation offered was "Some answers weren't in the expected format" —
 * naming no field, on a section the camp may not even have open. Now the
 * problem is reported next to the offending input and the draft keeps its last
 * valid value.
 */
export function NumberField({
  id,
  label,
  value,
  onChange,
  onCommit,
  hint,
  required,
  min = 0,
  placeholder,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  onCommit: () => void;
  hint?: string;
  required?: boolean;
  min?: number;
  placeholder?: string;
}) {
  const [raw, setRaw] = React.useState(value === null ? "" : String(value));
  // Re-sync only when the draft's value is something this text does not already
  // represent (a fresh load, or a reset elsewhere). Comparing on the PARSED
  // value means "007" and a half-typed entry are left alone instead of being
  // rewritten under the user's cursor.
  React.useEffect(() => {
    setRaw((prev) =>
      parseWholeNumber(prev, min).value === value
        ? prev
        : value === null
          ? ""
          : String(value),
    );
  }, [value, min]);

  const { error } = parseWholeNumber(raw, min);
  const errorId = `${id}-error`;

  return (
    <Labeled label={label} htmlFor={id} hint={hint} required={required}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        step={1}
        value={raw}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={
          error ? "border-destructive focus-visible:ring-destructive" : ""
        }
        onChange={(e) => {
          const next = e.target.value;
          setRaw(next);
          const parsed = parseWholeNumber(next, min);
          // Only a valid entry (or a cleared field) reaches the draft — an
          // invalid one must never become part of an autosave payload.
          if (parsed.error === null) onChange(parsed.value);
        }}
        onBlur={onCommit}
      />
      {error && (
        <p id={errorId} className="text-xs text-destructive" aria-live="polite">
          {error}
        </p>
      )}
    </Labeled>
  );
}

export function TextAreaField({
  id,
  label,
  value,
  onChange,
  onCommit,
  hint,
  required,
  rows = 4,
  placeholder,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  onCommit: () => void;
  hint?: string;
  required?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <Labeled label={label} htmlFor={id} hint={hint} required={required}>
      <Textarea
        id={id}
        rows={rows}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
      />
    </Labeled>
  );
}

/** Description textarea with a live 60-word counter (build-spec §apps/web). */
export function WordLimitedTextArea({
  id,
  label,
  value,
  onChange,
  onCommit,
  hint,
  required,
  limit = CAMP_DESCRIPTION_WORD_LIMIT,
  rows = 3,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  onCommit: () => void;
  hint?: string;
  required?: boolean;
  limit?: number;
  rows?: number;
}) {
  const words = countWords(value);
  const remaining = limit - words;
  const over = remaining < 0;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-1 text-accent" aria-hidden>
            *
          </span>
        )}
      </label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <Textarea
        id={id}
        rows={rows}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        aria-describedby={`${id}-count`}
        className={
          over ? "border-destructive focus-visible:ring-destructive" : ""
        }
      />
      <p
        id={`${id}-count`}
        className={`text-xs ${over ? "text-destructive" : "text-muted-foreground"}`}
        aria-live="polite"
      >
        {over
          ? `${Math.abs(remaining)} word${Math.abs(remaining) === 1 ? "" : "s"} over the ${limit}-word limit`
          : `${remaining} word${remaining === 1 ? "" : "s"} left of ${limit}`}
      </p>
    </div>
  );
}

/** Yes / No control (nullable = unanswered). */
export function YesNoField({
  label,
  value,
  onChange,
  hint,
  required,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  hint?: string;
  required?: boolean;
}) {
  const labelId = React.useId();
  return (
    <Labeled label={label} labelId={labelId} hint={hint} required={required}>
      <div role="group" aria-labelledby={labelId} className="flex gap-2">
        {[
          { v: true, l: "Yes" },
          { v: false, l: "No" },
        ].map((opt) => (
          <button
            key={opt.l}
            type="button"
            onClick={() => onChange(opt.v)}
            aria-pressed={value === opt.v}
            className={`rounded-md border px-4 py-2 text-sm transition-colors ${
              value === opt.v
                ? "border-accent bg-accent/15 text-foreground"
                : "border-input text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.l}
          </button>
        ))}
      </div>
    </Labeled>
  );
}

/** Multi-select checkbox group backed by a string[] value. */
export function CheckGroup({
  label,
  options,
  value,
  onChange,
  hint,
  required,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  hint?: string;
  required?: boolean;
}) {
  const labelId = React.useId();
  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }
  return (
    <Labeled label={label} labelId={labelId} hint={hint} required={required}>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-2"
      >
        {options.map((opt) => {
          const on = value.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              aria-pressed={on}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                on
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-input text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </Labeled>
  );
}

/**
 * Single-choice RADIO list — a stacked radio card per option (canvas RBIDd
 * `kUckT` SOOP list): a radio dot + a title, with an optional one-line blurb.
 * Used for the sound-level (SOOP) scale where each level needs explaining.
 */
export function RadioChoiceGroup({
  label,
  options,
  value,
  onChange,
  hint,
  required,
  footnote,
}: {
  label: string;
  options: readonly { value: string; label: string; blurb?: string }[];
  value: string | null;
  onChange: (v: string) => void;
  hint?: string;
  required?: boolean;
  /** Small info line under the group (e.g. the SOOP explainer). */
  footnote?: string;
}) {
  const labelId = React.useId();
  return (
    <Labeled label={label} labelId={labelId} hint={hint} required={required}>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="flex flex-col gap-2"
      >
        {options.map((opt) => {
          const on = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(opt.value)}
              className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                on
                  ? "border-accent bg-accent/10"
                  : "border-input hover:bg-secondary/40"
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  on ? "border-accent" : "border-input"
                }`}
                aria-hidden
              >
                {on && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {opt.label}
                </span>
                {opt.blurb && (
                  <span className="text-xs text-muted-foreground">
                    {opt.blurb}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {footnote && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{footnote}</span>
        </p>
      )}
    </Labeled>
  );
}

/**
 * A dropdown select for a single choice (canvas RBIDd `qTyPN` placement selects).
 * Shows the selected option's blurb underneath as a "flag note"; a `flagNote`
 * override surfaces reviewer guidance (e.g. "reconsider this") in the warning tone.
 */
export function PlacementSelect({
  label,
  options,
  value,
  onChange,
  hint,
  required,
  placeholder = "Choose a zone",
  flagNote,
}: {
  label: string;
  options: readonly { value: string; label: string; blurb?: string }[];
  value: string | null;
  onChange: (v: string) => void;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  flagNote?: string;
}) {
  const labelId = React.useId();
  const triggerId = React.useId();
  const active = options.find((o) => o.value === value);
  return (
    <Labeled label={label} labelId={labelId} hint={hint} required={required}>
      <Select value={value ?? undefined} onValueChange={onChange}>
        {/* The trigger names itself from BOTH the field label and its own
            content, so it announces "Placement — first choice, Chill zone"
            rather than just the zone (or, before this, nothing at all when no
            zone was picked and the trigger held only a placeholder). */}
        <SelectTrigger
          id={triggerId}
          aria-labelledby={`${labelId} ${triggerId}`}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {flagNote ? (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-warning">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{flagNote}</span>
        </p>
      ) : (
        active?.blurb && (
          <p className="mt-1 text-xs text-muted-foreground">{active.blurb}</p>
        )
      )}
    </Labeled>
  );
}

/** Single-choice pill group with an optional string value (nullable). */
export function ChoiceGroup({
  label,
  options,
  value,
  onChange,
  hint,
  required,
}: {
  label: string;
  options: readonly { value: string; label: string; blurb?: string }[];
  value: string | null;
  onChange: (v: string) => void;
  hint?: string;
  required?: boolean;
}) {
  const labelId = React.useId();
  const active = options.find((o) => o.value === value);
  return (
    <Labeled label={label} labelId={labelId} hint={hint} required={required}>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-2"
      >
        {options.map((opt) => {
          const on = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={on}
              className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                on
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-input text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {active?.blurb && (
        <p className="mt-1 text-xs text-muted-foreground">{active.blurb}</p>
      )}
    </Labeled>
  );
}
