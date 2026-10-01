"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckSquare,
  Info,
  PlayCircle,
} from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import type { startOnboardingAction } from "@/app/(app)/camps/[slug]/questionnaires/onboarding-actions";

// "Start from" (canvas A1): a blank questionnaire, or the onboarding preset.
// Blank stays the default so the existing builder is exactly where it was;
// picking Onboarding shows what the preset adds and creates a DRAFT — nothing
// is sent from here.

const PRESET_PARTS = [
  { icon: Info, title: "Welcome", body: "Who the camp is and what to expect" },
  { icon: Info, title: "Our culture", body: "How you live together on the playa" },
  { icon: Info, title: "Camp rules", body: "The few things everyone signs up to" },
  {
    icon: Info,
    title: "What the camp provides",
    body: "And what each campmate brings",
  },
  { icon: Info, title: "Build & strike", body: "Dates and what you ask of people" },
  {
    icon: CheckSquare,
    title: "Acknowledgements",
    body: "Tick boxes they tick to finish",
  },
  {
    icon: PlayCircle,
    title: "Video link (optional)",
    body: "A YouTube or Vimeo link — shown as a card, we don't host video",
  },
] as const;

export function QuestionnaireStartChooser({
  slug,
  canStartOnboarding,
  refusal,
  startOnboarding,
  children,
}: {
  slug: string;
  canStartOnboarding: boolean;
  /** Why onboarding can't be started by this viewer (shown, not hidden). */
  refusal: string | null;
  startOnboarding: typeof startOnboardingAction;
  /** The blank builder. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [choice, setChoice] = React.useState<"blank" | "onboarding">("blank");
  const [isPending, startTransition] = React.useTransition();

  function start() {
    startTransition(async () => {
      const result = await startOnboarding({ slug });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push(
        `/camps/${slug}/questionnaires/onboarding/${result.activationId}`,
      );
    });
  }

  const options = [
    {
      key: "blank" as const,
      title: "Blank",
      body: "An empty questionnaire. Add your own questions and info blocks.",
    },
    {
      key: "onboarding" as const,
      title: "Onboarding",
      body: "A welcome for your campmates, pre-filled with sections you edit and tick-box acknowledgements.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">Start from</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={choice === o.key}
              onClick={() => setChoice(o.key)}
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors",
                choice === o.key
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:bg-muted",
              )}
            >
              <span className="text-base font-medium">{o.title}</span>
              <span className="text-sm text-muted-foreground">{o.body}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {choice === "blank" ? (
        children
      ) : (
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5">
          <div className="flex flex-col gap-3">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              What the onboarding preset adds
            </p>
            <ul className="flex flex-col gap-3">
              {PRESET_PARTS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">{title}</span>
                    <span className="text-sm text-muted-foreground">{body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span>
              Not blocking by default — campmates can use the app and finish it
              whenever they like. You can switch blocking on in the builder;
              it&apos;s labelled everywhere it shows.
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={start} disabled={!canStartOnboarding || isPending}>
              <ArrowRight className="h-4 w-4" aria-hidden />
              {isPending ? "Starting…" : "Continue with Onboarding"}
            </Button>
            <Button variant="ghost" onClick={() => setChoice("blank")}>
              Cancel
            </Button>
            {refusal && (
              <span className="text-xs text-muted-foreground">{refusal}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
