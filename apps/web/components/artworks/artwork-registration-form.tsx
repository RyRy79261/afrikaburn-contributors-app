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
import { CAMP_DESCRIPTION_WORD_LIMIT } from "@quagga/core";
import { MAX_LAYOUT_UPLOADS } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { AckRow } from "@quagga/ui/components/checkbox";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { TextareaWithCount } from "@quagga/ui/components/textarea-with-count";
import { toast } from "@quagga/ui/components/toast";
import { CheckGroup, YesNoField } from "@/components/registration/field-kit";
import type { ArtworkRegistrationActionResult } from "@/app/artworks/new/actions";
import {
  ART_GRANT_NOTE,
  ARTWORK_POWER_OPTIONS,
  BURN_INTENT_NOTE,
  INFRASTRUCTURE_NOTE,
  PHYSICAL_NOTE,
  type ArtworkPowerKey,
} from "@/app/artworks/new/copy";

// Art Project registration form (canvas d3pOJI desktop / H2DP4 mobile 360).
// One responsive page — the mobile pair is the same route at a narrower width:
// single column throughout, ≥44px touch targets on the controls and buttons.

export interface ArtworkRegistrationFormProps {
  action: (raw: unknown) => Promise<ArtworkRegistrationActionResult>;
  /** Whether Vercel Blob is wired up; false → paste-a-URL fallback only. */
  blobConfigured: boolean;
}

/** A numbered registration section (canvas "Num + Title" head row). */
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
    <section className="flex flex-col gap-4 border-t border-border pt-6">
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

/** The bordered info callout used for the safety + grant notes. */
function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Up to four concept images — Blob upload when configured, URL paste always. */
function ImageGrid({
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
              {uploading ? "Uploading…" : "Add image"}
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

/** One metre-denominated dimension input. */
function MetreField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.1"
        className="min-h-11"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
      />
    </Field>
  );
}

export function ArtworkRegistrationForm({
  action,
  blobConfigured,
}: ArtworkRegistrationFormProps) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [artist, setArtist] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [imageUrls, setImageUrls] = React.useState<string[]>([]);
  const [widthM, setWidthM] = React.useState<number | null>(null);
  const [depthM, setDepthM] = React.useState<number | null>(null);
  const [heightM, setHeightM] = React.useState<number | null>(null);
  const [placementNotes, setPlacementNotes] = React.useState("");
  const [burnIntent, setBurnIntent] = React.useState<boolean | null>(null);
  const [powerNeeds, setPowerNeeds] = React.useState<ArtworkPowerKey[]>([]);
  const [buildPlan, setBuildPlan] = React.useState("");
  const [strikePlan, setStrikePlan] = React.useState("");
  const [grantInterest, setGrantInterest] = React.useState(false);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const awaitingConfirm = warnings.length > 0;

  function submit(shouldSubmit: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await action({
        name,
        artist: artist.trim() || undefined,
        description: description.trim() || undefined,
        imageUrls,
        widthM,
        depthM,
        heightM,
        placementNotes: placementNotes.trim() || undefined,
        burnIntent,
        powerNeeds,
        buildPlan: buildPlan.trim() || undefined,
        strikePlan: strikePlan.trim() || undefined,
        grantInterest,
        submit: shouldSubmit,
        confirmWarnings: awaitingConfirm,
      });
      if (result.status === "created") {
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
      {/* 1 — Artwork identity */}
      <Section index={1} title="Artwork identity">
        <Field
          label="Artwork name"
          htmlFor="art-name"
          required
          help="What visitors will find on the map."
        >
          <Input
            id="art-name"
            className="min-h-11"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setWarnings([]);
            }}
            placeholder="e.g. The Whispering Baobab"
            aria-describedby="art-name-help"
            required
          />
        </Field>
        {awaitingConfirm && (
          <p className="-mt-2 flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Similar to the existing project &ldquo;{warnings[0]}&rdquo; — is
              yours different? Submit again to keep this name.
            </span>
          </p>
        )}

        <Field
          label="Artist or collective"
          htmlFor="art-artist"
          help="Who's making it — a person or a group."
        >
          <Input
            id="art-artist"
            className="min-h-11"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="e.g. Karoo Kombuis Collective"
            aria-describedby="art-artist-help"
          />
        </Field>

        <Field
          label="Description"
          htmlFor="art-description"
          help="This is what the Art crew reads — and what lands in the WTF Guide."
        >
          <TextareaWithCount
            id="art-description"
            rows={4}
            maxWords={CAMP_DESCRIPTION_WORD_LIMIT}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A twelve-metre steel baobab strung with hand-blown glass pods that glow at dusk; visitors write wishes on copper leaves and hang them in the branches."
            aria-describedby="art-description-help"
          />
        </Field>

        <ImageGrid
          label="Images & concept art"
          help="Sketches, renders, references — whatever shows the Art crew what you're building."
          urls={imageUrls}
          onChange={setImageUrls}
          blobConfigured={blobConfigured}
        />
      </Section>

      {/* 2 — Physical */}
      <Section index={2} title="Physical">
        <div className="grid gap-4 sm:grid-cols-3">
          <MetreField
            id="art-width"
            label="Width (m)"
            value={widthM}
            onChange={setWidthM}
            placeholder="4"
          />
          <MetreField
            id="art-depth"
            label="Depth (m)"
            value={depthM}
            onChange={setDepthM}
            placeholder="4"
          />
          <MetreField
            id="art-height"
            label="Height (m)"
            value={heightM}
            onChange={setHeightM}
            placeholder="12"
          />
        </div>
        <Callout>{PHYSICAL_NOTE}</Callout>

        <Field
          label="Placement notes"
          htmlFor="art-placement"
          help="Where it wants to live, and what the site needs to allow. AfrikaBurn allocates — wanting a spot never implies getting one."
        >
          <TextareaWithCount
            id="art-placement"
            rows={3}
            maxWords={CAMP_DESCRIPTION_WORD_LIMIT}
            value={placementNotes}
            onChange={(e) => setPlacementNotes(e.target.value)}
            placeholder="Best on the open Binnekring with clear sightlines from 6ish; needs level ground and a 5 m approach on all sides for visitors."
            aria-describedby="art-placement-help"
          />
        </Field>
      </Section>

      {/* 3 — Burn intent */}
      <Section index={3} title="Burn intent">
        <YesNoField
          label="Will this artwork be burned?"
          value={burnIntent}
          onChange={setBurnIntent}
          hint="It doesn't have to burn. If it does, remember you're building a fire that looks like a sculpture."
        />
        <Callout>{BURN_INTENT_NOTE}</Callout>
      </Section>

      {/* 4 — Infrastructure */}
      <Section index={4} title="Infrastructure">
        <CheckGroup
          label="Power needs"
          options={ARTWORK_POWER_OPTIONS}
          value={powerNeeds}
          onChange={(v) => setPowerNeeds(v as ArtworkPowerKey[])}
        />
        <Callout>{INFRASTRUCTURE_NOTE}</Callout>

        <Field
          label="Build plan"
          htmlFor="art-build"
          help="How it gets made on site — crew, days, machinery."
        >
          <TextareaWithCount
            id="art-build"
            rows={3}
            maxWords={CAMP_DESCRIPTION_WORD_LIMIT}
            value={buildPlan}
            onChange={(e) => setBuildPlan(e.target.value)}
            placeholder="Steel frame trucked in pre-welded; on-site assembly over three days with a crew of six, forklift needed for the canopy lift."
            aria-describedby="art-build-help"
          />
        </Field>

        <Field
          label="Strike & Leave No Trace plan"
          htmlFor="art-strike"
          help="Pack it in, pack it out. Anything your project leaves behind is MOOP."
        >
          <TextareaWithCount
            id="art-strike"
            rows={3}
            maxWords={CAMP_DESCRIPTION_WORD_LIMIT}
            value={strikePlan}
            onChange={(e) => setStrikePlan(e.target.value)}
            placeholder="Full disassembly by the Tuesday after; all glass and copper removed, site raked and MOOP-swept, hardware trucked out — nothing left behind."
            aria-describedby="art-strike-help"
          />
        </Field>
      </Section>

      {/* 5 — Art grants */}
      <Section index={5} title="Art grants">
        <AckRow
          checked={grantInterest}
          onChange={(e) => setGrantInterest(e.target.checked)}
        >
          I&rsquo;m interested in being considered for an art grant.
        </AckRow>
        <Callout>{ART_GRANT_NOTE}</Callout>
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
            {isPending ? "Sending…" : "Submit project"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Registering is an invitation, not a requirement — and it never entitles
        you to a ticket, a spot, or power. It does unlock burn, sound, placement
        and grant conversations.
      </p>
    </form>
  );
}
