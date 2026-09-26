import { ArrowRight, Minus, Plus, PencilLine } from "lucide-react";
import type { ComparisonBasis, FieldChange } from "@quagga/core";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { Badge } from "./badge";

// The year-on-year diff (roadmap R1 change-comparison view; epic #50).
//
// ONE COMPONENT, TWO READERS. The reviewer reads it in the org console above the
// sections; the camp reads it on its own draft before submitting (PREVYR-010).
// Both render @quagga/core `changedFields` against the prior that
// `selectComparisonPrior` picked, so a camp sees before it submits exactly the
// diff AfrikaBurn will see after. It used to live in apps/org alone; moving it
// here is what keeps the two from drifting into two different diffs.
//
// WHY A REVIEWER WANTS THIS. A fourth-year camp's registration is mostly the
// same document it was last year. Reading all six sections again to find the two
// sentences that moved is how a reviewer misses the one that matters — a halved
// sound plan, a doubled population, an emptied LNT lead.
//
// SERVER-RENDERABLE. It renders already-computed changes and owns no state.

const KIND_META: Record<
  FieldChange["kind"],
  {
    label: string;
    icon: typeof Plus;
    variant: "success" | "warning" | "secondary";
  }
> = {
  changed: { label: "Changed", icon: PencilLine, variant: "warning" },
  added: { label: "Added", icon: Plus, variant: "success" },
  cleared: { label: "Cleared", icon: Minus, variant: "secondary" },
  unchanged: { label: "Unchanged", icon: PencilLine, variant: "secondary" },
};

/** Render a stored answer for display. Arrays join; booleans read as words. */
export function displayAnswer(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value).trim();
  return text === "" ? "—" : text;
}

/** Copy that depends on who is reading and why this prior was picked. */
function describe(input: {
  audience: "reviewer" | "camp";
  basis: ComparisonBasis;
  priorYear: number;
  currentYear: number;
  moved: number;
}): string {
  const { audience, basis, priorYear, currentYear, moved } = input;
  const whose = audience === "camp" ? "your" : "this camp's";
  const source =
    basis === "carried_forward"
      ? `the ${priorYear} answers ${audience === "camp" ? "you" : "it"} brought across`
      : `${whose} ${priorYear} registration`;
  if (moved === 0) {
    return basis === "carried_forward"
      ? `Nothing has changed yet from ${source}.`
      : `Nothing differs from ${source}.`;
  }
  return `${moved} answer${moved === 1 ? "" : "s"} differ between ${source} and ${whose} ${currentYear} one. Everything else is the same.`;
}

export function RegistrationChanges({
  priorYear,
  currentYear,
  changes,
  basis,
  audience,
}: {
  priorYear: number;
  currentYear: number;
  /** Only the fields that moved — `changedFields`, not `diffRegistrations`. */
  changes: FieldChange[];
  basis: ComparisonBasis;
  audience: "reviewer" | "camp";
}) {
  const description = describe({
    audience,
    basis,
    priorYear,
    currentYear,
    moved: changes.length,
  });

  if (changes.length === 0) {
    return (
      <Card data-testid="registration-changes">
        <CardHeader>
          <CardTitle className="text-base">Changes since {priorYear}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Grouped by section so the diff reads in the same order as the form.
  const bySection = new Map<string, FieldChange[]>();
  for (const change of changes) {
    const list = bySection.get(change.sectionLabel) ?? [];
    list.push(change);
    bySection.set(change.sectionLabel, list);
  }

  return (
    <Card data-testid="registration-changes">
      <CardHeader>
        <CardTitle className="text-base">Changes since {priorYear}</CardTitle>
        <CardDescription>{description}</CardDescription>
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
                      {!change.carried && basis === "carried_forward" && (
                        // The fields that never carry forward. Saying so stops
                        // a reader taking "Changed" as a revision, when in fact
                        // it was answered fresh because we required it. Only
                        // meaningful when something WAS carried.
                        <span className="text-xs text-muted-foreground">
                          answered fresh — never carried over
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid gap-2 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-start">
                      <p className="whitespace-pre-wrap break-words text-muted-foreground line-through decoration-muted-foreground/40">
                        <span className="sr-only">{priorYear}: </span>
                        {displayAnswer(change.prior)}
                      </p>
                      <ArrowRight
                        className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:block"
                        aria-hidden
                      />
                      <p className="whitespace-pre-wrap break-words">
                        <span className="sr-only">{currentYear}: </span>
                        {displayAnswer(change.current)}
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
