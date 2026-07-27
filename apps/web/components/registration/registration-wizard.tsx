"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Cloud,
  CloudOff,
  Loader2,
  Lock,
  MessageSquareWarning,
  Send,
} from "lucide-react";
import { SECTION_KEYS, SECTION_LABELS, type SectionKey } from "@quagga/types";
import {
  completedSectionsFor,
  getPlacementZones,
  isSectionComplete,
  SOUND_SCALE,
  type RegistrationSectionData,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Badge } from "@quagga/ui/components/badge";
import { AckRow } from "@quagga/ui/components/checkbox";
import { Wizard } from "@quagga/ui/components/wizard";
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
  PlacementSelect,
  RadioChoiceGroup,
  TextAreaField,
  TextField,
  WordLimitedTextArea,
  YesNoField,
} from "./field-kit";
import { LayoutUploads } from "./layout-uploads";
import { SupplierPicker } from "./supplier-picker";
import { SectionReplyThread } from "./section-reply-thread";

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
  /** The viewer's db user id — labels their own replies "You" in the thread. */
  viewerUserId: string | null;
  blobConfigured: boolean;
  saveAction: (
    slug: string,
    values: RegistrationValues,
  ) => Promise<SaveDraftResult>;
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

function parseFamily(value: string | null): {
  choice: string | null;
  detail: string;
} {
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
  const dirtyRef = React.useRef(false);
  /** The in-flight flush, so concurrent callers join it instead of racing it. */
  const flushRef = React.useRef<Promise<boolean> | null>(null);
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

  /**
   * Flush the draft to the server. Resolves TRUE only once the server holds
   * every edit made so far.
   *
   * This used to return early when a save was already in flight, merely setting
   * a `pending` flag and firing an unawaited follow-up. `handleSubmit` awaited
   * it and took the resolution to mean "draft is saved" — so submitting while an
   * autosave was in flight validated the PREVIOUS draft. That is how the wizard
   * could show "6 of 6 sections complete" in the header and refuse with
   * "Complete all six sections" from the server in the same click.
   *
   * Now: concurrent callers JOIN the in-flight flush rather than skipping it,
   * and the flush loops until the draft is clean, so an edit made mid-write is
   * written by the next iteration instead of being dropped.
   */
  const saveNow = React.useCallback((): Promise<boolean> => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (flushRef.current) return flushRef.current;
    if (!dirtyRef.current) return Promise.resolve(true);

    const run = (async (): Promise<boolean> => {
      while (dirtyRef.current) {
        // Clear BEFORE the await: an edit that lands during the write re-dirties
        // it and is caught by the next pass. Clearing after would swallow it.
        dirtyRef.current = false;
        setSaveState("saving");
        const result = await props.saveAction(props.slug, valuesRef.current);
        if (!result.ok) {
          dirtyRef.current = true; // stay dirty so a later flush retries
          setSaveState("error");
          toast.error("Couldn't save", { description: result.error });
          return false;
        }
        setSaveState("saved");
        setLastSavedAt(new Date());
      }
      return true;
    })();

    flushRef.current = run;
    void run.finally(() => {
      if (flushRef.current === run) flushRef.current = null;
    });
    return run;
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
    // Persist every pending edit BEFORE the server re-checks completeness —
    // the server validates what it has stored, not what is on screen. If the
    // flush fails, stop: submitting now would judge a stale draft and produce
    // a refusal that contradicts the header.
    dirtyRef.current = true;
    const flushed = await saveNow();
    if (!flushed) {
      setSubmitting(false);
      toast.error("Couldn't submit", {
        description: "Your latest changes haven't saved yet. Try again.",
      });
      return;
    }
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

  // Wizard-navigator model (canvas RBIDd `YYwgl`) — the @quagga/ui Wizard is the
  // single numbered-sections component; sections are enterable in any order so
  // nothing is `blocked`.
  const wizardSections = SECTION_KEYS.map((key) => ({
    id: key,
    label: SECTION_LABELS[key],
    done: completed.has(key),
  }));
  const activeIndex = SECTION_KEYS.indexOf(active) + 1;
  const activeDone = completed.has(active);
  const activeFlagged = activeReviews.some((r) => r.status === "open");
  const activeState = activeFlagged
    ? "NEEDS CHANGES"
    : activeDone
      ? "COMPLETE"
      : "CURRENT";

  return (
    <div className="flex flex-col gap-6">
      {props.status === "changes_requested" && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-warning"
            aria-hidden
          />
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

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        {/* Section navigator — desktop rail / mobile strip (canvas `YYwgl`) */}
        <aside className="lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
          <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Your progress
              </p>
              <p className="text-sm font-medium text-foreground">
                {completed.size} of {SECTION_KEYS.length} sections complete
              </p>
              <div
                className="h-2 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-valuenow={completed.size}
                aria-valuemin={0}
                aria-valuemax={SECTION_KEYS.length}
              >
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${(completed.size / SECTION_KEYS.length) * 100}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Any order. Nothing is lost.
              </p>
            </div>

            {/* Desktop vertical rail */}
            <div className="hidden lg:block">
              <Wizard
                variant="rail"
                sections={wizardSections}
                currentId={active}
                onSelect={(id) => setActive(id as SectionKey)}
              />
            </div>
            {/* Mobile compact strip */}
            <div className="lg:hidden">
              <Wizard
                variant="strip"
                sections={wizardSections}
                currentId={active}
                onSelect={(id) => setActive(id as SectionKey)}
              />
            </div>

            <SaveStatus state={saveState} lastSavedAt={lastSavedAt} />
          </div>
        </aside>

        {/* Active section card */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Section {activeIndex} of {SECTION_KEYS.length} · {activeState}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-2xl font-semibold uppercase tracking-tight">
                {SECTION_LABELS[active]}
              </h2>
              <Badge
                variant={
                  activeFlagged ? "warning" : activeDone ? "success" : "outline"
                }
              >
                {activeFlagged
                  ? "Changes requested"
                  : activeDone
                    ? "Complete"
                    : "In progress"}
              </Badge>
            </div>
          </div>

          {/* Org feedback on this section (canvas `fwnHH`) */}
          {activeReviews.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
              <MessageSquareWarning
                className="mt-0.5 h-5 w-5 shrink-0 text-warning"
                aria-hidden
              />
              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Org feedback
                </p>
                <ul className="flex flex-col gap-4">
                  {activeReviews.map((r) => (
                    <li key={r.id} className="text-sm">
                      <Badge
                        variant={r.status === "open" ? "warning" : "success"}
                      >
                        {r.status === "open" ? "Open" : "Resolved"}
                      </Badge>
                      <p className="mt-1 whitespace-pre-wrap text-foreground">
                        {r.comment}
                      </p>
                      <SectionReplyThread
                        slug={props.slug}
                        reviewId={r.id}
                        replies={r.replies}
                        viewerUserId={props.viewerUserId}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Active section fields */}
          <section className="flex flex-col gap-5 rounded-xl border border-border p-5">
            <p className="text-xs text-muted-foreground">
              {isSectionComplete(active, toSectionData(props.campName, values))
                ? "All required fields complete."
                : "Required fields are marked with *."}
            </p>

            {active === "identity" && (
              <>
                <div className="rounded-lg border border-dashed border-border p-3 text-sm">
                  <span className="text-muted-foreground">Camp name: </span>
                  <span className="font-medium text-foreground">
                    {props.campName}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your camp name is set on the camp page and can&apos;t change
                    here.
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
                <RadioChoiceGroup
                  label="Sound level (SOOP)"
                  required
                  hint="Pick the loudest you'll get. This decides which zone you're placed in."
                  footnote="SOOP = Sound Out Of Place — how loud you are, relative to your camp neighbours."
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
                  <PlacementSelect
                    label="Placement — first choice"
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
                    flagNote={
                      activeReviews.some((r) => r.status === "open")
                        ? "The placement team asked you to reconsider this."
                        : undefined
                    }
                  />
                  <PlacementSelect
                    label="Placement — second choice"
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
                      const composed = detail
                        ? `${choice} — ${detail}`
                        : choice;
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
                <AckRow
                  checked={values.s6PlugAndPlayAck === true}
                  onChange={(e) => {
                    update({ s6PlugAndPlayAck: e.currentTarget.checked });
                    setTimeout(commit, 0);
                  }}
                >
                  <span className="font-medium text-foreground">
                    Plug &amp; Play acknowledgement{" "}
                    <span className="text-accent" aria-hidden>
                      *
                    </span>
                  </span>
                  <span className="mt-0.5 block text-muted-foreground">
                    We understand AfrikaBurn is a decommodified event: our camp
                    is participant-run, not a paid turnkey (&ldquo;plug &amp;
                    play&rdquo;) operation, and we commit to gifting and
                    communal effort over commerce.
                  </span>
                </AckRow>
              </>
            )}
          </section>
        </div>
      </div>

      {/* Submit area (canvas `kDSa7`) — the gate stays locked until all six
          sections are complete. */}
      <div className="flex flex-col gap-4 border-t border-border pt-6">
        {!allComplete && (
          <>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="h-4 w-4 shrink-0" aria-hidden />
              Submit opens once all six sections are complete
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Still needed:
              </span>
              {missing.map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs text-foreground"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-warning"
                    aria-hidden
                  />
                  {SECTION_LABELS[k]}
                </span>
              ))}
            </div>
          </>
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
            ) : allComplete ? (
              <Send className="h-4 w-4" aria-hidden />
            ) : (
              <Lock className="h-4 w-4" aria-hidden />
            )}
            {props.status === "changes_requested"
              ? "Resubmit registration"
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
    text = "Saved just now";
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
