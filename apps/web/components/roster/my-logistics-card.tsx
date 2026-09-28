"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import type { MemberLogistics } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { Switch } from "@quagga/ui/components/switch";

// "Your plans" — a member's own build/strike/arrival/departure for this camp
// and edition (epic #55, CDB-011..014). NEEDS DESIGN REVIEW — built from
// existing components without a canvas frame.
//
// Self-owned: this card only ever edits the SIGNED-IN member's own row (the
// action derives whose from the session). The window and the arrival-before-
// departure rule are enforced server-side by @quagga/core; `min`/`max` here
// are a convenience, never the check.

type SaveResult =
  { ok: true; logistics: MemberLogistics } | { ok: false; error: string };

export function MyLogisticsCard({
  slug,
  initial,
  window,
  saveAction,
}: {
  slug: string;
  initial: MemberLogistics;
  window: { earliest: string; latest: string } | null;
  saveAction: (raw: unknown) => Promise<SaveResult>;
}) {
  const [value, setValue] = React.useState<MemberLogistics>(initial);
  const [saved, setSaved] = React.useState<MemberLogistics>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const dirty = JSON.stringify(value) !== JSON.stringify(saved);

  function update(patch: Partial<MemberLogistics>) {
    setValue((v) => ({ ...v, ...patch }));
    setNotice(null);
  }

  function save() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await saveAction({ slug, logistics: value });
      if (result.ok) {
        setSaved(result.logistics);
        setValue(result.logistics);
        setNotice("Saved.");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card data-testid="my-logistics">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4 text-primary" aria-hidden />
          Your plans
        </CardTitle>
        <CardDescription>
          When you&apos;re arriving and leaving, and whether you&apos;re joining
          build and strike. Only you and your camp&apos;s organisers see this.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Arrival" htmlFor="logistics-arrival">
            <Input
              id="logistics-arrival"
              type="date"
              min={window?.earliest}
              max={window?.latest}
              value={value.arrivalDate ?? ""}
              onChange={(e) => update({ arrivalDate: e.target.value || null })}
            />
          </Field>
          <Field label="Departure" htmlFor="logistics-departure">
            <Input
              id="logistics-departure"
              type="date"
              min={value.arrivalDate ?? window?.earliest}
              max={window?.latest}
              value={value.departureDate ?? ""}
              onChange={(e) =>
                update({ departureDate: e.target.value || null })
              }
            />
          </Field>
        </div>
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span id="logistics-build-label">Joining build</span>
            <Switch
              aria-labelledby="logistics-build-label"
              checked={value.joiningBuild}
              onCheckedChange={(v) => update({ joiningBuild: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span id="logistics-strike-label">Joining strike</span>
            <Switch
              aria-labelledby="logistics-strike-label"
              checked={value.joiningStrike}
              onCheckedChange={(v) => update({ joiningStrike: v })}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={pending || !dirty}
          >
            {pending ? "Saving…" : "Save plans"}
          </Button>
          {notice && (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
