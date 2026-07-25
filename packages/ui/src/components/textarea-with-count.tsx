"use client";

import * as React from "react";
import { Textarea, type TextareaProps } from "./textarea";
import { cn } from "../lib/utils";
import { wordCountStatus } from "../lib/form-logic";

// TextareaWithCount — the word-counted textarea (canvas `w9csgR`), used for the
// 60-word camp description, ~150-word Bio "about", etc. Renders the base
// Textarea plus a derived "n / max words" counter that warns past the cap (or
// below a min). Counting matches @quagga/core's server-side word rule.
//
// Uncontrolled by default; pass `value`/`onChange` to control it.

export interface TextareaWithCountProps extends TextareaProps {
  /** Word ceiling; the counter warns past it. */
  maxWords?: number;
  /** Word floor; the counter warns below it. */
  minWords?: number;
}

const TextareaWithCount = React.forwardRef<
  HTMLTextAreaElement,
  TextareaWithCountProps
>(
  (
    { className, maxWords, minWords, value, defaultValue, onChange, ...props },
    ref,
  ) => {
    const [current, setCurrent] = React.useState(
      typeof value === "string"
        ? value
        : typeof defaultValue === "string"
          ? defaultValue
          : "",
    );
    const text = typeof value === "string" ? value : current;
    const { count, over, under } = wordCountStatus(text, {
      min: minWords,
      max: maxWords,
    });

    const counter =
      maxWords != null
        ? `${count} / ${maxWords} words`
        : `${count} ${count === 1 ? "word" : "words"}`;

    return (
      <div className="space-y-1">
        <Textarea
          ref={ref}
          value={value}
          defaultValue={defaultValue}
          onChange={(e) => {
            setCurrent(e.target.value);
            onChange?.(e);
          }}
          className={cn(over && "border-destructive", className)}
          aria-invalid={over || undefined}
          {...props}
        />
        <p
          className={cn(
            "text-right text-xs tabular-nums",
            over || under ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {counter}
        </p>
      </div>
    );
  },
);
TextareaWithCount.displayName = "TextareaWithCount";

export { TextareaWithCount };
