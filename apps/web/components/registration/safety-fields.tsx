import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CircleCheck,
  CircleDashed,
  Droplets,
  ExternalLink,
  FireExtinguisher,
  Fuel,
  PencilRuler,
} from "lucide-react";
import {
  describeWaterEstimate,
  EXTINGUISHER_RULE_TEXT,
  EXTINGUISHER_SERVICE_NOTE,
  formatLitres,
  SAFETY_POLICY_LINKS,
  type ExtinguisherEstimate,
  type ExtinguisherRow,
  type SafetyPolicyKey,
  type WaterEstimate,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Badge } from "@quagga/ui/components/badge";
import { Checkbox } from "@quagga/ui/components/checkbox";
import { Labeled } from "./field-kit";

// The derived read-outs and links section 4 shows around the safety gates
// (docs/registration-safety-spec.md; frames GFtHX / sSl0w). Nothing here is a
// question: the water guide and the extinguisher count are worked out, the
// policies are plain links (never a read-check), and the gas & fuel record is
// an optional camp record linked from here.

/** The "Optional" chip of the gas & fuel record (frames GFtHX / T7rUD). */
export function OptionalBadge() {
  return (
    <Badge variant="outline">
      <CircleDashed className="h-3 w-3" aria-hidden />
      Optional
    </Badge>
  );
}

/** A policy as a plain link, opened in a new tab. Never tracked. */
export function PolicyLink({ policy }: { policy: SafetyPolicyKey }) {
  const p = SAFETY_POLICY_LINKS[policy];
  return (
    <a
      href={p.href}
      target="_blank"
      rel="noopener noreferrer"
      // A 44 px target at 360 (frames sSl0w / qjdpW); inline on desktop.
      className="inline-flex min-h-11 w-fit items-center gap-1 text-sm text-accent hover:underline sm:min-h-0"
    >
      {p.label}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * G2a, "Which kinds of fire?" — ticked boxes, two columns on desktop and one
 * at 360, each row a 44 px target there (frames GFtHX / sSl0w). The labelled
 * group is what the e2e and assistive tech find.
 */
export function FireKindsField({
  options,
  value,
  onChange,
}: {
  options: readonly { value: string; label: string }[];
  value: readonly string[];
  onChange: (v: string[]) => void;
}) {
  const labelId = React.useId();
  return (
    <Labeled
      label="Which kinds of fire?"
      labelId={labelId}
      hint="Tick every kind you'll have."
      required
    >
      <div
        role="group"
        aria-labelledby={labelId}
        // Column-first on desktop, as the frame lists them.
        className="grid grid-cols-1 gap-x-6 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-4"
      >
        {options.map((opt) => {
          const on = value.includes(opt.value);
          return (
            <label
              key={opt.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 text-sm sm:min-h-8"
            >
              <Checkbox
                checked={on}
                onChange={() =>
                  onChange(
                    on
                      ? value.filter((v) => v !== opt.value)
                      : [...value, opt.value],
                  )
                }
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    </Labeled>
  );
}

/** The rough water guide under the population (REG-017). */
export function WaterEstimateBox({
  estimate,
  arrivalLabel,
  endLabel,
}: {
  estimate: WaterEstimate | null;
  arrivalLabel: string | null;
  endLabel: string;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
      data-testid="s4-water-estimate"
    >
      <Droplets className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        {estimate ? (
          <>
            <p className="text-sm font-medium">
              About {formatLitres(estimate.litres)} of water for the burn
            </p>
            <p className="text-xs text-muted-foreground">
              {describeWaterEstimate(estimate)}
              {arrivalLabel
                ? `, from your first arrival (${arrivalLabel}) to the end of the burn (${endLabel})`
                : ""}
              . A rough guide we work out for you: nothing to fill in, and not
              a water order. Ordering water is a separate step.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">Water: a rough guide</p>
            <p className="text-xs text-muted-foreground">
              Add your population and first arrival to see a rough estimate.
              It&apos;s worked out for you, not a water order.
            </p>
          </>
        )}
        <PolicyLink policy="waterwise" />
      </div>
    </div>
  );
}

/** "Bedouin tent · 12 × 8 m · 96 m²". */
export function extinguisherRowLabel(r: ExtinguisherRow): string {
  if (r.kind === "generator") return `${r.name} · 1.5 kg extinguisher close by`;
  const dims =
    r.shape === "circle"
      ? `Ø ${trim(r.width)} m`
      : `${trim(r.width)} × ${trim(r.length)} m`;
  return `${r.name} · ${dims} · ${Math.round(r.areaM2)} m²`;
}

function trim(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** The guidance heading. A layout with a generator and no structures reads
 * "Have a small extinguisher by the generator", never "Have 0 fire
 * extinguishers and …". */
export function extinguisherHeading(
  estimate: ExtinguisherEstimate | null,
): string {
  if (!estimate) return "Fire extinguishers: worked out from your layout";
  const { units, generatorUnits } = estimate;
  if (units === 0 && generatorUnits === 0) {
    return "No tent or shade structures or generators on your layout yet";
  }
  const small =
    generatorUnits === 0
      ? ""
      : generatorUnits === 1
        ? "a small extinguisher by the generator"
        : `${generatorUnits} small extinguishers, one by each generator`;
  if (units === 0) return `Have ${small}`;
  const big = `${units} fire extinguisher${units === 1 ? "" : "s"}`;
  return small ? `Have ${big} and ${small}` : `Have ${big}`;
}

/** The extinguisher guidance under the layout summary in section 4. With no
 * layout, the rule as text, no number, and a way to the layout. */
export function ExtinguisherGuidance({
  slug,
  estimate,
}: {
  slug: string;
  estimate: ExtinguisherEstimate | null;
}) {
  const heading = extinguisherHeading(estimate);
  return (
    <section
      aria-labelledby="s4-extinguishers-heading"
      className="flex flex-col gap-3 rounded-lg bg-muted/50 p-4"
      data-testid="s4-extinguishers"
    >
      <div className="flex items-start gap-3">
        <FireExtinguisher
          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
          aria-hidden
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id="s4-extinguishers-heading" className="text-sm font-medium">
            {heading}
          </h3>
          <p className="text-xs text-muted-foreground">
            AfrikaBurn asks for {EXTINGUISHER_RULE_TEXT}.{" "}
            {estimate
              ? "From your layout:"
              : "Draw your layout and we'll work out how many you need."}
          </p>
        </div>
      </div>
      {estimate && estimate.rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {estimate.rows.map((r) => (
            <li
              key={r.objectId}
              className="flex items-center justify-between gap-3 py-1.5"
            >
              <span className="min-w-0">{extinguisherRowLabel(r)}</span>
              <span className="shrink-0 font-semibold tabular-nums">
                {r.kind === "generator" ? `${r.generatorUnits} × 1.5 kg` : r.units}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!estimate && (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-11 w-fit sm:h-9"
        >
          <Link href={`/camps/${slug}/layout`}>
            <PencilRuler aria-hidden />
            Open layout
          </Link>
        </Button>
      )}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {/* "…on site — nothing to upload here." (frame GFtHX). */}
        {EXTINGUISHER_SERVICE_NOTE.replace(/\.$/, "")} — nothing to upload
        here.
      </p>
    </section>
  );
}

/** What section 4 knows about the gas & fuel record: never a draft. */
export interface WizardGasFuel {
  /** One-line summary of the SAVED record, or null when none is saved. */
  savedSummary: string | null;
  /** The saved record goes to the fuel depot. */
  advice: boolean;
  wranglerName: string | null;
}

/** The optional record's card under G3 = Yes, and the depot line. */
export function GasFuelRecordCard({
  slug,
  gasFuel,
}: {
  slug: string;
  gasFuel: WizardGasFuel;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start"
        data-testid="s4-gas-fuel-card"
      >
        {/* The icon tile is desktop-only (frame sSl0w drops it at 360). */}
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary sm:flex">
          <Fuel className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            Gas &amp; fuel record
            <OptionalBadge />
          </p>
          <p className="text-xs text-muted-foreground">
            Bottle sizes, jerry cans, barrels and trailers. Not part of this
            form: fill it in whenever you know, before the burn.
          </p>
          <p className="text-sm font-medium">
            {gasFuel.savedSummary ? `Saved · ${gasFuel.savedSummary}` : "Not started"}
          </p>
        </div>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-11 w-fit shrink-0 sm:h-9"
        >
          <Link href={`/camps/${slug}/gas-fuel`}>
            <ArrowRight aria-hidden />
            Open record
          </Link>
        </Button>
      </div>
      {gasFuel.advice && (
        <p
          className="flex items-start gap-2 text-xs text-muted-foreground"
          data-testid="s4-depot-line"
        >
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
            aria-hidden
          />
          {gasFuel.wranglerName
            ? `Over the fuel depot limit. We've told your camp's leads and your wrangler, ${gasFuel.wranglerName}, so you can talk about how the fuel depot works.`
            : "Over the fuel depot limit. We've let your camp's leads know. Your wrangler will be told when one is assigned, so you can talk about how the fuel depot works."}
        </p>
      )}
    </div>
  );
}

/** The foot of section 4: the safety checklist, a link only. */
export function SafetyChecklistFooter() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
        Worth reading before you build — links only.
      </p>
      <PolicyLink policy="safetyChecklist" />
    </div>
  );
}
