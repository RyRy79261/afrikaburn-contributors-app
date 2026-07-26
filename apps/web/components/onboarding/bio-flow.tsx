"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Lock } from "lucide-react";
import {
  BIO_PRIVACY_FIELDS,
  INVITE_RESUME_PATH,
  MEDICAL_AUDIENCE_NOTE,
  USERNAME_HELP,
  USERNAME_MAX_LENGTH,
  USERNAME_QUESTION_ID,
  validateUsername,
  type BioPrivacyField,
} from "@quagga/core";
import {
  attendedYearOptions,
  type QuestionnaireResponses,
  type QuestionnaireResponseValue,
  type SaveResult,
} from "@quagga/types";
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
import { PhoneInput } from "@quagga/ui/components/phone-input";
import { Switch } from "@quagga/ui/components/switch";
import { Textarea } from "@quagga/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import { PrivacyToggles } from "../privacy-toggles";
import {
  BurnsAndVolunteeringStep,
  type BioExtrasState,
} from "../questionnaire/burns-step";
import type { CampSearchResult } from "@/lib/groups-store";
import { navigateOnwards } from "@/lib/client-navigation";

// The 5-step Burner Bio flow (design canvas `h3ak0` / `Z2300W`): Welcome ·
// Your details · Burns & volunteering · Privacy · Done. Per-field privacy is set
// inline on the details step via the @quagga/ui privacy Switch (hard-locked
// fields render "ALWAYS PRIVATE" and never toggle); the Privacy step is the
// consolidated review. The same flow powers the profile editor (mode="edit",
// which drops the Welcome + Done bookends). Persistence goes through the same
// action the questionnaire runner used, so the store/privacy laws are unchanged.

export type BioFlowAction = (
  responses: QuestionnaireResponses,
  privacyFlags: Record<string, boolean> | null,
  final: boolean,
  extras?: BioExtrasState | null,
) => Promise<SaveResult>;

/** Mirrors `checkUsernameAvailabilityAction`'s result (kept structural so this
 * client component never imports a "use server" module's internals). */
export type UsernameCheckResult =
  | { status: "available" }
  | { status: "taken"; message: string }
  | { status: "invalid"; message: string };

interface BioFlowProps {
  mode: "onboarding" | "edit";
  initialResponses: QuestionnaireResponses;
  initialFlags: Record<string, boolean>;
  initialExtras: BioExtrasState;
  action: BioFlowAction;
  searchCamps: (query: string) => Promise<CampSearchResult[]>;
  /** Live "is this handle free?" check. Debounced here; authorised + validated
   * server-side (the client hint is a courtesy, never the gate). */
  checkUsername: (candidate: string) => Promise<UsernameCheckResult>;
  /** Where to land after a successful final submit. */
  redirectTo: string;
}

const FORM_ERROR_KEY = "_form";
const SAVE_FAILED =
  "We couldn't save your answers just now. Please try again in a moment.";

type StepKey = "welcome" | "details" | "burns" | "privacy" | "done";

const STEP_LABELS: Record<StepKey, string> = {
  welcome: "Welcome",
  details: "Your details",
  burns: "Burns & volunteering",
  privacy: "Privacy",
  done: "Done",
};

const ONBOARDING_STEPS: StepKey[] = [
  "welcome",
  "details",
  "burns",
  "privacy",
  "done",
];
const EDIT_STEPS: StepKey[] = ["details", "burns", "privacy"];

const PRIVACY_BY_KEY = new Map<string, BioPrivacyField>(
  BIO_PRIVACY_FIELDS.map((f) => [f.key, f]),
);

// The streamlined flow does not collect the legacy bio/skills/first-timer/
// contact-email fields, so they are omitted from the privacy review (their flags
// keep their defaults, and any pre-existing values are carried forward untouched
// on save).
const PRIVACY_REVIEW_EXCLUDE = new Set([
  "bio",
  "skills",
  "firstTime",
  "contactEmail",
]);
const PRIVACY_REVIEW_FIELDS = BIO_PRIVACY_FIELDS.filter(
  (f) => !PRIVACY_REVIEW_EXCLUDE.has(f.key),
);

export function BioFlow({
  mode,
  initialResponses,
  initialFlags,
  initialExtras,
  action,
  searchCamps,
  checkUsername,
  redirectTo,
}: BioFlowProps) {
  const router = useRouter();
  const steps = mode === "onboarding" ? ONBOARDING_STEPS : EDIT_STEPS;

  const [stepIndex, setStepIndex] = React.useState(0);
  const [responses, setResponses] =
    React.useState<QuestionnaireResponses>(initialResponses);
  // The handle they arrived holding. Re-checking it would tell someone their own
  // username is taken, so the availability probe skips it entirely.
  const [initialUsername] = React.useState(() => {
    const v = initialResponses[USERNAME_QUESTION_ID];
    return typeof v === "string" ? v.trim().toLowerCase() : "";
  });
  const [flags, setFlags] =
    React.useState<Record<string, boolean>>(initialFlags);
  const [extras, setExtras] = React.useState<BioExtrasState>(initialExtras);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [isPending, startTransition] = React.useTransition();

  const step = steps[stepIndex];
  const isLastInput = step === "privacy";

  function setResp(id: string, value: QuestionnaireResponseValue) {
    setResponses((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function setFlag(key: string, isPublic: boolean) {
    setFlags((prev) => ({ ...prev, [key]: isPublic }));
  }

  const str = (id: string): string => {
    const v = responses[id];
    return typeof v === "string" ? v : "";
  };
  const arr = (id: string): string[] => {
    const v = responses[id];
    return Array.isArray(v) ? v.map(String) : [];
  };
  const describedBy = (id: string): string =>
    errors[id] ? `${id}-error` : `${id}-help`;

  const usernameState = useUsernameAvailability(
    str(USERNAME_QUESTION_ID),
    initialUsername,
    checkUsername,
  );

  // Nothing on this step is required — the username is an optional alias, so
  // the only way to fail here is to type a MALFORMED one. Blank sails through.
  function validateDetails(): boolean {
    const next: Record<string, string> = {};
    const candidate = str(USERNAME_QUESTION_ID).trim();
    if (candidate !== "") {
      const checked = validateUsername(candidate);
      if (!checked.ok) next[USERNAME_QUESTION_ID] = checked.error;
      else if (usernameState.status === "taken") {
        next[USERNAME_QUESTION_ID] = usernameState.message;
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function persist(final: boolean, onOk: () => void) {
    startTransition(async () => {
      try {
        const result = await action(responses, flags, final, extras);
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        setErrors({});
        onOk();
      } catch {
        setErrors((prev) => ({ ...prev, [FORM_ERROR_KEY]: SAVE_FAILED }));
      }
    });
  }

  function goTo(index: number) {
    setStepIndex(Math.max(0, Math.min(index, steps.length - 1)));
  }

  function handlePrimary() {
    if (step === "welcome") {
      goTo(stepIndex + 1);
      return;
    }
    if (step === "done") {
      navigateOnwards(router, redirectTo);
      return;
    }
    if (step === "details" && !validateDetails()) return;

    if (isLastInput) {
      persist(true, () => {
        if (mode === "onboarding") goTo(stepIndex + 1);
        else navigateOnwards(router, redirectTo);
      });
      return;
    }
    persist(false, () => goTo(stepIndex + 1));
  }

  function handleFinishLater() {
    persist(false, () => {
      toast.success("Saved — you can pick up where you left off.");
      router.push("/");
    });
  }

  const primaryLabel = (() => {
    if (step === "welcome") return "Get started";
    // Honest copy: when an invite is waiting behind this gate, the button
    // finishes THAT, not a trip to the directory.
    if (step === "done") {
      return redirectTo === INVITE_RESUME_PATH
        ? "Continue to your camp"
        : "Go to the directory";
    }
    if (isLastInput) return mode === "edit" ? "Save changes" : "Complete my bio";
    return "Save & continue";
  })();

  return (
    <div className="flex flex-col gap-6">
      <Stepper steps={steps} current={stepIndex} />

      {step === "welcome" && <WelcomeStep />}

      {step === "details" && (
        <DetailsStep
          str={str}
          arr={arr}
          errors={errors}
          describedBy={describedBy}
          setResp={setResp}
          flags={flags}
          setFlag={setFlag}
          usernameState={usernameState}
        />
      )}

      {step === "burns" && (
        <BurnsAndVolunteeringStep
          value={extras}
          onChange={setExtras}
          searchCamps={searchCamps}
        />
      )}

      {step === "privacy" && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold">Privacy</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A final look at what shows on your public profile. Sensitive fields
              are locked private and can never be made public.
            </p>
          </div>
          <PrivacyToggles
            fields={PRIVACY_REVIEW_FIELDS}
            flags={flags}
            onChange={setFlag}
          />
        </div>
      )}

      {step === "done" && <DoneStep />}

      {(errors[FORM_ERROR_KEY] || errors._root) && (
        <p role="alert" className="text-sm text-destructive">
          {errors[FORM_ERROR_KEY] ?? errors._root}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <div>
          {stepIndex > 0 && step !== "done" && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => goTo(stepIndex - 1)}
              disabled={isPending}
            >
              Back
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {mode === "onboarding" && step !== "welcome" && step !== "done" && (
            <Button
              type="button"
              variant="outline"
              onClick={handleFinishLater}
              disabled={isPending}
            >
              Save &amp; finish later
            </Button>
          )}
          <Button type="button" onClick={handlePrimary} disabled={isPending}>
            {isPending ? "Saving…" : primaryLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Stepper -------------------------------------------------------------

function Stepper({ steps, current }: { steps: StepKey[]; current: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono uppercase tracking-[0.2em] text-accent">
          Burner Bio
        </span>
        <span className="text-muted-foreground">
          Step {current + 1} of {steps.length}
        </span>
      </div>
      <ol className="flex items-center gap-2">
        {steps.map((key, i) => {
          const state =
            i < current ? "done" : i === current ? "current" : "upcoming";
          return (
            <li key={key} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors",
                  state === "current" &&
                    "border-primary bg-primary text-primary-foreground",
                  state === "done" &&
                    "border-primary bg-primary/15 text-primary",
                  state === "upcoming" &&
                    "border-border bg-muted text-muted-foreground",
                )}
              >
                {state === "done" ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cn(
                  "hidden text-xs font-medium sm:inline",
                  state === "upcoming"
                    ? "text-muted-foreground"
                    : "text-foreground",
                )}
              >
                {STEP_LABELS[key]}
              </span>
              {i < steps.length - 1 && (
                <span className="hidden h-px flex-1 bg-border md:block" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// --- Welcome / Done ------------------------------------------------------

function WelcomeStep() {
  return (
    <div className="flex flex-col gap-3 py-2">
      <h2 className="text-2xl font-semibold tracking-tight">Your Burner Bio</h2>
      <p className="text-muted-foreground">
        A short, self-serve profile you carry year to year. Fill it once — every
        field you set means one less form later. Sensitive details (phone,
        emergency contacts, ID) stay locked private, always; medical notes are
        never public either, and each field tells you who can see it.
      </p>
    </div>
  );
}

function DoneStep() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
          <Check className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="text-xl font-semibold tracking-tight">
          You&apos;re all set
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your Burner Bio is saved. You can edit any of it any time from your
          profile — the rest of the app is open now.
        </p>
      </CardContent>
    </Card>
  );
}

// --- Username availability ------------------------------------------------

type UsernameState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "taken"; message: string }
  | { status: "invalid"; message: string };

/** How long the field sits quiet before asking the server. Long enough that
 * typing a 12-character handle costs ONE request rather than twelve — the whole
 * reason the check is affordable to expose at all. */
const USERNAME_DEBOUNCE_MS = 400;

/**
 * Debounced "is this handle free?". Client-side format rules run first, so a
 * malformed candidate never reaches the network; only well-formed, changed
 * candidates are asked about. The verdict is a HINT — `saveBio` re-validates and
 * the unique index is the actual guarantee.
 */
function useUsernameAvailability(
  candidate: string,
  initialUsername: string,
  check: (candidate: string) => Promise<UsernameCheckResult>,
): UsernameState {
  const [state, setState] = React.useState<UsernameState>({ status: "idle" });

  React.useEffect(() => {
    const trimmed = candidate.trim();
    if (trimmed === "" || trimmed.toLowerCase() === initialUsername) {
      setState({ status: "idle" });
      return;
    }
    const checked = validateUsername(trimmed);
    if (!checked.ok) {
      setState({ status: "invalid", message: checked.error });
      return;
    }

    setState({ status: "checking" });
    let cancelled = false;
    const timer = setTimeout(() => {
      check(trimmed)
        .then((result) => {
          if (cancelled) return;
          setState(
            result.status === "available" ? { status: "available" } : result,
          );
        })
        // A failed probe must not look like a verdict: fall silent and let the
        // save path be the one that says no.
        .catch(() => {
          if (!cancelled) setState({ status: "idle" });
        });
    }, USERNAME_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [candidate, initialUsername, check]);

  return state;
}

function UsernameStatus({ state }: { state: UsernameState }) {
  if (state.status === "idle") return null;
  if (state.status === "checking") {
    return <p className="text-xs text-muted-foreground">Checking…</p>;
  }
  if (state.status === "available") {
    return (
      <p className="text-xs text-success">That username is free — nice one.</p>
    );
  }
  return <p className="text-xs text-destructive">{state.message}</p>;
}

// --- Details step --------------------------------------------------------

interface DetailsStepProps {
  str: (id: string) => string;
  arr: (id: string) => string[];
  errors: Record<string, string>;
  describedBy: (id: string) => string;
  setResp: (id: string, value: QuestionnaireResponseValue) => void;
  flags: Record<string, boolean>;
  setFlag: (key: string, isPublic: boolean) => void;
  usernameState: UsernameState;
}

function DetailsStep({
  str,
  arr,
  errors,
  describedBy,
  setResp,
  flags,
  setFlag,
  usernameState,
}: DetailsStepProps) {
  const privacySwitch = (key: string) => {
    const f = PRIVACY_BY_KEY.get(key);
    return (
      <Switch
        variant="privacy"
        checked={flags[key] === true}
        onCheckedChange={(v) => setFlag(key, v)}
        aria-label={`${f?.label ?? key} — public or private`}
      />
    );
  };
  const lockedSwitch = (label: string) => (
    <Switch variant="privacy" hardLocked aria-label={`${label} — always private`} />
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Your details</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How you show up in the directory and to camps you join. Toggle each
          field public or private as you go.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          {/* No privacy toggle: a username is globally unique and is how other
              burners address you, so "private handle" is not an honest state to
              offer. Everything below it stays individually toggleable. */}
          <Field
            label="Username"
            htmlFor={USERNAME_QUESTION_ID}
            help={USERNAME_HELP}
            error={errors[USERNAME_QUESTION_ID]}
          >
            <Input
              id={USERNAME_QUESTION_ID}
              value={str(USERNAME_QUESTION_ID)}
              placeholder="e.g. dusty_prototype"
              maxLength={USERNAME_MAX_LENGTH}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={describedBy(USERNAME_QUESTION_ID)}
              onChange={(e) => setResp(USERNAME_QUESTION_ID, e.target.value)}
            />
            {!errors[USERNAME_QUESTION_ID] && (
              <UsernameStatus state={usernameState} />
            )}
          </Field>

          <Field
            label="Real name"
            htmlFor="legalName"
            help="Optional — used only where AfrikaBurn needs it for logistics."
            privacyToggle={privacySwitch("legalName")}
          >
            <Input
              id="legalName"
              value={str("legalName")}
              placeholder="Your legal name"
              aria-describedby={describedBy("legalName")}
              onChange={(e) => setResp("legalName", e.target.value)}
            />
          </Field>

          <Field
            label="Home city"
            htmlFor="homeCity"
            help="Where you're travelling to the Tankwa from."
            privacyToggle={privacySwitch("homeCity")}
          >
            <Input
              id="homeCity"
              value={str("homeCity")}
              placeholder="e.g. Cape Town"
              aria-describedby={describedBy("homeCity")}
              onChange={(e) => setResp("homeCity", e.target.value)}
            />
          </Field>

          <Field
            label="Years attended"
            help="Tap every year you were on the playa. 2020 and 2021 had no burn."
            privacyToggle={privacySwitch("attendedYears")}
          >
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              value={arr("attendedYears")}
              onValueChange={(vals) => setResp("attendedYears", vals)}
              className="justify-start"
            >
              {attendedYearOptions().map(({ year, disabled }) => (
                <ToggleGroupItem
                  key={year}
                  value={String(year)}
                  disabled={disabled}
                  aria-label={disabled ? `${year} — no burn was held` : `${year}`}
                  title={disabled ? "No burn was held this year" : undefined}
                  className="h-auto flex-col gap-0 py-1.5"
                >
                  <span className="text-sm tabular-nums">{year}</span>
                  {disabled && (
                    <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                      no burn
                    </span>
                  )}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
            Held privately — safety &amp; logistics
          </CardTitle>
          <CardDescription>
            These are locked private — never shown in the directory or to other
            camps. Phone, emergency contacts and ID reach only AfrikaBurn safety
            and logistics; medical notes also reach your camp leads, so someone
            close by can help you.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field
            label="Phone"
            htmlFor="phone"
            help="Include the country code, e.g. +27 82 555 1234."
            privacyToggle={lockedSwitch("Phone")}
          >
            <PhoneInput
              id="phone"
              value={str("phone")}
              describedBy={describedBy("phone")}
              onChange={(v) => setResp("phone", v)}
            />
          </Field>

          <Field
            label="On-site emergency contact"
            htmlFor="onsite.name"
            help="Someone at the burn we can reach if needed."
            privacyToggle={lockedSwitch("On-site emergency contact")}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                id="onsite.name"
                value={str("onsite.name")}
                placeholder="Full name"
                aria-label="On-site contact name"
                onChange={(e) => setResp("onsite.name", e.target.value)}
              />
              <PhoneInput
                value={str("onsite.phone")}
                onChange={(v) => setResp("onsite.phone", v)}
              />
            </div>
          </Field>

          <Field
            label="Off-site emergency contact"
            htmlFor="offsite.name"
            help="Someone not at the burn — next of kin or similar."
            privacyToggle={lockedSwitch("Off-site emergency contact")}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                id="offsite.name"
                value={str("offsite.name")}
                placeholder="Full name"
                aria-label="Off-site contact name"
                onChange={(e) => setResp("offsite.name", e.target.value)}
              />
              <PhoneInput
                value={str("offsite.phone")}
                onChange={(v) => setResp("offsite.phone", v)}
              />
            </div>
          </Field>

          {/* CONSENT AT THE POINT OF ENTRY. Medical notes are never public, but
              they ARE visible to the burner's camp leads and AfrikaBurn's safety
              team — so this help text, shared with the questionnaire definition
              and the privacy review via MEDICAL_AUDIENCE_NOTE, must name that
              audience wherever medical is captured or edited. The honest label
              IS the privacy control (Ryan, 26 Jul 2026). */}
          <Field
            label="Medical notes"
            htmlFor="medicalNotes"
            help={`Allergies, conditions, medication a medic should know. ${MEDICAL_AUDIENCE_NOTE}`}
            privacyToggle={lockedSwitch("Medical notes")}
          >
            <Textarea
              id="medicalNotes"
              rows={3}
              value={str("medicalNotes")}
              placeholder="Anything a medic should know…"
              onChange={(e) => setResp("medicalNotes", e.target.value)}
            />
          </Field>

          <Field
            label="Identity document"
            htmlFor="id.number"
            help="Stored encrypted at rest (POPIA). Used only for ticket and access allocation."
            privacyToggle={lockedSwitch("Identity document")}
          >
            <div className="flex flex-col gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={str("id.type")}
                onValueChange={(v) => {
                  if (v) setResp("id.type", v);
                }}
                className="justify-start"
              >
                <ToggleGroupItem value="passport">Passport</ToggleGroupItem>
                <ToggleGroupItem value="sa_id">
                  South African ID
                </ToggleGroupItem>
              </ToggleGroup>
              {/* A PLAIN, VISIBLE input — deliberately not the masked one.
                  An ID or passport number is transcribed from a document in
                  your hand, and a single wrong character means the name on the
                  ticket will not match the document at the gate. You cannot
                  proof-read what you cannot see, and masking buys nothing here:
                  the value is already yours, on your screen, and the protection
                  that matters is encryption at rest plus never showing it to
                  anyone else. */}
              <Input
                id="id.number"
                value={str("id.number")}
                placeholder="Document number"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                onChange={(e) => setResp("id.number", e.target.value)}
              />
            </div>
          </Field>
        </CardContent>
      </Card>
    </div>
  );
}
