// Camp onboarding (epic #54, App Spec ONBOARD-001..028).
//
// NOT A NEW FEATURE — A PRESET ON CAMP QUESTIONNAIRES (Ryan, 27 Sep 2026). An
// onboarding is an ordinary camp questionnaire whose definition carries
// `preset: "onboarding"`: info blocks for the welcome/culture/rules/provides
// sections, an optional video LINK card, and acknowledgement tick boxes. It
// rides the same activation → required_actions → responses spine as every
// other camp questionnaire, so the gate, the pending list, the runner and the
// close/recall path need nothing new. What this module adds is pure domain
// logic around it:
//
//   - the preset itself (`buildOnboardingPreset`) and the rule for what an
//     onboarding definition may contain (`validateOnboardingDefinition`);
//   - "new to the camp" vs "returning" (`classifyCampTenure`) — relative to
//     THIS camp, never to AfrikaBurn (Ryan, 28 Sep 2026);
//   - the default audience (everyone in the camp, leads included);
//   - the lead's completion totals (`tallyOnboardingCompletion`) — totals
//     first, names only on demand (ONBOARD-020);
//   - carrying last edition's onboarding forward as a DRAFT (ONBOARD-022).
//
// Money law: no section of the preset asks for or describes a payment
// (ONBOARD-013 is out). Registration law: nothing here is read by the
// registration flow — onboarding is between a camp and its own members.
//
// Pure: no I/O, no env, depends only on @quagga/types.

import {
  Questionnaire,
  type CampTenure,
  type NotificationPayload,
  type ProjectAudience,
  type ProjectStructuralRole,
  type QuestionnairePage,
} from "@quagga/types";
import { validateQuestionnaireDefinition } from "./questionnaire-definition";
import { canAuthorProjectQuestionnaire } from "./questionnaire-authz";
import {
  hasProjectPermission,
  type PermissionMembership,
} from "./project-permissions";

/** Group kinds an onboarding may be authored for. Theme camps only: the
 * preset's sections are a camp's (culture, rules, what the camp provides). */
export const ONBOARDING_GROUP_KINDS: readonly string[] = ["theme_camp"];

/**
 * May this member write, edit, send, discard or recall a camp onboarding with
 * THIS audience and blocking choice? The same authority as any camp
 * questionnaire — lead/admin (the irrevocable backstop) or a holder of
 * `manage_questionnaires` within its configured audience roles and `may_block`
 * — checked against the audience actually being written. Enforced
 * server-side by every onboarding action; the builder only mirrors it.
 *
 * `groupKind` must be a theme camp; the org group can never author one.
 */
export function canAuthorOnboarding(
  m: PermissionMembership | null,
  groupKind: string,
  audience: ProjectAudience,
  blocking: boolean,
  baselineRoleId: string | null,
): boolean {
  if (!m) return false;
  if (!ONBOARDING_GROUP_KINDS.includes(groupKind)) return false;
  if (!hasProjectPermission(m, "manage_questionnaires")) return false;
  return canAuthorProjectQuestionnaire(m, audience, blocking, baselineRoleId);
}

/**
 * The inbox row an onboarding send (or a late joiner's delivery) writes. Says
 * what it is and where it came from; a blocking one says it blocks the APP —
 * never "registration", which onboarding has nothing to do with.
 */
export function onboardingReleasedNotification(input: {
  title: string;
  blocking: boolean;
  activationId: string;
  campName: string;
}): NotificationPayload {
  const from = input.campName.trim() || "Your camp";
  return {
    kind: "questionnaire",
    title: input.blocking
      ? `Onboarding from ${from}: ${input.title} — REQUIRED, blocks the app until done`
      : `Onboarding from ${from}: ${input.title}`,
    body: null,
    link: `/questionnaires/${input.activationId}`,
  };
}

// --- The preset ----------------------------------------------------------

/** The block kinds an onboarding may contain. Deliberately small: onboarding
 * TELLS people things and asks them to acknowledge them. A camp that needs
 * answers (dietary needs, shift preferences) sends an ordinary questionnaire —
 * "fewer forms" applies to the preset too. */
export const ONBOARDING_BLOCK_KINDS = [
  "info_block",
  "video_link",
  "acknowledgement",
] as const;
export type OnboardingBlockKind = (typeof ONBOARDING_BLOCK_KINDS)[number];

/** Upper bounds, so a definition stays something a person reads on a phone. */
export const ONBOARDING_LIMITS = {
  sections: 12,
  blocksPerSection: 12,
  acknowledgements: 20,
  bodyChars: 4000,
  headingChars: 120,
  titleChars: 140,
} as const;

/** True when a definition was built from the onboarding preset. */
export function isOnboardingDefinition(
  definition: Pick<Questionnaire, "preset"> | null | undefined,
): boolean {
  return definition?.preset === "onboarding";
}

/** The page id of the acknowledgements section the preset creates. */
export const ONBOARDING_ACK_SECTION_ID = "acknowledgements";

/**
 * The onboarding preset (A1 "What the onboarding preset adds"). Every word is a
 * starting point the lead edits; nothing here names a real camp beyond the
 * title, which is the camp's own name (data, not chrome).
 *
 * One page per section — the member walks it ONE STEP AT A TIME (Ryan,
 * 28 Sep 2026), and the acknowledgements come last so "Finish" is the tick
 * that closes it.
 */
export function buildOnboardingPreset(): Questionnaire {
  const info = (
    pageId: string,
    title: string,
    body: string,
  ): QuestionnairePage => ({
    id: pageId,
    kind: "questions",
    title,
    questions: [{ id: `${pageId}_info`, kind: "info_block", body }],
  });
  return {
    version: "1",
    preset: "onboarding",
    pages: [
      info(
        "welcome",
        "Welcome",
        "Who we are, where we camp and what to expect. Replace this with a few friendly lines about your camp.",
      ),
      info(
        "culture",
        "Our culture",
        "How we live together on the playa — the things that make this camp feel like this camp.",
      ),
      info(
        "rules",
        "Camp rules",
        "The few things everyone signs up to. Keep it short — people read this on a phone.",
      ),
      info(
        "provides",
        "What the camp provides",
        "What the camp brings for everyone, and what each campmate brings for themselves.",
      ),
      info(
        "build_strike",
        "Build & strike",
        "When build and strike happen, and what you ask of people.",
      ),
      {
        id: ONBOARDING_ACK_SECTION_ID,
        kind: "questions",
        title: "Before you arrive",
        subtitle: "Tick each one to finish.",
        questions: [
          {
            id: "ack_rules",
            kind: "acknowledgement",
            prompt: "I've read the camp rules and I'll follow them.",
            required: true,
          },
          {
            id: "ack_leave_no_trace",
            kind: "acknowledgement",
            prompt: "I'll pack out everything I bring in — leave no trace.",
            required: true,
          },
        ],
      },
    ],
  };
}

/** The title the preset suggests for a camp. The camp's name is data. */
export function onboardingTitleFor(campName: string): string {
  const name = campName.trim();
  return name ? `Welcome to ${name}`.slice(0, 140) : "Welcome to the camp";
}

export type OnboardingValidation =
  { ok: true; definition: Questionnaire } | { ok: false; error: string };

/**
 * What an onboarding definition may be — the server-side rule every save and
 * every send runs (the builder mirrors it; the server is the boundary).
 *
 * On top of the shared structural checks (unique ids, reachability — the
 * `validateQuestionnaireDefinition` every questionnaire passes):
 *   - it is marked `preset: "onboarding"`;
 *   - every section is a questions page (no intro interstitials);
 *   - every block is an info block, a video link card or an acknowledgement;
 *   - no branching (an onboarding is read front to back);
 *   - it stays within ONBOARDING_LIMITS.
 */
export function validateOnboardingDefinition(
  raw: unknown,
): OnboardingValidation {
  const parsed = Questionnaire.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Every section needs a heading and some text." };
  }
  const def = parsed.data;
  if (def.preset !== "onboarding") {
    return { ok: false, error: "That isn't an onboarding." };
  }
  if (def.pages.length > ONBOARDING_LIMITS.sections) {
    return {
      ok: false,
      error: `Keep it to ${ONBOARDING_LIMITS.sections} sections or fewer.`,
    };
  }
  const allowed = new Set<string>(ONBOARDING_BLOCK_KINDS);
  let acks = 0;
  for (const page of def.pages) {
    if (page.kind !== "questions") {
      return { ok: false, error: "Every section must be a normal section." };
    }
    if (page.next !== undefined || page.shuffleQuestions) {
      return { ok: false, error: "Onboarding sections are read in order." };
    }
    if (
      page.title.length > ONBOARDING_LIMITS.headingChars ||
      (page.subtitle?.length ?? 0) > ONBOARDING_LIMITS.headingChars * 2
    ) {
      return { ok: false, error: "A section heading is too long." };
    }
    if (page.questions.length > ONBOARDING_LIMITS.blocksPerSection) {
      return { ok: false, error: "A section has too many parts." };
    }
    for (const block of page.questions) {
      if (!allowed.has(block.kind)) {
        return {
          ok: false,
          error:
            "Onboarding holds text, video links and tick boxes only — send an ordinary questionnaire to ask questions.",
        };
      }
      if (
        block.kind === "info_block" &&
        (block.body.length > ONBOARDING_LIMITS.bodyChars ||
          (block.heading?.length ?? 0) > ONBOARDING_LIMITS.headingChars)
      ) {
        return { ok: false, error: "A section's text is too long." };
      }
      if (
        block.kind === "acknowledgement" &&
        (block.helper?.length ?? 0) > ONBOARDING_LIMITS.headingChars * 2
      ) {
        return { ok: false, error: "A tick box's note is too long." };
      }
      if (block.kind === "acknowledgement") acks++;
    }
  }
  if (acks > ONBOARDING_LIMITS.acknowledgements) {
    return {
      ok: false,
      error: `Keep it to ${ONBOARDING_LIMITS.acknowledgements} acknowledgements or fewer.`,
    };
  }
  const structural = validateQuestionnaireDefinition(def);
  if (!structural.ok) {
    return {
      ok: false,
      error: "Something in this onboarding is out of shape — reload and retry.",
    };
  }
  return { ok: true, definition: def };
}

/** Section / acknowledgement counts, for the builder's header line and the
 * carry-forward summary. */
export function summarizeOnboarding(definition: Questionnaire): {
  sections: number;
  acknowledgements: number;
  videoLinks: number;
} {
  let acknowledgements = 0;
  let videoLinks = 0;
  for (const page of definition.pages) {
    if (page.kind !== "questions") continue;
    for (const block of page.questions) {
      if (block.kind === "acknowledgement") acknowledgements++;
      if (block.kind === "video_link") videoLinks++;
    }
  }
  return { sections: definition.pages.length, acknowledgements, videoLinks };
}

// --- Partial progress (Ryan, 1 Oct 2026) -----------------------------------

/** What a member's runner reports as they go: the step they are on and the
 * acknowledgements ticked so far. */
export interface OnboardingProgressReport {
  step: number;
  acknowledged: readonly string[];
}

/**
 * Clamp a client's progress report to the onboarding it is about. The step is
 * cut to 1..sections, and only ids of THIS onboarding's acknowledgement boxes
 * survive (deduplicated, in definition order) — the client is never trusted to
 * say how long the onboarding is or what is in it.
 */
export function clampOnboardingProgress(
  definition: Questionnaire,
  report: OnboardingProgressReport,
): { step: number; acknowledged: string[] } {
  const steps = Math.max(definition.pages.length, 1);
  const step = Number.isFinite(report.step)
    ? Math.min(Math.max(Math.trunc(report.step), 1), steps)
    : 1;
  const ticked = new Set(report.acknowledged);
  const acknowledged: string[] = [];
  for (const page of definition.pages) {
    if (page.kind !== "questions") continue;
    for (const block of page.questions) {
      if (block.kind === "acknowledgement" && ticked.has(block.id)) {
        acknowledged.push(block.id);
      }
    }
  }
  return { step, acknowledged };
}

/** "Step 3 of 6" for someone part-way; "Not started" when nothing came back. */
export function onboardingProgressLabel(
  furthestStep: number | null,
  steps: number,
): string {
  if (furthestStep === null) return "Not started";
  return `Step ${Math.min(furthestStep, steps)} of ${steps}`;
}

// --- New to the camp vs returning -----------------------------------------

/** The facts tenure is decided from — all camp-held records, never the
 * burner's own (possibly private) bio. */
export interface CampTenureFacts {
  /** When this person's membership of the camp began. */
  membershipCreatedAt: Date;
  /** Years of EARLIER editions this membership has per-edition logistics for
   * (they planned build/strike/arrival with this camp for that burn). */
  logisticsEditionYears: readonly number[];
}

/** An edition, trimmed to what tenure needs. `endDate` is `YYYY-MM-DD`. */
export interface TenureEdition {
  year: number;
  endDate: string;
}

/**
 * NEW TO THIS CAMP vs RETURNING (Ryan, 28 Sep 2026): "new" = no earlier
 * membership/edition with this camp; "returning" = has been with this camp
 * before. Relative to the camp — a veteran burner who joined this camp this
 * year is new to it.
 *
 * Returning when EITHER:
 *   - the membership began on or before the last day of the most recent
 *     EARLIER edition — they were in the camp for that burn; or
 *   - the membership holds logistics for an earlier edition.
 * Otherwise new. With no earlier edition on record, everyone is new, which is
 * the honest answer: the platform holds no earlier burn with any camp.
 *
 * Known edge, stated rather than hidden: leaving a camp deletes the membership
 * (archiving keeps it), so someone who LEFT and rejoined reads as new.
 */
export function classifyCampTenure(
  facts: CampTenureFacts,
  target: { year: number },
  editions: readonly TenureEdition[],
): CampTenure {
  if (facts.logisticsEditionYears.some((y) => y < target.year)) {
    return "returning";
  }
  const earlier = editions
    .filter((e) => e.year < target.year)
    .sort((a, b) => b.year - a.year)[0];
  if (!earlier) return "new";
  const lastDay = Date.parse(`${earlier.endDate}T23:59:59.999Z`);
  if (Number.isNaN(lastDay)) return "new";
  return facts.membershipCreatedAt.getTime() <= lastDay ? "returning" : "new";
}

// --- Audience -----------------------------------------------------------

/**
 * The audience an onboarding starts with: everyone in the camp, leads and
 * co-leads included, new and returning alike (Ryan, 1 Oct 2026 — this
 * replaced "leads off by default"). The lead can switch any of them off.
 */
export function defaultOnboardingAudience(groupId: string): ProjectAudience {
  return {
    kind: "project",
    groupId,
    mode: "everyone",
    roleIds: [],
    tenure: ["new", "returning"],
    structuralRoles: ["lead", "admin", "member"],
  };
}

export const STRUCTURAL_ROLE_LABELS: Record<ProjectStructuralRole, string> = {
  lead: "Lead",
  admin: "Co-lead",
  member: "Member",
};

export const TENURE_LABELS: Record<CampTenure, string> = {
  new: "New to the camp",
  returning: "Returning to the camp",
};

/** A one-line, generic description of an onboarding audience. */
export function describeOnboardingAudience(
  audience: ProjectAudience,
  roleNames: ReadonlyMap<string, string>,
): string {
  const tenure = audience.tenure ?? ["new", "returning"];
  const who =
    tenure.length === 2
      ? "new and returning to the camp"
      : tenure[0] === "new"
        ? "new to the camp"
        : "returning to the camp";
  const structural = audience.structuralRoles ?? ["lead", "admin", "member"];
  // All three is the whole camp — say so instead of listing every rank.
  const roles =
    structural.length === 3
      ? "Everyone"
      : structural.map((r) => STRUCTURAL_ROLE_LABELS[r]).join(", ");
  const custom =
    audience.mode === "roles"
      ? audience.roleIds
          .map((id) => roleNames.get(id))
          .filter((n): n is string => Boolean(n))
      : [];
  const narrowed = custom.length > 0 ? ` holding ${custom.join(" or ")}` : "";
  return `${who} · ${roles}${narrowed}`;
}

// --- Completion (ONBOARD-020: totals first, names only on demand) ---------

/** One targeted person, as the completion view counts them. */
export interface OnboardingCompletionRow {
  /** The required-action status for this person. */
  status: string;
  tenure: CampTenure;
  /** True when their runner has reported any progress (they opened it). */
  started?: boolean;
}

export interface OnboardingCompletion {
  total: number;
  complete: number;
  percent: number;
  outstanding: number;
  /** Not finished, but opened and part-way through. */
  inProgress: number;
  newTotal: number;
  newComplete: number;
  returningTotal: number;
  returningComplete: number;
}

/**
 * Totals for the lead. Rows are the CURRENT members the onboarding reached —
 * the caller joins active memberships, so a former member never counts (their
 * pending sends are waived on archive, and their history is not the camp's
 * current state). A `waived` row is excluded for the same reason.
 */
export function tallyOnboardingCompletion(
  rows: readonly OnboardingCompletionRow[],
): OnboardingCompletion {
  const live = rows.filter((r) => r.status !== "waived");
  const done = (r: OnboardingCompletionRow) => r.status === "completed";
  const of = (t: CampTenure) => live.filter((r) => r.tenure === t);
  const total = live.length;
  const complete = live.filter(done).length;
  return {
    total,
    complete,
    percent: total > 0 ? Math.round((complete / total) * 100) : 0,
    outstanding: total - complete,
    inProgress: live.filter((r) => !done(r) && r.started === true).length,
    newTotal: of("new").length,
    newComplete: of("new").filter(done).length,
    returningTotal: of("returning").length,
    returningComplete: of("returning").filter(done).length,
  };
}

/** The names filter on the completion view. `null` = names not requested. */
export type OnboardingNamesFilter = "all" | "complete" | "incomplete";

export function parseOnboardingNamesFilter(
  raw: string | string[] | undefined,
): OnboardingNamesFilter | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "all" || v === "complete" || v === "incomplete" ? v : null;
}

// --- Carry forward (ONBOARD-022) --------------------------------------------

/** What an earlier edition's onboarding contributes to a new DRAFT. */
export interface OnboardingCarrySource {
  title: string;
  description: string | null;
  definition: Questionnaire;
  audience: ProjectAudience;
  blocking: boolean;
}

export interface OnboardingCarryDraft {
  title: string;
  description: string | null;
  definition: Questionnaire;
  audience: ProjectAudience;
  blocking: boolean;
  /** Always null: last year's date means nothing this year. */
  dueAt: null;
}

/**
 * Last edition's onboarding as THIS edition's draft. What comes across: the
 * sections, the video links, the acknowledgements, the audience and the
 * blocking choice. What never does: the due date (cleared) and anyone's
 * answers or ticks — those belong to the earlier edition's response rows and
 * the new draft has no activation of that edition, so there is nothing to
 * copy them from. Nothing is sent: a draft reaches nobody until Send.
 *
 * The audience is re-anchored on `groupId` so a draft can never target a camp
 * other than the one it is being carried into.
 */
export function carryForwardOnboarding(
  source: OnboardingCarrySource,
  groupId: string,
): OnboardingCarryDraft {
  return {
    title: source.title,
    description: source.description,
    definition: { ...source.definition, preset: "onboarding" },
    audience: { ...source.audience, kind: "project", groupId },
    blocking: source.blocking,
    dueAt: null,
  };
}
