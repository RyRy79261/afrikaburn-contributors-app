"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, LayoutGrid, Plus } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import {
  createCampLayoutAction,
  startLayoutFromLastYearAction,
} from "@/app/(app)/camps/[slug]/layout/actions";
import { parseMetresInput } from "@/lib/layout-editor-model";

// "No layout for AfrikaBurn 2027 yet" — what a lead or layout editor sees the
// first time they open Layout this edition (frame QZeG7, state 4). Two ways
// in: carry last year's plan forward (one click, decision 12 — never
// automatic) or start with an empty plot of a size they type.

export interface LayoutStartCardProps {
  slug: string;
  editionName: string;
  lastYear: { editionYear: number; size: string; objectCount: number } | null;
}

export function LayoutStartCard({
  slug,
  editionName,
  lastYear,
}: LayoutStartCardProps) {
  const router = useRouter();
  const ids = useId();
  const [width, setWidth] = useState("40");
  const [depth, setDepth] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () => {
    const w = parseMetresInput(width);
    const d = parseMetresInput(depth);
    if (w === null || d === null || w < 0.1 || d < 0.1 || w > 500 || d > 500) {
      setError("A plot is between 0.1 m and 500 m on each side.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await createCampLayoutAction({ slug, width: w, depth: d });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  const carry = () => {
    setError(null);
    startTransition(async () => {
      const r = await startLayoutFromLastYearAction({ slug });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
          <LayoutGrid className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-lg font-semibold">
            No layout for {editionName} yet
          </h2>
          <p className="text-sm text-muted-foreground">
            Draw your camp to scale, in metres. AfrikaBurn sees the plan you
            send with your registration.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {lastYear && (
          <div className="rounded-lg border border-primary/50 bg-primary/5 p-4">
            <h3 className="font-semibold">Carry last year forward</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Copies your AfrikaBurn {lastYear.editionYear} plan into this
              year: {lastYear.size}, {lastYear.objectCount} objects, tents
              included. Nothing is copied until you choose.
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-3"
              disabled={pending}
              onClick={carry}
            >
              <Copy aria-hidden />
              Start from last year&apos;s layout
            </Button>
          </div>
        )}
        <div className="rounded-lg border border-border p-4">
          <h3 className="font-semibold">Start with an empty plot</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor={`${ids}-w`} className="text-sm font-medium">
                Width
              </label>
              <MetreInput id={`${ids}-w`} value={width} onChange={setWidth} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${ids}-d`} className="text-sm font-medium">
                Depth
              </label>
              <MetreInput id={`${ids}-d`} value={depth} onChange={setDepth} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={create}
            >
              <Plus aria-hidden />
              Create the plot
            </Button>
            <span className="text-xs text-muted-foreground">
              You can change the size later.
            </span>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function MetreInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-8"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
      >
        m
      </span>
    </div>
  );
}
