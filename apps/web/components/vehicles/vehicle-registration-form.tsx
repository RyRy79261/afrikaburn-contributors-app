"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ImagePlus,
  Info,
  Link as LinkIcon,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import { CAMP_DESCRIPTION_WORD_LIMIT, SOUND_SCALE } from "@quagga/core";
import { MAX_LAYOUT_UPLOADS } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { AckRow } from "@quagga/ui/components/checkbox";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { TextareaWithCount } from "@quagga/ui/components/textarea-with-count";
import { toast } from "@quagga/ui/components/toast";
import {
  RadioChoiceGroup,
  YesNoField,
} from "@/components/registration/field-kit";
import type { VehicleRegistrationActionResult } from "@/app/(app)/vehicles/new/shared";
import {
  EBIKE_NOTE,
  FLAME_EFFECTS_NOTE,
  NIGHT_DRIVING_NOTE,
  SOOP_FOOTNOTE,
  VEHICLE_ACKS,
  type VehicleAckKey,
} from "@/app/(app)/vehicles/new/copy";

// Mutant Vehicle registration form (canvas S8ZcWf desktop / Qq5u0 mobile 360).
// One responsive page — the mobile pair is the same route at a narrower width:
// single column throughout, ≥44px touch targets on the controls and buttons.
//
// The sound scale is @quagga/core's SOUND_SCALE, not a local copy: it is the
// single source of truth for the stored value, and `soundLevelFromValue` turns
// that value into the officer triggers on the org side.

/** Prefill values for the edit-resubmit flow (create leaves these blank). */
export interface VehicleFormInitialValues {
  name: string;
  baseVehicle: string;
  mutation: string;
  photoUrls: string[];
  soundLevel: string | null;
  flameEffects: boolean | null;
  nightDriving: boolean | null;
  acks: VehicleAckKey[];
}

export interface VehicleRegistrationFormProps {
  action: (raw: unknown) => Promise<VehicleRegistrationActionResult>;
  /** Whether Vercel Blob is wired up; false → paste-a-URL fallback only. */
  blobConfigured: boolean;
  /** Prefill (edit mode). Absent → a blank create form. */
  initialValues?: VehicleFormInitialValues;
  /** Edit mode locks the name (renaming a mutant would re-key its URL). */
  nameLocked?: boolean;
  /** Submit-button label ("Submit to DMV" on create, "Resubmit…" on edit). */
  submitLabel?: string;
}

/**
 * A numbered registration section, rendered as an elevated $card (canvas
 * S8ZcWf/Qq5u0 section panels: fill $card, cornerRadius 12, drop-shadow,
 * padding 24) — matching the @quagga/ui Card treatment every other form uses.
 */
function Section({
  index,
  title,
  description,
  children,
}: {
  index: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-input text-xs font-semibold tabular-nums text-muted-foreground"
          >
            {index}
          </span>
          <h2 className="text-lg font-semibold normal-case tracking-tight">
            {title}
          </h2>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/** The bordered info callout used for the DMV rules (canvas "Callout"). */
function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Up to four project photos — Blob upload when configured, URL paste always. */
function PhotoGrid({
  label,
  help,
  urls,
  onChange,
  blobConfigured,
}: {
  label: string;
  help: string;
  urls: string[];
  onChange: (next: string[]) => void;
  blobConfigured: boolean;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const full = urls.length >= MAX_LAYOUT_UPLOADS;

  function addUrl() {
    const value = draft.trim();
    if (!value) return;
    try {
      new URL(value);
    } catch {
      toast.error("That doesn't look like a valid URL.");
      return;
    }
    if (urls.includes(value)) {
      toast.info("That image is already added.");
      return;
    }
    onChange([...urls, value].slice(0, MAX_LAYOUT_UPLOADS));
    setDraft("");
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/registration/upload", {
        method: "POST",
        body,
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        toast.error("Upload failed", {
          description: data.error ?? "Try pasting an image URL instead.",
        });
        return;
      }
      onChange([...urls, data.url].slice(0, MAX_LAYOUT_UPLOADS));
    } catch {
      toast.error("Upload failed", {
        description: "Check your connection or paste an image URL instead.",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {urls.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {urls.map((url, i) => (
            <li
              key={url}
              className="group relative overflow-hidden rounded-lg border border-border bg-secondary/40"
            >
              <img
                src={url}
                alt={`${label} ${i + 1}`}
                className="aspect-square w-full object-cover"
              />
              <button
                type="button"
                onClick={() => onChange(urls.filter((u) => u !== url))}
                aria-label={`Remove image ${i + 1}`}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md bg-ab-charcoal/70 text-ab-warmwhite"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {blobConfigured && (
            <label className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground transition-colors hover:text-foreground sm:w-auto">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="h-4 w-4" aria-hidden />
              )}
              {uploading ? "Uploading…" : "Add photo"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          <div className="relative flex-1">
            <LinkIcon
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addUrl();
                }
              }}
              placeholder="or paste an image URL"
              className="min-h-11 pl-8"
              aria-label="Image URL"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={addUrl}
          >
            Add
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

export function VehicleRegistrationForm({
  action,
  blobConfigured,
  initialValues,
  nameLocked = false,
  submitLabel = "Submit to DMV",
}: VehicleRegistrationFormProps) {
  const router = useRouter();
  const [name, setName] = React.useState(initialValues?.name ?? "");
  const [baseVehicle, setBaseVehicle] = React.useState(
    initialValues?.baseVehicle ?? "",
  );
  const [mutation, setMutation] = React.useState(initialValues?.mutation ?? "");
  const [photoUrls, setPhotoUrls] = React.useState<string[]>(
    initialValues?.photoUrls ?? [],
  );
  const [soundLevel, setSoundLevel] = React.useState<string | null>(
    initialValues?.soundLevel ?? null,
  );
  const [flameEffects, setFlameEffects] = React.useState<boolean | null>(
    initialValues?.flameEffects ?? null,
  );
  const [nightDriving, setNightDriving] = React.useState<boolean | null>(
    initialValues?.nightDriving ?? null,
  );
  const [acks, setAcks] = React.useState<VehicleAckKey[]>(
    initialValues?.acks ?? [],
  );
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const awaitingConfirm = warnings.length > 0;

  function toggleAck(key: VehicleAckKey, on: boolean) {
    setAcks((prev) =>
      on ? [...new Set([...prev, key])] : prev.filter((k) => k !== key),
    );
  }

  function submit(shouldSubmit: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await action({
        name,
        baseVehicle: baseVehicle.trim() || undefined,
        mutationDescription: mutation.trim() || undefined,
        photoUrls,
        soundLevel: soundLevel ?? undefined,
        flameEffects,
        nightDriving,
        acks,
        submit: shouldSubmit,
        confirmWarnings: awaitingConfirm,
      });
      if (result.status === "created" || result.status === "updated") {
        router.push(`/camps/${result.slug}`);
      } else if (result.status === "warn") {
        setWarnings(result.warnings);
      } else {
        setError(result.message);
        setWarnings([]);
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
      className="flex flex-col gap-8"
    >
      {/* 1 — Vehicle identity */}
      <Section index={1} title="Vehicle identity">
        <Field
          label="Vehicle name"
          htmlFor="mv-name"
          required
          help="The name your mutant will cruise under."
        >
          <Input
            id="mv-name"
            className="min-h-11"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setWarnings([]);
            }}
            placeholder="e.g. The Dust Kraken"
            aria-describedby="mv-name-help"
            required
            disabled={nameLocked}
            readOnly={nameLocked}
          />
        </Field>
        {awaitingConfirm && (
          <p className="-mt-2 flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden
            />
            <span>
              Similar to the existing mutant &ldquo;{warnings[0]}&rdquo; — is
              yours different? Submit again to keep this name.
            </span>
          </p>
        )}

        <Field
          label="Base vehicle"
          htmlFor="mv-base"
          help="The donor vehicle you're mutating."
        >
          <Input
            id="mv-base"
            className="min-h-11"
            value={baseVehicle}
            onChange={(e) => setBaseVehicle(e.target.value)}
            placeholder="e.g. 1987 Land Rover Defender"
            aria-describedby="mv-base-help"
          />
        </Field>

        <Field
          label="Mutation description"
          htmlFor="mv-mutation"
          help="What makes it a mutant, not a car with stickers."
        >
          <TextareaWithCount
            id="mv-mutation"
            rows={4}
            maxWords={CAMP_DESCRIPTION_WORD_LIMIT}
            value={mutation}
            onChange={(e) => setMutation(e.target.value)}
            placeholder="A giant articulated kraken with tentacle seating for eight, salvaged-copper scales and a periscope DJ booth — nothing about it still reads as a Land Rover."
            aria-describedby="mv-mutation-help"
          />
        </Field>

        <PhotoGrid
          label="Photos"
          help="Show the mutation from a few angles — the DMV needs to see it no longer looks like a normal vehicle."
          urls={photoUrls}
          onChange={setPhotoUrls}
          blobConfigured={blobConfigured}
        />
      </Section>

      {/* 2 — Sound (SOOP level) */}
      <Section
        index={2}
        title="Sound (SOOP level)"
        description="Sound Out Of Place — this determines where your mutant is allowed to play."
      >
        <RadioChoiceGroup
          label="Sound level"
          options={SOUND_SCALE}
          value={soundLevel}
          onChange={setSoundLevel}
          footnote={SOOP_FOOTNOTE}
        />
      </Section>

      {/* 3 — Flame effects */}
      <Section index={3} title="Flame effects">
        <YesNoField
          label="Does your mutant carry flame effects?"
          value={flameEffects}
          onChange={setFlameEffects}
        />
        <Callout>{FLAME_EFFECTS_NOTE}</Callout>
      </Section>

      {/* 4 — Night driving */}
      <Section index={4} title="Night driving">
        <YesNoField
          label="Will you drive it after dark?"
          value={nightDriving}
          onChange={setNightDriving}
        />
        <Callout>{NIGHT_DRIVING_NOTE}</Callout>
      </Section>

      {/* 5 — E-bikes & electric vehicles (informational; no field to fill) */}
      <Section index={5} title="E-bikes & electric vehicles">
        <Callout>{EBIKE_NOTE}</Callout>
      </Section>

      {/* 6 — Acknowledgements */}
      <Section
        index={6}
        title="Acknowledgements"
        description="On-site licensing happens at the event — sign these before you cruise."
      >
        <div className="flex flex-col gap-2">
          {VEHICLE_ACKS.map((ack) => (
            <AckRow
              key={ack.key}
              checked={acks.includes(ack.key)}
              onChange={(e) => toggleAck(ack.key, e.target.checked)}
            >
              {ack.text}
            </AckRow>
          ))}
        </div>
      </Section>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="ghost" className="min-h-11">
          <Link href="/directory">Cancel</Link>
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={isPending || name.trim().length < 2}
            onClick={() => submit(false)}
          >
            Save draft
          </Button>
          <Button
            type="submit"
            className="min-h-11"
            disabled={isPending || name.trim().length < 2}
          >
            {isPending ? "Sending…" : submitLabel}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        A DMV wrangler picks it up from here — the conversation carries on by
        email.
      </p>
    </form>
  );
}
