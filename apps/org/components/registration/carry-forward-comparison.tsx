import { ArrowRight, Minus, Plus, PencilLine } from "lucide-react";
import type { FieldChange } from "@quagga/core";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";

// The reviewer's diff (roadmap R1, change-comparison view).
//
// WHY A REVIEWER WANTS THIS. A fourth-year camp's registration is mostly the
// same document it was last year. Reading all six sections again to find the two
// sentences that moved is how a reviewer misses the one that matters — a halved
// sound plan, a doubled population, an emptied LNT lead. This turns the review
// into a diff and leaves the full sections below for when the diff is not
// enough.
//
// SERVER COMPONENT. It renders already-computed changes and owns no state.

const KIND_META: Record<
  FieldChange["kind"],
  { label: string; icon: typeof Plus; variant: "success" | "warning" | "secondary" }
> = {
  changed: { label: "Changed", icon: PencilLine, variant: "warning" },
  added: { label: "Added", icon: Plus, variant: "success" },
  cleared: { label: "Cleared", icon: Minus, variant: "secondary" },
  unchanged: { label: "Unchanged", icon: PencilLine, variant: "secondary" },
};

/** Render a stored answer for display. Arrays join; booleans read as words. */
function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value).trim();
  return text === "" ? "—" : text;
}

export function CarryForwardComparison({
  priorYear,
  currentYear,
  changes,
}: {
  priorYear: number;
  currentYear: number;
  changes: FieldChange[];
}) {
  if (changes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Changes since {priorYear}
          </CardTitle>
          <CardDescription>
            This camp brought its {priorYear} answers across and has not changed
            any of them yet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Grouped by section so the diff reads in the same order as the review below.
  const bySection = new Map<string, FieldChange[]>();
  for (const change of changes) {
    const list = bySection.get(change.sectionLabel) ?? [];
    list.push(change);
    bySection.set(change.sectionLabel, list);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Changes since {priorYear}</CardTitle>
        <CardDescription>
          {changes.length} answer{changes.length === 1 ? "" : "s"} moved between
          this camp&apos;s {priorYear} registration and its {currentYear} one.
          Everything else is unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {[...bySection.entries()].map(([sectionLabel, sectionChanges]) => (
          <div key={sectionLabel} className="flex flex-col gap-3">
            <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {sectionLabel}
            </h3>
            <ul className="flex flex-col gap-3">
              {sectionChanges.map((change) => {
                const meta = KIND_META[change.kind];
                const Icon = meta.icon;
                return (
                  <li
                    key={change.field}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {change.label}
                      </span>
                      <Badge variant={meta.variant}>
                        <Icon className="mr-1 h-3 w-3" aria-hidden />
                        {meta.label}
                      </Badge>
                      {!change.carried && (
                        // The four fields that never carry forward. Saying so
                        // stops a reviewer reading "Changed" as the camp having
                        // revised something, when in fact they answered it fresh
                        // because we required them to.
                        <span className="text-xs text-muted-foreground">
                          answered fresh — never carried over
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid gap-2 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-start">
                      <p className="whitespace-pre-wrap text-muted-foreground line-through decoration-muted-foreground/40">
                        {display(change.prior)}
                      </p>
                      <ArrowRight
                        className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:block"
                        aria-hidden
                      />
                      <p className="whitespace-pre-wrap">
                        {display(change.current)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
