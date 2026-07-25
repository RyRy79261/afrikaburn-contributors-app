// Org status-board / overview statistics (build-spec §"Org stats dashboard" +
// §"Status board KPI row"). Pure derivations over already-fetched query
// results so the console's landing numbers are unit-testable without a DB and
// stay consistent across the Status Board and the Overview page (same cards).
//
// Every function takes minimal row shapes (never raw DB rows) and returns a
// plain read model. No I/O, no React, no server-only.

import type {
  RegistrationStatus,
  GroupKind,
  SupplierStanding,
  SupplierOnboardingSteps,
  OfficerKey,
} from "@quagga/types";
import { RegistrationStatus as RegistrationStatusEnum } from "@quagga/types";
import { outstandingOfficers, type OfficerTriggerInput } from "./officers";
import { deriveOnboardingProgress } from "./supplier-onboarding";
import { tallyActivationCompletion } from "./questionnaire-activation";
import { SUPPLIER_STANDINGS } from "./supplier-standing";

/** The full ordered set of registration statuses (funnel columns). */
export const REGISTRATION_STATUS_ORDER: readonly RegistrationStatus[] =
  RegistrationStatusEnum.options;

/** Statuses that mean "in the review pipeline" (submitted through changes). */
export const IN_REVIEW_STATUSES: readonly RegistrationStatus[] = [
  "submitted",
  "under_review",
  "changes_requested",
];

/** A group's best registration status is `approved` ⇒ registered. */
export function isRegisteredStatus(
  status: RegistrationStatus | null | undefined,
): boolean {
  return status === "approved";
}

/** In the review pipeline (submitted / under review / changes requested). */
export function isInReviewStatus(
  status: RegistrationStatus | null | undefined,
): boolean {
  return status != null && IN_REVIEW_STATUSES.includes(status);
}

// --- KPI card 1: BURNERS --------------------------------------------------

/** One burner bio, trimmed to what completeness needs. */
export interface BurnerBioStat {
  /** Set once the bio code-questionnaire is finished (`burner_bios.completedAt`). */
  completedAt: Date | null;
}

export interface BurnerStats {
  total: number;
  complete: number;
  /** Whole-percent bios complete (0 when there are no bios). */
  completePct: number;
}

/** BURNERS card: total bios + bios-complete %. */
export function deriveBurnerStats(
  bios: readonly BurnerBioStat[],
): BurnerStats {
  const total = bios.length;
  const complete = bios.filter((b) => b.completedAt != null).length;
  return {
    total,
    complete,
    completePct: total === 0 ? 0 : Math.round((complete / total) * 100),
  };
}

// --- Project rows (camps / MV / artworks share one input) -----------------

/**
 * One project group with its best registration status for the current edition.
 * `status` is null for a group with no registration row (a "free" camp).
 * `grantsInterest` mirrors `registrations.grants_interest` (art/MV grant flag).
 */
export interface ProjectStatInput {
  kind: GroupKind;
  status: RegistrationStatus | null;
  grantsInterest: boolean | null;
}

// --- KPI card 2: CAMPS ----------------------------------------------------

export interface CampStats {
  total: number;
  registered: number;
  free: number;
}

/** CAMPS card: total theme camps + registered/free split. */
export function deriveCampStats(
  projects: readonly ProjectStatInput[],
): CampStats {
  const camps = projects.filter((p) => p.kind === "theme_camp");
  const registered = camps.filter((p) => isRegisteredStatus(p.status)).length;
  return { total: camps.length, registered, free: camps.length - registered };
}

// --- KPI card 3: MUTANT VEHICLES ------------------------------------------

export interface MutantVehicleStats {
  total: number;
  registered: number;
  inReview: number;
}

/** MUTANT VEHICLES card: total + registered/in-review. */
export function deriveMutantVehicleStats(
  projects: readonly ProjectStatInput[],
): MutantVehicleStats {
  const mvs = projects.filter((p) => p.kind === "mutant_vehicle");
  return {
    total: mvs.length,
    registered: mvs.filter((p) => isRegisteredStatus(p.status)).length,
    inReview: mvs.filter((p) => isInReviewStatus(p.status)).length,
  };
}

// --- KPI card 4: ARTWORKS -------------------------------------------------

export interface ArtworkStats {
  total: number;
  registered: number;
  grantRequests: number;
}

/** ARTWORKS card: total + registered + grant requests. */
export function deriveArtworkStats(
  projects: readonly ProjectStatInput[],
): ArtworkStats {
  const art = projects.filter((p) => p.kind === "artwork");
  return {
    total: art.length,
    registered: art.filter((p) => isRegisteredStatus(p.status)).length,
    grantRequests: art.filter((p) => p.grantsInterest === true).length,
  };
}

/** The four headline cards, derived together. */
export interface StatusBoardKpis {
  burners: BurnerStats;
  camps: CampStats;
  mutantVehicles: MutantVehicleStats;
  artworks: ArtworkStats;
}

export function deriveStatusBoardKpis(input: {
  bios: readonly BurnerBioStat[];
  projects: readonly ProjectStatInput[];
}): StatusBoardKpis {
  return {
    burners: deriveBurnerStats(input.bios),
    camps: deriveCampStats(input.projects),
    mutantVehicles: deriveMutantVehicleStats(input.projects),
    artworks: deriveArtworkStats(input.projects),
  };
}

// --- Registration funnel --------------------------------------------------

export interface RegistrationFunnel {
  byStatus: Record<RegistrationStatus, number>;
  total: number;
}

/** Empty status→count map (every status present at 0). */
export function emptyRegistrationFunnel(): Record<RegistrationStatus, number> {
  const out = {} as Record<RegistrationStatus, number>;
  for (const s of REGISTRATION_STATUS_ORDER) out[s] = 0;
  return out;
}

/** Tally registration statuses into the funnel counts. */
export function deriveRegistrationFunnel(
  statuses: readonly RegistrationStatus[],
): RegistrationFunnel {
  const byStatus = emptyRegistrationFunnel();
  for (const s of statuses) byStatus[s] += 1;
  return { byStatus, total: statuses.length };
}

// --- Officer coverage -----------------------------------------------------

/** One camp's officer inputs (see @quagga/core `outstandingOfficers`). */
export interface CampOfficerInput {
  isRegisteredOrInFlight: boolean;
  triggers: OfficerTriggerInput;
  assignedKeys: Iterable<OfficerKey>;
}

export interface OfficerCoverage {
  /** Camps where officer requirements apply (registered or in flight). */
  applicableCamps: number;
  /** Applicable camps with every REQUIRED officer slot filled. */
  fullyOfficered: number;
  /** Applicable camps with at least one outstanding required officer. */
  campsWithGaps: number;
  /** Total unfilled required officer slots across all applicable camps. */
  outstandingSlots: number;
}

/**
 * Officer coverage across camps: "n/m fully officered" for the status board.
 * Free/unregistered camps don't count (requirements don't apply to them).
 */
export function deriveOfficerCoverage(
  camps: readonly CampOfficerInput[],
): OfficerCoverage {
  let applicable = 0;
  let full = 0;
  let outstandingSlots = 0;
  for (const camp of camps) {
    const summary = outstandingOfficers(camp);
    if (!summary.applies) continue;
    applicable += 1;
    outstandingSlots += summary.outstanding.length;
    if (summary.outstanding.length === 0) full += 1;
  }
  return {
    applicableCamps: applicable,
    fullyOfficered: full,
    campsWithGaps: applicable - full,
    outstandingSlots,
  };
}

// --- Supplier onboarding rollup + standings -------------------------------

export interface SupplierOnboardingRollup {
  total: number;
  /** Every step completed ("onboarded properly"). */
  onboarded: number;
  /** Some progress or awaiting confirmation, not yet fully onboarded. */
  inProgress: number;
  /** No step actioned at all. */
  notStarted: number;
}

/** One supplier's onboarding state (the stored step map, possibly absent). */
export interface SupplierOnboardingStat {
  steps: SupplierOnboardingSteps | null | undefined;
}

/** Distribution of suppliers across onboarded / in-progress / not-started. */
export function deriveSupplierOnboardingRollup(
  suppliers: readonly SupplierOnboardingStat[],
): SupplierOnboardingRollup {
  let onboarded = 0;
  let inProgress = 0;
  let notStarted = 0;
  for (const s of suppliers) {
    const p = deriveOnboardingProgress(s.steps);
    if (p.isOnboarded) onboarded += 1;
    else if (p.completed > 0 || p.awaiting > 0) inProgress += 1;
    else notStarted += 1;
  }
  return { total: suppliers.length, onboarded, inProgress, notStarted };
}

/** Standing → count, every standing present at 0. */
export function deriveSupplierStandingRollup(
  suppliers: readonly { standing: SupplierStanding }[],
): Record<SupplierStanding, number> {
  const out = {} as Record<SupplierStanding, number>;
  for (const s of SUPPLIER_STANDINGS) out[s] = 0;
  for (const s of suppliers) out[s.standing] += 1;
  return out;
}

// --- Questionnaire completion rollup --------------------------------------

/** One active send's per-user required-action rows (status is enough). */
export interface QuestionnaireSendStat {
  activationId: string;
  title: string;
  actions: readonly { status: string }[];
}

export interface QuestionnaireSendCompletion {
  activationId: string;
  title: string;
  sent: number;
  completed: number;
  pending: number;
  /** Whole-percent completed (0 when nothing sent). */
  completionPct: number;
}

export interface QuestionnaireCompletionRollup {
  sends: QuestionnaireSendCompletion[];
  totalSent: number;
  totalCompleted: number;
  /** Whole-percent completed across all sends (0 when nothing sent). */
  completionPct: number;
}

/** Completion rates per active send + an overall rollup. */
export function deriveQuestionnaireCompletion(
  sends: readonly QuestionnaireSendStat[],
): QuestionnaireCompletionRollup {
  let totalSent = 0;
  let totalCompleted = 0;
  const perSend = sends.map((s) => {
    const tally = tallyActivationCompletion(s.actions);
    totalSent += tally.sent;
    totalCompleted += tally.completed;
    return {
      activationId: s.activationId,
      title: s.title,
      sent: tally.sent,
      completed: tally.completed,
      pending: tally.pending,
      completionPct:
        tally.sent === 0 ? 0 : Math.round((tally.completed / tally.sent) * 100),
    };
  });
  return {
    sends: perSend,
    totalSent,
    totalCompleted,
    completionPct:
      totalSent === 0 ? 0 : Math.round((totalCompleted / totalSent) * 100),
  };
}
