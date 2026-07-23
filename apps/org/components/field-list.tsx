import type { ReactNode } from "react";

export interface FieldSpec {
  label: string;
  value: ReactNode;
  /** Render across the full width (long text). */
  wide?: boolean;
}

function isEmpty(value: ReactNode): boolean {
  return value == null || value === "" || value === "—";
}

/** A definition-list of read-only submission fields. */
export function FieldList({ fields }: { fields: FieldSpec[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {fields.map((f, i) => (
        <div
          key={`${f.label}-${i}`}
          className={f.wide ? "sm:col-span-2" : undefined}
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {f.label}
          </dt>
          <dd
            className={
              isEmpty(f.value)
                ? "mt-1 text-sm italic text-muted-foreground/70"
                : "mt-1 text-sm text-foreground whitespace-pre-wrap"
            }
          >
            {isEmpty(f.value) ? "Not provided" : f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Format a boolean field as Yes / No, or a dash when unset. */
export function yesNo(value: boolean | null | undefined): string {
  if (value == null) return "—";
  return value ? "Yes" : "No";
}
