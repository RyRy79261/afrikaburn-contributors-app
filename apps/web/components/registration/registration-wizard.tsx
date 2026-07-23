"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CircleAlert,
  Cloud,
  CloudOff,
  Loader2,
  Send,
} from "lucide-react";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  type SectionKey,
} from "@quagga/types";
import {
  completedSectionsFor,
  getPlacementZones,
  isSectionComplete,
  SOUND_SCALE,
  type RegistrationSectionData,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Badge } from "@quagga/ui/components/badge";
import { toast } from "@quagga/ui/components/toast";
import type {
  CampSectionReview,
  RegistrationValues,
  SaveDraftResult,
  SupplierOption,
  TransitionResult,
} from "@/lib/registration-store";
import {
  CheckGroup,
  ChoiceGroup,
  NumberField,
  TextAreaField,
  TextField,
  WordLimitedTextArea,
  YesNoField,
} from "./field-kit";
import { LayoutUploads } from "./layout-uploads";
import { SupplierPicker } from "./supplier-picker";

const OPERATING_HOURS = [
  { value: "morning", label: "Morning" },
  { value: "day", label: "Day" },
  { value: "night", label: "Night" },
  { value: "late_night", label: "Late night" },
] as const;

const FAMILY_CHOICES = [
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
  { value: "Maybe", label: "Maybe" },
] as const;

type SaveState = "idle" | "saving" | "saved" | "error";

interface WizardProps {
  slug: string;
  campName: string;
  status: "draft" | "changes_requested";
  editionYear: number;
  initialValues: RegistrationValues;
  suppliers: SupplierOption[];
  reviews: CampSectionReview[];
  blobConfigured: boolean;
  saveAction: (slug: string, values: RegistrationValues) => Promise<SaveDraftResult>;
  submitAction: (slug: string) => Promise<TransitionResult>;
  withdrawAction: (slug: string) => Promise<TransitionResult>;
}

/** Map the flat form values + camp name to the core completeness input. */
function toSectionData(
  campName: string,
  v: RegistrationValues,
): RegistrationSectionData {
  return {
    campName,
    campDescription: v.campDescription,
    s1ContactEmail: v.s1ContactEmail,
    s2LntPlan: v.s2LntPlan,
    s2LntLeadName: v.s2LntLeadName,
    s2LntLeadPhone: v.s2LntLeadPhone,
    s2LntLeadEmail: v.s2LntLeadEmail,
    s3ParticipationPlan: v.s3ParticipationPlan,
    s3OperatingHours: v.s3OperatingHours,
    s3GiftingFood: v.s3GiftingFood,
    s4ExpectedPopulation: v.s4ExpectedPopulation,
    s4FirstArrivalDate: v.s4FirstArrivalDate,
    s4AreaDimensions: v.s4AreaDimensions,
    s5AmplifiedMusic: v.s5AmplifiedMusic,
    s5SoundPlan: v.s5SoundPlan,
    s5PlacementFirstChoice: v.s5PlacementFirstChoice,
    s5FamilyFriendly: v.s5FamilyFriendly,
    s6PaidPerformers: v.s6PaidPerformers,
    s6FeeStructure: v.s6FeeStructure,
    s6PlugAndPlayAck: v.s6PlugAndPlayAck,
  };
}

function parseFamily(value: string | null): { choice: string | null; detail: string } {
  if (!value) return { choice: null, detail: "" };
  const [choice, ...rest] = value.split(" — ");
  return { choice: choice ?? null, detail: rest.join(" — ") };
}

export function RegistrationWizard(props: WizardProps) {
  const router = useRouter();
  const [values, setValues] = React.useState<RegistrationValues>(
    props.initialValues,
  );
  const [active, setActive] = React.useState<SectionKey>("identity");
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const valuesRef = React.useRef(values);
  valuesRef.current = values;
  const savingRef = React.useRef(false);
  const pendingRef = React.useRef(false);
  const dirtyRef = React.useRef(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const zones = React.useMemo(
    () => getPlacementZones(props.editionYear),
    [props.editionYear],
  );

  const completed = React.useMemo(
    () => new Set(completedSectionsFor(toSectionData(props.campName, values))),
    [props.campName, values],
  );
  const allComplete = completed.size === SECTION_KEYS.length;
  const missing = SECTION_KEYS.filter((k) => !completed.has(k));

  const saveNow = React.useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!dirtyRef.current) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    dirtyRef.current = false;
    setSaveState("saving");
    const result = await props.saveAction(props.slug, valuesRef.current);
    savingRef.current = false;
    if (result.ok) {
      setSaveState("saved");
      setLastSavedAt(new Date());
    } else {
      setSaveState("error");
      dirtyRef.current = true; // keep it dirty so a later flush retries
      toast.error("Couldn't save", { description: result.error });
    }
    if (pendingRef.current) {
      pendingRef.current = false;
      void saveNow();
    }
  }, [props]);

  // Update a field, mark dirty, and debounce an autosave.
  const update = React.useCallback(
    (patch: Partial<RegistrationValues>) => {
      setValues((prev) => ({ ...prev, ...patch }));
      dirtyRef.current = true;
      setSaveState("idle");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void saveNow(), 1500);
    },
    [saveNow],
  );

  // Immediate flush on blur.
  const commit = React.useCallback(() => void saveNow(), [saveNow]);

  // Periodic safety-net autosave + flush on unmount.
  React.useEffect(() => {
    const id = setInterval(() => {
      if (dirtyRef.current) void saveNow();
    }, 20000);
    return () => {
      clearInterval(id);
      if (dirtyRef.current) void saveNow();
    };
  }, [saveNow]);

  async function handleSubmit() {
    setSubmitting(true);
    // Persist any pending edits before the gate check.
    dirtyRef.current = true;
    await saveNow();
    const result = await props.submitAction(props.slug);
    setSubmitting(false);
    if (result.ok) {
      toast.success(
        props.status === "changes_requested"
          ? "Resubmitted for review."
          : "Registration submitted.",
      );
      router.refresh();
    } else {
      toast.error("Couldn't submit", { description: result.error });
    }
  }

  async function handleWithdraw() {
    if (
      !window.confirm(
        "Withdraw this registration? Your camp stays, but it won't be considered for this edition until you register again.",
      )
    ) {
      return;
    }
    const result = await props.withdrawAction(props.slug);
    if (result.ok) {
      toast.success("Registration withdrawn.");
      router.refresh();
    } else {
      toast.error("Couldn't withdraw", { description: result.error });
    }
  }

  const activeReviews = props.reviews.filter((r) => r.sectionKey === active);
  const family = parseFamily(values.s5FamilyFriendly);

  return (
    <div className="flex flex-col gap-6">
      {props.status === "changes_requested" && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="text-sm font-medium text-foreground">
              AfrikaBurn asked for changes
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Read their notes on the flagged sections below, update what&apos;s
              needed, then resubmit.
            </p>
          </div>
        </div>
      )}

      <SaveStatus state={saveState} lastSavedAt={lastSavedAt} />

      {/* Section navigation — any order */}
      <nav aria-label="Registration sections">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SECTION_KEYS.map((key, i) => {
            const done = completed.has(key);
            const isActive = key === active;
            const flagged = props.reviews.some(
              (r) => r.sectionKey === key && r.status === "open",
            );
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setActive(key)}
                  aria-current={isActive ? "step" : undefined}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? "border-accent bg-accent/10"
                      : "border-border hover:bg-secondary/50"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                      done
                        ? "bg-success/20 text-success"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {SECTION_LABELS[key]}
                  </span>
                  {flagged && (
                    <CircleAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Active section feedback (camp side) */}
      {activeReviews.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/30 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            AfrikaBurn feedback on this section
          </p>
          <ul className="flex flex-col gap-2">
            {activeReviews.map((r) => (
              <li key={r.id} className="text-sm">
                <div className="mb-0.5 flex items-center gap-2">
                  <Badge variant={r.status === "open" ? "warning" : "success"}>
                    {r.status === "open" ? "Open" : "Resolved"}
                  </Badge>
                </div>
                <p className="whitespace-pre-wrap text-foreground">{r.comment}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Active section fields */}
      <section className="flex flex-col gap-5 rounded-xl border border-border p-5">
        <div>
          <h2 className="text-lg font-semibold">{SECTION_LABELS[active]}</h2>
          <p className="text-xs text-muted-foreground">
            {isSectionComplete(active, toSectionData(props.campName, values))
              ? "All required fields complete."
              : "Required fields are marked with *."}
          </p>
        </div>

        {active === "identity" && (
          <>
            <div className="rounded-lg border border-dashed border-border p-3 text-sm">
              <span className="text-muted-foreground">Camp name: </span>
              <span className="font-medium text-foreground">{props.campName}</span>
              <p className="mt-1 text-xs text-muted-foreground">
                Your camp name is set on the camp page and can&apos;t change here.
              </p>
            </div>
            <WordLimitedTextArea
              id="s1-description"
              label="Camp description"
              required
              hint="What is your camp, in a nutshell? Public in the directory once approved."
              value={values.campDescription}
              onChange={(v) => update({ campDescription: v })}
              onCommit={commit}
            />
            <TextField
              id="s1-contact-email"
              label="Contact email"
              required
              type="email"
              hint="The camp lead's email — AfrikaBurn's main point of contact."
              value={values.s1ContactEmail}
              onChange={(v) => update({ s1ContactEmail: v })}
              onCommit={commit}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="s1-alt-name"
                label="Alternative contact (name)"
                value={values.s1AltContactName}
                onChange={(v) => update({ s1AltContactName: v })}
                onCommit={commit}
              />
              <TextField
                id="s1-alt-phone"
                label="Alternative contact (phone)"
                value={values.s1AltContactPhone}
                onChange={(v) => update({ s1AltContactPhone: v })}
                onCommit={commit}
              />
            </div>
            <TextField
              id="s1-alt-email"
              label="Alternative contact (email)"
              type="email"
              value={values.s1AltContactEmail}
              onChange={(v) => update({ s1AltContactEmail: v })}
              onCommit={commit}
            />
          </>
        )}

        {active === "lnt" && (
          <>
            <TextAreaField
              id="s2-plan"
              label="Leave No Trace plan"
              required
              rows={5}
              hint="Your MOOP plan, grey-water handling, and waste streams."
              value={values.s2LntPlan}
              onChange={(v) => update({ s2LntPlan: v })}
              onCommit={commit}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                id="s2-lead-name"
                label="LNT lead name"
                required
                hint="A separate person from the camp lead."
                value={values.s2LntLeadName}
                onChange={(v) => update({ s2LntLeadName: v })}
                onCommit={commit}
              />
              <TextField
                id="s2-lead-phone"
                label="LNT lead phone"
                required
                value={values.s2LntLeadPhone}
                onChange={(v) => update({ s2LntLeadPhone: v })}
                onCommit={commit}
              />
              <TextField
                id="s2-lead-email"
                label="LNT lead email"
                required
                type="email"
                value={values.s2LntLeadEmail}
                onChange={(v) => update({ s2LntLeadEmail: v })}
                onCommit={commit}
              />
            </div>
          </>
        )}

        {active === "participation" && (
          <>
            <TextAreaField
              id="s3-plan"
              label="Participation plan"
              required
              rows={6}
              hint="What will your camp offer and gift? Take all the space you need."
              value={values.s3ParticipationPlan}
              onChange={(v) => update({ s3ParticipationPlan: v })}
              onCommit={commit}
            />
            <CheckGroup
              label="Operating hours"
              required
              options={OPERATING_HOURS}
              value={values.s3OperatingHours}
              onChange={(v) => {
                update({ s3OperatingHours: v });
                setTimeout(commit, 0);
              }}
            />
            <YesNoField
              label="Gifting food?"
              required
              hint="Food or drink gifts qualify for the morning quiet-hours exception."
              value={values.s3GiftingFood}
              onChange={(v) => {
                update({ s3GiftingFood: v });
                setTimeout(commit, 0);
              }}
            />
            <TextAreaField
              id="s3-schedule"
              label="Schedule detail (optional)"
              rows={3}
              value={values.s3ScheduleDetail}
              onChange={(v) => update({ s3ScheduleDetail: v })}
              onCommit={commit}
            />
          </>
        )}

        {active === "size_logistics" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                id="s4-population"
                label="Expected population"
                required
                hint="Roughly how many campers, e.g. 45."
                value={values.s4ExpectedPopulation}
                onChange={(v) => update({ s4ExpectedPopulation: v })}
                onCommit={commit}
              />
              <TextField
                id="s4-arrival"
                label="First arrival date"
                required
                type="date"
                hint="When your first member arrives on site."
                value={values.s4FirstArrivalDate}
                onChange={(v) => update({ s4FirstArrivalDate: v })}
                onCommit={commit}
              />
              <NumberField
                id="s4-waps"
                label="Work Access Passes (optional)"
                hint="Requested WAPs for early access — allocated separately."
                value={values.s4WorkAccessPasses}
                onChange={(v) => update({ s4WorkAccessPasses: v })}
                onCommit={commit}
              />
              <TextField
                id="s4-dimensions"
                label="Camp area dimensions"
                required
                placeholder="e.g. 20m x 15m"
                hint="Width x depth in metres."
                value={values.s4AreaDimensions}
                onChange={(v) => update({ s4AreaDimensions: v })}
                onCommit={commit}
              />
            </div>
            <LayoutUploads
              urls={values.s4LayoutUploadUrls}
              blobConfigured={props.blobConfigured}
              onChange={(urls) => update({ s4LayoutUploadUrls: urls })}
              onCommit={commit}
            />
          </>
        )}

        {active === "sound_placement" && (
          <>
            <ChoiceGroup
              label="Amplified music"
              required
              hint="Pick the loudest you'll get. This decides which zone you're placed in."
              options={SOUND_SCALE.map((s) => ({
                value: s.value,
                label: s.label,
                blurb: s.blurb,
              }))}
              value={values.s5AmplifiedMusic}
              onChange={(v) => {
                update({ s5AmplifiedMusic: v });
                setTimeout(commit, 0);
              }}
            />
            <TextAreaField
              id="s5-sound-plan"
              label="Sound plan"
              rows={4}
              hint="Equipment, playing times, and how you'll keep within quiet hours. Required if you're bringing amplification."
              value={values.s5SoundPlan}
              onChange={(v) => update({ s5SoundPlan: v })}
              onCommit={commit}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <ChoiceGroup
                label="Placement — 1st choice"
                required
                options={zones.map((z) => ({
                  value: z.value,
                  label: z.label,
                  blurb: z.blurb,
                }))}
                value={values.s5PlacementFirstChoice}
                onChange={(v) => {
                  update({ s5PlacementFirstChoice: v });
                  setTimeout(commit, 0);
                }}
              />
              <ChoiceGroup
                label="Placement — 2nd choice"
                options={zones.map((z) => ({
                  value: z.value,
                  label: z.label,
                  blurb: z.blurb,
                }))}
                value={values.s5PlacementSecondChoice}
                onChange={(v) => {
                  update({ s5PlacementSecondChoice: v });
                  setTimeout(commit, 0);
                }}
              />
            </div>
            <TextField
              id="s5-neighbour"
              label="Neighbour request (optional)"
              hint="Name other camps you'd like to be placed near."
              value={values.s5NeighbourRequest}
              onChange={(v) => update({ s5NeighbourRequest: v })}
              onCommit={commit}
            />
            <div className="flex flex-col gap-2">
              <ChoiceGroup
                label="Family-friendly?"
                required
                options={FAMILY_CHOICES}
                value={family.choice}
                onChange={(choice) => {
                  const composed = family.detail
                    ? `${choice} — ${family.detail}`
                    : choice;
                  update({ s5FamilyFriendly: composed });
                  setTimeout(commit, 0);
                }}
              />
              <TextField
                id="s5-family-detail"
                label="Family-friendly detail (optional)"
                value={family.detail || null}
                onChange={(detail) => {
                  const choice = family.choice ?? "Maybe";
                  const composed = detail ? `${choice} — ${detail}` : choice;
                  update({ s5FamilyFriendly: composed });
                }}
                onCommit={commit}
              />
            </div>
          </>
        )}

        {active === "suppliers_commerce" && (
          <>
            <SupplierPicker
              suppliers={props.suppliers}
              selectedIds={values.supplierIds}
              onChangeSelected={(ids) => update({ supplierIds: ids })}
              onCommitSelected={commit}
              note={values.s6SuppliersNote}
              onChangeNote={(v) => update({ s6SuppliersNote: v })}
              onCommitNote={commit}
            />
            <YesNoField
              label="Paid performers?"
              required
              value={values.s6PaidPerformers}
              onChange={(v) => {
                update({ s6PaidPerformers: v });
                setTimeout(commit, 0);
              }}
            />
            <TextAreaField
              id="s6-fee"
              label="Camp fee structure"
              required
              rows={4}
              hint="How does the camp fund itself?"
              value={values.s6FeeStructure}
              onChange={(v) => update({ s6FeeStructure: v })}
              onCommit={commit}
            />
            <NumberField
              id="s6-budget"
              label="Expected budget in ZAR (optional)"
              value={values.s6ExpectedBudgetZar}
              onChange={(v) => update({ s6ExpectedBudgetZar: v })}
              onCommit={commit}
            />
            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-[var(--accent)]"
                checked={values.s6PlugAndPlayAck === true}
                onChange={(e) => {
                  update({ s6PlugAndPlayAck: e.target.checked });
                  setTimeout(commit, 0);
                }}
              />
              <span className="text-sm">
                <span className="font-medium text-foreground">
                  Plug &amp; Play acknowledgement{" "}
                  <span className="text-accent" aria-hidden>*</span>
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  We understand AfrikaBurn is a decommodified event: our camp is
                  participant-run, not a paid turnkey (&ldquo;plug &amp; play&rdquo;)
                  operation, and we commit to gifting and communal effort over
                  commerce.
                </span>
              </span>
            </label>
          </>
        )}
      </section>

      {/* Submit / withdraw */}
      <div className="flex flex-col gap-3 border-t border-border pt-5">
        {!allComplete && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span>
              {missing.length} section{missing.length === 1 ? "" : "s"} still to
              complete before you can submit:{" "}
              <span className="text-foreground">
                {missing.map((k) => SECTION_LABELS[k]).join(", ")}
              </span>
              .
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={handleWithdraw}
            className="text-muted-foreground hover:text-destructive"
          >
            Withdraw registration
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!allComplete || submitting}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
            {props.status === "changes_requested"
              ? "Resubmit for review"
              : "Submit registration"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SaveStatus({
  state,
  lastSavedAt,
}: {
  state: SaveState;
  lastSavedAt: Date | null;
}) {
  let icon: React.ReactNode;
  let text: string;
  if (state === "saving") {
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />;
    text = "Saving…";
  } else if (state === "error") {
    icon = <CloudOff className="h-3.5 w-3.5 text-destructive" aria-hidden />;
    text = "Save failed — we'll retry";
  } else if (state === "saved" || lastSavedAt) {
    icon = <Cloud className="h-3.5 w-3.5 text-success" aria-hidden />;
    text = "All changes saved";
  } else {
    icon = <Cloud className="h-3.5 w-3.5" aria-hidden />;
    text = "Autosaves as you go";
  }
  return (
    <div
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      aria-live="polite"
    >
      {icon}
      <span>{text}</span>
    </div>
  );
}
