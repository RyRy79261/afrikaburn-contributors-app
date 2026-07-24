"use client";

import * as React from "react";
import { Check, Plus, X } from "lucide-react";
import {
  ABOUT_SOFT_WORD_CAP,
  countWords,
} from "@quagga/core";
import {
  VOLUNTEER_PORTFOLIOS,
  type CampHistoryEntry,
} from "@quagga/types";
import { Input } from "@quagga/ui/components/input";
import { Textarea } from "@quagga/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { cn } from "@quagga/ui/lib/utils";
import type { CampSearchResult } from "@/lib/groups-store";

/** The client-side working shape of the v3 "extras" (strings, never null, so the
 * controlled inputs stay simple). Serialized to `BioExtrasInput` on save. */
export interface BioExtrasState {
  about: string;
  campHistory: CampHistoryEntry[];
  volunteeringInterests: string[];
  volunteeringOther: string;
  rangerTraining: boolean;
  rangerCurious: boolean;
  greenDotTraining: boolean;
}

/** Build a fresh, empty extras state (used when a bio has no v3 data yet). */
export function emptyBioExtrasState(): BioExtrasState {
  return {
    about: "",
    campHistory: [],
    volunteeringInterests: [],
    volunteeringOther: "",
    rangerTraining: false,
    rangerCurious: false,
    greenDotTraining: false,
  };
}

const RANGERS_FB_URL = "https://www.facebook.com/afrikaburn.rangers/";
const RANGERS_MAILTO = "mailto:rangers@afrikaburn.com";

interface BurnsStepProps {
  value: BioExtrasState;
  onChange: (next: BioExtrasState) => void;
  searchCamps: (query: string) => Promise<CampSearchResult[]>;
}

/**
 * The bespoke "Your burns & volunteering" onboarding/profile step (build-spec
 * §"Burner Bio v3 additions"): a "for the burns" bio with a soft word counter, a
 * repeatable camp-history editor (platform type-ahead + free-text fallback), a
 * volunteering multi-select, and the inquiry-framed ranger section. Inquiry only
 * — nothing here implies a commitment.
 */
export function BurnsAndVolunteeringStep({
  value,
  onChange,
  searchCamps,
}: BurnsStepProps) {
  const patch = (partial: Partial<BioExtrasState>) =>
    onChange({ ...value, ...partial });

  const aboutWords = countWords(value.about);
  const overCap = aboutWords > ABOUT_SOFT_WORD_CAP;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold">Your burns &amp; volunteering</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell other burners who you are in the dust. All of this is optional and
          shows publicly unless you turn it off on the next step.
        </p>
      </div>

      {/* About ------------------------------------------------------------ */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="v3-about" className="text-sm font-medium">
          A bit about you, for the burns
        </label>
        <p className="text-xs text-muted-foreground">
          Free-form. What you love bringing to a burn, what you&apos;re looking
          for. Aim for around {ABOUT_SOFT_WORD_CAP} words.
        </p>
        <Textarea
          id="v3-about"
          rows={5}
          value={value.about}
          placeholder="Six burns running, happiest behind a sound desk or a teapot…"
          onChange={(e) => patch({ about: e.target.value })}
        />
        <p
          className={cn(
            "self-end text-xs",
            overCap ? "text-warning" : "text-muted-foreground",
          )}
        >
          {aboutWords} / {ABOUT_SOFT_WORD_CAP} words
          {overCap ? " — a little long, but that's OK" : ""}
        </p>
      </div>

      {/* Camp history ----------------------------------------------------- */}
      <CampHistoryEditor
        entries={value.campHistory}
        onChange={(campHistory) => patch({ campHistory })}
        searchCamps={searchCamps}
      />

      {/* Volunteering ----------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          What kind of volunteering are you into?
        </p>
        <p className="text-xs text-muted-foreground">
          Just an interest, no commitment. It helps AfrikaBurn reach the right
          people later.
        </p>
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={value.volunteeringInterests}
          onValueChange={(vals) => patch({ volunteeringInterests: vals })}
          className="justify-start"
        >
          {VOLUNTEER_PORTFOLIOS.map((p) => (
            <ToggleGroupItem key={p.key} value={p.key} className="rounded-full">
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="mt-1 flex flex-col gap-1.5">
          <label htmlFor="v3-vol-other" className="text-xs text-muted-foreground">
            Something else?
          </label>
          <Input
            id="v3-vol-other"
            value={value.volunteeringOther}
            placeholder="Another crew or portfolio…"
            onChange={(e) => patch({ volunteeringOther: e.target.value })}
          />
        </div>
      </div>

      {/* Rangers ---------------------------------------------------------- */}
      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <div>
          <p className="text-sm font-medium">Rangers</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Dust Rangers are trained volunteers who keep the burn safe and
            grounded. This is just to gauge interest — tick anything that fits.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <CheckRow
            label="I've completed Dust Ranger training"
            checked={value.rangerTraining}
            onChange={(rangerTraining) => patch({ rangerTraining })}
          />
          <CheckRow
            label="I'm curious about doing ranger shifts"
            checked={value.rangerCurious}
            onChange={(rangerCurious) => patch({ rangerCurious })}
          />
          <CheckRow
            label="I've done Green Dot Ranger training (emotional support)"
            checked={value.greenDotTraining}
            onChange={(greenDotTraining) => patch({ greenDotTraining })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <a
            href={RANGERS_FB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            Rangers info &amp; training
          </a>
          <a
            href={RANGERS_MAILTO}
            className="text-primary underline-offset-2 hover:underline"
          >
            rangers@afrikaburn.com
          </a>
          <span
            aria-disabled
            title="Info coming"
            className="cursor-not-allowed text-muted-foreground/60"
          >
            Green Dot handbook — info coming
          </span>
        </div>
      </div>
    </div>
  );
}

// --- Camp history editor -------------------------------------------------

const DEFAULT_EVENT = "AfrikaBurn";

interface CampHistoryEditorProps {
  entries: CampHistoryEntry[];
  onChange: (entries: CampHistoryEntry[]) => void;
  searchCamps: (query: string) => Promise<CampSearchResult[]>;
}

function CampHistoryEditor({
  entries,
  onChange,
  searchCamps,
}: CampHistoryEditorProps) {
  const [name, setName] = React.useState("");
  const [event, setEvent] = React.useState("");
  const [years, setYears] = React.useState("");
  const [results, setResults] = React.useState<CampSearchResult[]>([]);
  const [, startSearch] = React.useTransition();

  // Debounced type-ahead against the platform camp directory.
  React.useEffect(() => {
    const q = name.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      startSearch(async () => {
        try {
          setResults(await searchCamps(q));
        } catch {
          setResults([]);
        }
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [name, searchCamps]);

  function reset() {
    setName("");
    setEvent("");
    setYears("");
    setResults([]);
  }

  function addLinked(camp: CampSearchResult) {
    const entry: CampHistoryEntry = {
      kind: "linked",
      groupId: camp.id,
      label: camp.name,
      ...(event.trim() ? { event: event.trim() } : {}),
      ...(years.trim() ? { years: years.trim() } : {}),
    };
    onChange([...entries, entry]);
    reset();
  }

  function addFreetext() {
    const label = name.trim();
    if (!label) return;
    const entry: CampHistoryEntry = {
      kind: "freetext",
      label,
      ...(event.trim() ? { event: event.trim() } : {}),
      ...(years.trim() ? { years: years.trim() } : {}),
    };
    onChange([...entries, entry]);
    reset();
  }

  function removeAt(index: number) {
    onChange(entries.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">Camps you&apos;ve been part of</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Search for camps on the platform, or add any camp — including camps at
          other burns — as free text.
        </p>
      </div>

      {entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {entries.map((entry, i) => (
            <li
              key={`${entry.label}-${i}`}
              className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{entry.label}</span>
                  {entry.kind === "linked" && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                      <Check className="h-3 w-3" aria-hidden />
                      Linked
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.event ?? DEFAULT_EVENT}
                  {entry.years ? ` · ${entry.years}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${entry.label}`}
                onClick={() => removeAt(i)}
                className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
        <div className="relative">
          <Input
            value={name}
            placeholder="Camp name (start typing to search)"
            aria-label="Camp name"
            onChange={(e) => setName(e.target.value)}
          />
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
              {results.map((camp) => (
                <li key={camp.id}>
                  <button
                    type="button"
                    onClick={() => addLinked(camp)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate">{camp.name}</span>
                    {camp.registered && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                        registered
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={event}
            placeholder={DEFAULT_EVENT}
            aria-label="Event or burn"
            onChange={(e) => setEvent(e.target.value)}
            className="sm:flex-1"
          />
          <Input
            value={years}
            placeholder="Years (e.g. 2019, 2023)"
            aria-label="Years"
            onChange={(e) => setYears(e.target.value)}
            className="sm:flex-1"
          />
        </div>
        <button
          type="button"
          onClick={addFreetext}
          disabled={!name.trim()}
          className="inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add as text
        </button>
      </div>
    </div>
  );
}

// --- Small checkbox row --------------------------------------------------

interface CheckRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function CheckRow({ label, checked, onChange }: CheckRowProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 text-left text-sm"
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input bg-background",
        )}
        aria-hidden
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
      <span>{label}</span>
    </button>
  );
}
