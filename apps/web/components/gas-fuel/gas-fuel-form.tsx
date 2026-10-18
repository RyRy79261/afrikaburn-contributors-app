"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CircleCheck,
  Copy,
  FilePlus,
  History,
  Loader2,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import {
  FUEL_DEPOT_GAS_KG,
  fuelDepotAdvice,
  fuelDepotReasons,
  GAS_POLICY_MAX_KG,
  gasTotalKg,
} from "@quagga/core";
import {
  type GasFuelRecord,
  GAS_FUEL_MAX_COUNT,
  GAS_FUEL_NOTE_MAX,
  LPG_BOTTLE_SIZES_KG,
} from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import { Textarea } from "@quagga/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import {
  saveGasFuelRecordAction,
  startGasFuelFromLastYearAction,
} from "@/app/(app)/camps/[slug]/gas-fuel/actions";
import { PolicyLink } from "@/components/registration/safety-fields";

// The gas & fuel record (docs/registration-safety-spec.md; frames T7rUD /
// qjdpW). Optional, never required, never blocks anything. The server decides
// everything again on save — who may edit, the depot advice, the notices —
// this form only shows the camp what it is about to save.

/** A bottle row as edited: a size may not be chosen yet. */
interface DraftRow {
  key: number;
  sizeKg: number | null;
  count: number;
}

interface Props {
  slug: string;
  canEdit: boolean;
  /** This edition's row (draft or saved), or null. */
  stored: { record: GasFuelRecord; isDraft: boolean } | null;
  /** Last year's saved record, offered while there is none this edition. */
  lastYear: { editionYear: number; summary: string } | null;
  /** For a carried-forward draft, the year it came from; null when unknown. */
  draftSourceYear: number | null;
  wranglerName: string | null;
}

// DOM ids come from React.useId() and row keys from THIS form: the first rows
// are keyed by position, added rows by a per-form counter. A module-level
// counter kept counting across every server render, so the server's
// "lpg-size-7" met the client's "lpg-size-1": a hydration mismatch, and two
// forms could share an id.
function toRows(record: GasFuelRecord | null): DraftRow[] {
  const rows = (record?.lpg ?? []).map((r, i) => ({
    key: i,
    sizeKg: r.sizeKg,
    count: r.count,
  }));
  // A first-time camp sees one blank bottle row (frame state 3).
  return rows.length > 0 ? rows : [{ key: 0, sizeKg: null, count: 0 }];
}

/** A non-negative whole number from an input, clamped; "" is 0. */
function wholeNumber(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, GAS_FUEL_MAX_COUNT);
}

/** The record as it would be saved from what is on screen. */
function toRecord(
  rows: DraftRow[],
  jerry: number,
  barrels: number,
  trailers: number,
  note: string,
): GasFuelRecord {
  return {
    lpg: rows
      .filter((r) => r.sizeKg !== null && r.count > 0)
      .map((r) => ({ sizeKg: r.sizeKg as number, count: r.count })),
    jerryCans20l: jerry,
    barrels200l: barrels,
    fuelTrailers: trailers,
    note,
  };
}

export function GasFuelForm(props: Props) {
  const router = useRouter();
  const initial = props.stored?.record ?? null;
  const uid = React.useId();
  const [rows, setRows] = React.useState<DraftRow[]>(() => toRows(initial));
  // Next key for an added row: past every key toRows handed out. Read only in
  // event handlers, never during render.
  const keyCounter = React.useRef(rows.length);
  const nextKey = () => keyCounter.current++;
  const [jerry, setJerry] = React.useState(initial?.jerryCans20l ?? 0);
  const [barrels, setBarrels] = React.useState(initial?.barrels200l ?? 0);
  const [trailers, setTrailers] = React.useState(initial?.fuelTrailers ?? 0);
  const [note, setNote] = React.useState(initial?.note ?? "");
  const [pending, startTransition] = React.useTransition();
  const [offerDismissed, setOfferDismissed] = React.useState(false);

  const record = toRecord(rows, jerry, barrels, trailers, note);
  const total = gasTotalKg(record);
  const isDraft = props.stored?.isDraft === true;
  const isSaved = props.stored !== null && !isDraft;
  // The depot notice is shown for what is SAVED: a draft shows no depot advice
  // to anyone until the camp saves it.
  const savedRecord = isSaved ? props.stored!.record : null;
  const savedAdvice = savedRecord ? fuelDepotAdvice(savedRecord) : false;

  const save = () =>
    startTransition(async () => {
      const r = await saveGasFuelRecordAction({ slug: props.slug, record });
      if (!r.ok) {
        toast.error("Couldn't save", { description: r.error });
        return;
      }
      toast.success("Gas & fuel record saved.");
      router.refresh();
    });

  const carry = () =>
    startTransition(async () => {
      const r = await startGasFuelFromLastYearAction({ slug: props.slug });
      if (!r.ok) {
        toast.error("Couldn't start from last year", { description: r.error });
        return;
      }
      router.refresh();
    });

  const offer =
    props.canEdit && props.stored === null && props.lastYear && !offerDismissed
      ? props.lastYear
      : null;

  if (!props.canEdit) {
    return (
      <ReadOnlyRecord
        record={savedRecord}
        advice={savedAdvice}
        wranglerName={props.wranglerName}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {savedRecord && savedAdvice && (
        <DepotNotice record={savedRecord} wranglerName={props.wranglerName} />
      )}
      {savedRecord && !savedAdvice && <WithinLimits />}

      {offer && (
        <section
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:p-5"
          data-testid="gas-fuel-carry-offer"
        >
          <div className="flex items-start gap-3">
            <History
              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              aria-hidden
            />
            <div>
              <h2 className="text-sm font-semibold normal-case tracking-normal">
                Start from your {offer.editionYear} record?
              </h2>
              <p className="text-sm text-muted-foreground">
                {offer.summary}. It comes across as a draft: nothing counts
                until you check it and save.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="h-11 sm:h-9"
              disabled={pending}
              onClick={carry}
            >
              <Copy aria-hidden />
              Start from {offer.editionYear}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 sm:h-9"
              disabled={pending}
              onClick={() => setOfferDismissed(true)}
            >
              <FilePlus aria-hidden />
              Start empty
            </Button>
          </div>
        </section>
      )}

      {isDraft && (
        <div
          className="flex items-start gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4"
          data-testid="gas-fuel-draft"
        >
          <History
            className="mt-0.5 h-4 w-4 shrink-0 text-primary"
            aria-hidden
          />
          <div>
            <p className="text-sm font-semibold">
              {props.draftSourceYear !== null
                ? `Draft from your ${props.draftSourceYear} record`
                : "Draft from your previous record"}
            </p>
            <p className="text-sm text-muted-foreground">
              Check every number, then save. Until you do, it doesn&apos;t
              count, the organisers don&apos;t see it, and nobody is told about
              the fuel depot.
            </p>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div>
          <h2 className="text-lg font-semibold normal-case tracking-normal">
            LPG gas
          </h2>
          <p className="text-sm text-muted-foreground">
            One row for each bottle size.
          </p>
        </div>
        <ul className="flex flex-col gap-3">
          {rows.map((row, i) => (
            <li
              key={row.key}
              // One row at every width (frame qjdpW): the size fills, the
              // count and delete keep their size, and the per-row subtotal
              // is dropped below sm — the Total line already sums it.
              className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-end gap-2 sm:grid-cols-[9rem_6rem_1fr_auto] sm:gap-3"
              data-testid="gas-fuel-bottle-row"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <label
                  className="text-xs text-muted-foreground"
                  htmlFor={`${uid}-lpg-size-${row.key}`}
                >
                  Bottle size
                </label>
                <Select
                  value={row.sizeKg === null ? undefined : String(row.sizeKg)}
                  onValueChange={(v) =>
                    setRows((rs) =>
                      rs.map((r) =>
                        r.key === row.key ? { ...r, sizeKg: Number(v) } : r,
                      ),
                    )
                  }
                >
                  <SelectTrigger
                    id={`${uid}-lpg-size-${row.key}`}
                    className="h-11 w-full text-left sm:h-10"
                  >
                    <SelectValue placeholder="Choose a size" />
                  </SelectTrigger>
                  <SelectContent>
                    {LPG_BOTTLE_SIZES_KG.map((kg) => (
                      <SelectItem key={kg} value={String(kg)}>
                        {kg} kg
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-xs text-muted-foreground"
                  htmlFor={`${uid}-lpg-count-${row.key}`}
                >
                  How many
                </label>
                <Input
                  id={`${uid}-lpg-count-${row.key}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="h-11 w-full sm:h-10"
                  value={String(row.count)}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((r) =>
                        r.key === row.key
                          ? { ...r, count: wholeNumber(e.target.value) }
                          : r,
                      ),
                    )
                  }
                />
              </div>
              <span className="hidden pb-2 text-sm text-muted-foreground tabular-nums sm:inline">
                {(row.sizeKg ?? 0) * row.count} kg
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 justify-self-end sm:h-10 sm:w-10"
                aria-label={`Remove bottle row ${i + 1}`}
                onClick={() =>
                  setRows((rs) =>
                    rs.length > 1
                      ? rs.filter((r) => r.key !== row.key)
                      : [{ key: nextKey(), sizeKg: null, count: 0 }],
                  )
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 w-fit sm:h-9"
          onClick={() =>
            setRows((rs) => [...rs, { key: nextKey(), sizeKg: null, count: 0 }])
          }
        >
          <Plus aria-hidden />
          Add a bottle size
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
          <span className="font-semibold" data-testid="gas-fuel-total">
            Total: {total} kg of gas
          </span>
          <span className="text-xs text-muted-foreground">
            Over {FUEL_DEPOT_GAS_KG} kg goes to the fuel depot
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div>
          <h2 className="text-lg font-semibold normal-case tracking-normal">
            Liquid fuel
          </h2>
          <p className="text-sm text-muted-foreground">
            Petrol, diesel or paraffin.
          </p>
        </div>
        <CountRow
          id={`${uid}-jerry-cans`}
          label="20 L jerry cans"
          hint="Up to 2 stay in your camp. More go to the fuel depot."
          value={jerry}
          onChange={setJerry}
        />
        <CountRow
          id={`${uid}-barrels`}
          label="200 L barrels"
          hint="Always go to the fuel depot. Bring a drum pump."
          value={barrels}
          onChange={setBarrels}
        />
        <CountRow
          id={`${uid}-trailers`}
          label="Fuel trailers"
          hint="Always go to the fuel depot, with 2 × 4.5 kg DCP extinguishers each."
          value={trailers}
          onChange={setTrailers}
        />
        {props.stored === null && (
          // Frame T7rUD state 3, reworded: this form saves only on the button.
          <p
            className="text-xs text-muted-foreground"
            data-testid="gas-fuel-empty-hint"
          >
            Nothing is saved until you press Save record. No fuel depot notice.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 sm:p-5">
        <label htmlFor={`${uid}-note`} className="text-sm font-medium">
          Anything your wrangler should know
        </label>
        <Textarea
          id={`${uid}-note`}
          rows={3}
          maxLength={GAS_FUEL_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          className="h-11 sm:h-10"
          onClick={save}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Check className="h-4 w-4" aria-hidden />
          )}
          Save record
        </Button>
        <span className="text-xs text-muted-foreground">
          Next year this comes across as a draft for you to check.
        </span>
      </div>
      <RecordPolicyLink />
    </div>
  );
}

function CountRow({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-b-0">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        className="h-11 w-24 shrink-0 sm:h-10"
        value={String(value)}
        onChange={(e) => onChange(wholeNumber(e.target.value))}
      />
    </div>
  );
}

/** "This goes to the fuel depot" — for the SAVED record only. */
function DepotNotice({
  record,
  wranglerName,
}: {
  record: GasFuelRecord;
  wranglerName: string | null;
}) {
  const reasons = fuelDepotReasons(record);
  const why = reasons.length > 0 ? `${reasons.join(", and ")}. ` : "";
  const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-warning/60 bg-warning/10 p-4"
      role="status"
      data-testid="gas-fuel-depot-notice"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-warning"
        aria-hidden
      />
      <div>
        <p className="text-sm font-semibold">This goes to the fuel depot</p>
        <p className="text-sm text-muted-foreground">
          {sentence(why)}
          {wranglerName
            ? `We've let your camp's leads and your wrangler, ${wranglerName}, know — talk to them about how the fuel depot works.`
            : "We've let your camp's leads know. Your camp has no wrangler yet: they'll be told when one is assigned, so you can talk about how the fuel depot works."}{" "}
          The policy allows at most {GAS_POLICY_MAX_KG} kg of gas per camp.
        </p>
      </div>
    </div>
  );
}

function WithinLimits() {
  return (
    <p
      className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm"
      data-testid="gas-fuel-within-limits"
    >
      <CircleCheck
        className="mt-0.5 h-4 w-4 shrink-0 text-success"
        aria-hidden
      />
      Within the limits: up to {FUEL_DEPOT_GAS_KG} kg of gas and 2 × 20 L of
      fuel stay in your camp. Nothing goes to the fuel depot.
    </p>
  );
}

/** A plain member's view: no inputs, no Save. */
function ReadOnlyRecord({
  record,
  advice,
  wranglerName,
}: {
  record: GasFuelRecord | null;
  advice: boolean;
  wranglerName: string | null;
}) {
  const rows = record?.lpg.filter((r) => r.count > 0) ?? [];
  return (
    <div className="flex flex-col gap-5">
      {record && advice && (
        <DepotNotice record={record} wranglerName={wranglerName} />
      )}
      <section
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:p-5"
        data-testid="gas-fuel-read-only"
      >
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          Only leads, co-leads and whoever plans the layout can change this.
        </p>
        {record ? (
          <>
            <dl className="flex flex-col divide-y divide-border text-sm">
              <div className="flex justify-between gap-3 py-2">
                <dt className="font-medium">LPG gas</dt>
                <dd className="text-right font-semibold">
                  {rows.length === 0
                    ? "None"
                    : `${rows.map((r) => `${r.count} × ${r.sizeKg} kg`).join(" + ")} · ${gasTotalKg(record)} kg`}
                </dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="font-medium">20 L jerry cans</dt>
                <dd className="font-semibold">{record.jerryCans20l}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="font-medium">200 L barrels</dt>
                <dd className="font-semibold">{record.barrels200l}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="font-medium">Fuel trailers</dt>
                <dd className="font-semibold">{record.fuelTrailers}</dd>
              </div>
            </dl>
            {/* Outside the <dl>: a list may hold only dt/dd groups. */}
            {record.note && (
              <p className="text-sm text-muted-foreground">
                &ldquo;{record.note}&rdquo;
              </p>
            )}
          </>
        ) : (
          <p className="text-sm">Your camp hasn&apos;t filled this in yet.</p>
        )}
      </section>
      <RecordPolicyLink />
    </div>
  );
}

/** The policy under the record, with the book glyph of frame T7rUD. */
function RecordPolicyLink() {
  return (
    <p className="flex items-center gap-2">
      <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <PolicyLink policy="gasFuel" />
    </p>
  );
}
