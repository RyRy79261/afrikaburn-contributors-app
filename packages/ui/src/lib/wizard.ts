// Pure, framework-agnostic wizard-navigator logic — the section-state machine
// behind the registration Wizard (canvas `QWDKT`; the ONLY numbered-sections
// component per the flow red-lines). No React, no "use client", so the
// derivation is unit-testable in isolation and shared by both the desktop rail
// and the mobile strip variants.

export type WizardSectionState = "done" | "current" | "todo" | "blocked";

/** Caller input for one section. */
export interface WizardSectionInput {
  /** Stable id (also the navigation target). */
  id: string;
  /** Human label shown beside the number. */
  label: string;
  /** Section is complete. `done` wins over every other state. */
  done?: boolean;
  /** Section cannot be entered yet (e.g. a gate ahead of it is unmet). */
  blocked?: boolean;
}

/** A section after state derivation. */
export interface WizardSection {
  id: string;
  label: string;
  /** 1-based position — the number the navigator renders. */
  index: number;
  state: WizardSectionState;
}

export interface WizardProgress {
  sections: WizardSection[];
  /** Count of done sections. */
  completed: number;
  /** Total sections. */
  total: number;
  /** Progress copy, e.g. "3 of 6 complete". */
  label: string;
  /** The resolved current section id (null when none is current). */
  currentId: string | null;
}

/**
 * Derive per-section states and overall progress.
 *
 * Rules (precedence): a `done` section is always "done". Otherwise the resolved
 * current section is "current"; a `blocked` section is "blocked"; anything else
 * is "todo". When `currentId` is omitted (or points at a done/blocked section),
 * the current section is the first not-done, not-blocked section — so the
 * navigator always highlights the next actionable step.
 */
export function deriveWizardProgress(
  sections: WizardSectionInput[],
  currentId?: string,
): WizardProgress {
  const total = sections.length;
  const completed = sections.filter((s) => s.done).length;

  const isActionable = (s: WizardSectionInput) => !s.done && !s.blocked;
  const requested = currentId
    ? sections.find((s) => s.id === currentId)
    : undefined;
  const resolvedCurrent =
    requested && isActionable(requested)
      ? requested
      : sections.find(isActionable);
  const currentResolvedId = resolvedCurrent?.id ?? null;

  const derived: WizardSection[] = sections.map((s, i) => {
    let state: WizardSectionState;
    if (s.done) state = "done";
    else if (s.id === currentResolvedId) state = "current";
    else if (s.blocked) state = "blocked";
    else state = "todo";
    return { id: s.id, label: s.label, index: i + 1, state };
  });

  return {
    sections: derived,
    completed,
    total,
    label: `${completed} of ${total} complete`,
    currentId: currentResolvedId,
  };
}
