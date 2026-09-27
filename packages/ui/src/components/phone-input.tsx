"use client";

import * as React from "react";
import PhoneInputBase, {
  getCountryCallingCode,
  parsePhoneNumber,
  type Country,
} from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import { Input } from "./input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./select";
import { cn } from "../lib/utils";

// International phone input (build-spec §6b: prefer prebuilt — do NOT hand-roll).
// A themed wrapper around the shadcn-ecosystem `react-phone-number-input`
// (built on libphonenumber-js): our Input for the number, our Select for the
// country picker, dark-first tokens throughout. Default country ZA; the value
// emitted to `onChange` is always an E.164 string ("" when empty).

const DEFAULT_COUNTRY: Country = "ZA";

function FlagIcon({ country }: { country: Country }) {
  const Flag = flags[country];
  if (!Flag) return null;
  return (
    <span className="flex h-3.5 w-5 shrink-0 items-center overflow-hidden rounded-[2px] border border-border/60 [&>svg]:h-full [&>svg]:w-full">
      <Flag title={country} />
    </span>
  );
}

interface CountrySelectProps {
  value?: Country;
  onChange: (value?: Country) => void;
  options: { value?: Country; label: string }[];
  disabled?: boolean;
  readOnly?: boolean;
}

// react-phone-number-input renders this in place of its native country <select>.
function CountrySelect({
  value,
  onChange,
  options,
  disabled,
  readOnly,
}: CountrySelectProps) {
  const countries = options.filter(
    (o): o is { value: Country; label: string } => Boolean(o.value),
  );
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as Country)}
      disabled={disabled || readOnly}
    >
      <SelectTrigger
        aria-label="Country"
        className="h-10 w-auto shrink-0 gap-1 rounded-r-none border-r-0 px-2.5 focus:z-10"
      >
        {value ? <FlagIcon country={value} /> : null}
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {countries.map((o) => (
          // `textValue` IS WHAT TYPE-AHEAD MATCHES (issue #30). Without it Radix
          // reads the item's text content, which starts with the flag SVG's
          // <title> — the ISO code — so typing "S" skipped South Africa ("ZA…")
          // and "G" landed on the United Kingdom ("GB…"). The name alone makes
          // "sou" find South Africa, the way people actually type.
          <SelectItem key={o.value} value={o.value} textValue={o.label}>
            <span className="flex items-center gap-2">
              <FlagIcon country={o.value} />
              <span className="truncate">{o.label}</span>
              <span className="text-muted-foreground">
                +{getCountryCallingCode(o.value)}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const PhoneNumberInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <Input ref={ref} className={cn("rounded-l-none", className)} {...props} />
));
PhoneNumberInput.displayName = "PhoneNumberInput";

export interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  defaultCountry?: Country;
  /** Accessible name. Needed when the control does NOT own its Field's label —
   *  e.g. the phone half of an emergency contact, whose `<label for>` points at
   *  the name input beside it, leaving this one unnamed. */
  ariaLabel?: string;
  describedBy?: string;
  className?: string;
}

/**
 * The E.164 form of a pasted phone number, or `null` to let the paste through
 * untouched (issue #31).
 *
 * Only a COMPLETE, possible number is taken over. A fragment pasted into the
 * middle of a number is the browser's to insert, not ours to rewrite. A number
 * written with its country code (`+44 …`, or `0044 …`) keeps that code, which
 * replaces the country picked in the selector; one without is read as a number
 * of the selected country, so "082 123 4567" under South Africa is
 * +27821234567 and not the "+0821234567" a raw paste produced.
 */
export function phoneFromPaste(
  text: string,
  country: Country | undefined,
): string | null {
  const compact = text.trim().replace(/^00(?=[1-9])/, "+");
  if (!/\d/.test(compact)) return null;
  try {
    const parsed = parsePhoneNumber(compact, country);
    return parsed?.isPossible() ? parsed.number : null;
  } catch {
    return null;
  }
}

export function PhoneInput({
  value,
  onChange,
  id,
  placeholder,
  disabled,
  defaultCountry = DEFAULT_COUNTRY,
  ariaLabel,
  describedBy,
  className,
}: PhoneInputProps) {
  // The library owns the selected country; mirrored here only so a paste
  // without a country code is read against what the burner has selected.
  const [country, setCountry] = React.useState<Country | undefined>(
    defaultCountry,
  );

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = phoneFromPaste(event.clipboardData.getData("text"), country);
    if (pasted === null) return;
    event.preventDefault();
    onChange(pasted);
  }

  return (
    <PhoneInputBase
      international
      addInternationalOption={false}
      defaultCountry={defaultCountry}
      countrySelectComponent={CountrySelect}
      inputComponent={PhoneNumberInput}
      value={value || undefined}
      onChange={(v) => onChange(v ?? "")}
      onCountryChange={setCountry}
      onPaste={handlePaste}
      id={id}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      className={cn("flex items-center", className)}
    />
  );
}
