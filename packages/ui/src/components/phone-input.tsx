"use client";

import * as React from "react";
import PhoneInputBase, {
  getCountryCallingCode,
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
          <SelectItem key={o.value} value={o.value}>
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
  describedBy?: string;
  className?: string;
}

export function PhoneInput({
  value,
  onChange,
  id,
  placeholder,
  disabled,
  defaultCountry = DEFAULT_COUNTRY,
  describedBy,
  className,
}: PhoneInputProps) {
  return (
    <PhoneInputBase
      international
      addInternationalOption={false}
      defaultCountry={defaultCountry}
      countrySelectComponent={CountrySelect}
      inputComponent={PhoneNumberInput}
      value={value || undefined}
      onChange={(v) => onChange(v ?? "")}
      id={id}
      placeholder={placeholder}
      disabled={disabled}
      aria-describedby={describedBy}
      className={cn("flex items-center", className)}
    />
  );
}
