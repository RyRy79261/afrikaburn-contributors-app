"use client";

import { Flame } from "lucide-react";
import type {
  Questionnaire,
  QuestionnaireResponses,
} from "@quagga/types";
import { Card, CardContent } from "@quagga/ui/components/card";
import { SignOutButton } from "@/components/sign-out-button";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import { QuestionnaireRunner } from "@/components/questionnaire/runner";
import { submitConsoleQuestionnaire } from "@/lib/questionnaires/actions";

interface ConsoleGateProps {
  activationId: string;
  title: string;
  description: string | null;
  questionnaire: Questionnaire;
  initialResponses: QuestionnaireResponses;
}

/**
 * The org-internal blocking gate: a hard interstitial that replaces the entire
 * console until the current staff member answers. Only the fill view and sign-
 * out are reachable — exactly the participant-app blocking gate, applied to the
 * console (questionnaire-spec: org-internal ones gate the console instead).
 */
export function ConsoleGate({
  activationId,
  title,
  description,
  questionnaire,
  initialResponses,
}: ConsoleGateProps) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Flame className="h-5 w-5" aria-hidden />
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
          AfrikaBurn Organiser Console
        </p>
        <BlockingBadge blocking />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {description ??
            "Answer this to unlock the console. You can't do anything else until it's submitted."}
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <QuestionnaireRunner
            questionnaire={questionnaire}
            initialResponses={initialResponses}
            action={(responses) =>
              submitConsoleQuestionnaire(activationId, responses)
            }
            submitLabel="Submit and unlock"
            // The gate is handed no respondent id, so a section that asks to be
            // shuffled is shuffled per ACTIVATION: stable across reloads (which
            // is what matters on a gate you may return to), but the same order
            // for everyone rather than per person.
            shuffleSeed={activationId}
          />
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <SignOutButton />
      </div>
    </main>
  );
}
