import { describe, it, expect } from "vitest";
import type { RegistrationStatus } from "@quagga/types";
import {
  deriveBurnerStats,
  deriveCampStats,
  deriveMutantVehicleStats,
  deriveArtworkStats,
  deriveStatusBoardKpis,
  deriveRegistrationFunnel,
  emptyRegistrationFunnel,
  deriveOfficerCoverage,
  deriveSupplierOnboardingRollup,
  deriveSupplierStandingRollup,
  deriveQuestionnaireCompletion,
  isRegisteredStatus,
  isInReviewStatus,
  REGISTRATION_STATUS_ORDER,
  type ProjectStatInput,
  type CampOfficerInput,
} from "../org-stats";

// A fixture that MIRRORS the seed's theme camps (packages/db/src/seed.ts): one
// approved (Mad Hatters), the rest in-flight / withdrawn / free. Expected
// numbers below are DERIVED from this array — never hardcoded — so the test
// stays honest if the seed set changes.
const SEED_CAMPS: ProjectStatInput[] = [
  { kind: "theme_camp", status: "approved", grantsInterest: null }, // Mad Hatters
  { kind: "theme_camp", status: "under_review", grantsInterest: null }, // Camp 404
  { kind: "theme_camp", status: "draft", grantsInterest: null }, // Salt & Ember
  { kind: "theme_camp", status: "submitted", grantsInterest: null }, // Tinkerers
  { kind: "theme_camp", status: "changes_requested", grantsInterest: null }, // Velvet Mirage
  { kind: "theme_camp", status: "withdrawn", grantsInterest: null }, // Quiet Static
  { kind: "theme_camp", status: null, grantsInterest: null }, // Borrowed Horizon (free)
  { kind: "theme_camp", status: null, grantsInterest: null }, // Windrow (free)
];

describe("status predicates", () => {
  it("only `approved` is registered", () => {
    expect(isRegisteredStatus("approved")).toBe(true);
    for (const s of REGISTRATION_STATUS_ORDER.filter((x) => x !== "approved")) {
      expect(isRegisteredStatus(s)).toBe(false);
    }
    expect(isRegisteredStatus(null)).toBe(false);
  });

  it("in-review is submitted/under_review/changes_requested", () => {
    expect(isInReviewStatus("submitted")).toBe(true);
    expect(isInReviewStatus("under_review")).toBe(true);
    expect(isInReviewStatus("changes_requested")).toBe(true);
    expect(isInReviewStatus("approved")).toBe(false);
    expect(isInReviewStatus("draft")).toBe(false);
    expect(isInReviewStatus(null)).toBe(false);
  });
});

describe("deriveBurnerStats", () => {
  it("counts complete bios and the whole-percent rate", () => {
    const stats = deriveBurnerStats([
      { completedAt: new Date() },
      { completedAt: new Date() },
      { completedAt: null },
      { completedAt: null },
    ]);
    expect(stats).toEqual({ total: 4, complete: 2, completePct: 50 });
  });

  it("is all-zero for no bios (no divide-by-zero)", () => {
    expect(deriveBurnerStats([])).toEqual({
      total: 0,
      complete: 0,
      completePct: 0,
    });
  });
});

describe("deriveCampStats — seed consistency", () => {
  it("splits registered vs free with total = registered + free", () => {
    const stats = deriveCampStats(SEED_CAMPS);
    // Derive expectations from the fixture itself (28+19-style invariant).
    const camps = SEED_CAMPS.filter((c) => c.kind === "theme_camp");
    const expectedRegistered = camps.filter(
      (c) => c.status === "approved",
    ).length;
    expect(stats.total).toBe(camps.length);
    expect(stats.registered).toBe(expectedRegistered);
    expect(stats.free).toBe(camps.length - expectedRegistered);
    expect(stats.registered + stats.free).toBe(stats.total);
  });

  it("ignores non-camp kinds", () => {
    const mixed: ProjectStatInput[] = [
      ...SEED_CAMPS,
      { kind: "artwork", status: "approved", grantsInterest: true },
      { kind: "mutant_vehicle", status: "approved", grantsInterest: null },
    ];
    expect(deriveCampStats(mixed).total).toBe(
      SEED_CAMPS.filter((c) => c.kind === "theme_camp").length,
    );
  });
});

describe("deriveMutantVehicleStats / deriveArtworkStats", () => {
  const projects: ProjectStatInput[] = [
    { kind: "mutant_vehicle", status: "approved", grantsInterest: null },
    { kind: "mutant_vehicle", status: "under_review", grantsInterest: null },
    { kind: "mutant_vehicle", status: null, grantsInterest: null },
    { kind: "artwork", status: "approved", grantsInterest: true },
    { kind: "artwork", status: "draft", grantsInterest: true },
    { kind: "artwork", status: null, grantsInterest: false },
  ];

  it("MV: total + registered/in-review", () => {
    expect(deriveMutantVehicleStats(projects)).toEqual({
      total: 3,
      registered: 1,
      inReview: 1,
    });
  });

  it("artworks: total + registered + grant requests", () => {
    expect(deriveArtworkStats(projects)).toEqual({
      total: 3,
      registered: 1,
      grantRequests: 2,
    });
  });
});

describe("deriveStatusBoardKpis", () => {
  it("assembles the four headline cards from one pass", () => {
    const kpis = deriveStatusBoardKpis({
      bios: [{ completedAt: new Date() }, { completedAt: null }],
      projects: SEED_CAMPS,
    });
    expect(kpis.burners.total).toBe(2);
    expect(kpis.camps.total + 0).toBe(SEED_CAMPS.length);
    expect(kpis.mutantVehicles.total).toBe(0);
    expect(kpis.artworks.total).toBe(0);
  });
});

describe("deriveRegistrationFunnel", () => {
  it("tallies every status and totals to the input length", () => {
    const statuses = SEED_CAMPS.map((c) => c.status).filter(
      (s): s is RegistrationStatus => s !== null,
    );
    const funnel = deriveRegistrationFunnel(statuses);
    expect(funnel.total).toBe(statuses.length);
    // Sum of the buckets equals the total (invariant).
    const summed = Object.values(funnel.byStatus).reduce((a, b) => a + b, 0);
    expect(summed).toBe(statuses.length);
    expect(funnel.byStatus.approved).toBe(
      statuses.filter((s) => s === "approved").length,
    );
  });

  it("empty funnel has every status at 0", () => {
    const empty = emptyRegistrationFunnel();
    for (const s of REGISTRATION_STATUS_ORDER) expect(empty[s]).toBe(0);
    expect(deriveRegistrationFunnel([]).total).toBe(0);
  });
});

describe("deriveOfficerCoverage", () => {
  const noFire = { hasGenerators: false, hasOpenFlame: false, hasFuelStorage: false };

  it("counts only applicable camps and reports fully-officered", () => {
    const camps: CampOfficerInput[] = [
      // Registered, loud (sound ≥2) ⇒ requires lnt + fire + sound; fully covered.
      {
        isRegisteredOrInFlight: true,
        triggers: { soundLevel: 2, ...noFire },
        assignedKeys: ["lnt_officer", "fire_safety_officer", "sound_officer"],
      },
      // Registered, quiet ⇒ requires lnt + fire; missing fire.
      {
        isRegisteredOrInFlight: true,
        triggers: { soundLevel: 0, ...noFire },
        assignedKeys: ["lnt_officer"],
      },
      // Free camp ⇒ requirements don't apply, excluded from the coverage denom.
      {
        isRegisteredOrInFlight: false,
        triggers: { soundLevel: 4, ...noFire },
        assignedKeys: [],
      },
    ];
    const coverage = deriveOfficerCoverage(camps);
    expect(coverage.applicableCamps).toBe(2);
    expect(coverage.fullyOfficered).toBe(1);
    expect(coverage.campsWithGaps).toBe(1);
    expect(coverage.outstandingSlots).toBe(1); // the missing fire_safety_officer
  });

  it("is all-zero for no applicable camps", () => {
    expect(
      deriveOfficerCoverage([
        {
          isRegisteredOrInFlight: false,
          triggers: { soundLevel: 0, ...noFire },
          assignedKeys: [],
        },
      ]),
    ).toEqual({
      applicableCamps: 0,
      fullyOfficered: 0,
      campsWithGaps: 0,
      outstandingSlots: 0,
    });
  });
});

describe("deriveSupplierOnboardingRollup", () => {
  it("buckets suppliers by onboarding progress; total is preserved", () => {
    const rollup = deriveSupplierOnboardingRollup([
      // Fully onboarded (all 7 steps completed).
      {
        steps: {
          registration_form: "completed",
          agreement_signed: "completed",
          deposit_paid: "completed",
          inventory_submitted: "completed",
          crew_details_submitted: "completed",
          briefing_attended: "completed",
          registration_fee_paid: "completed",
        },
      },
      // In progress (some completed).
      { steps: { registration_form: "completed" } },
      // In progress (awaiting confirmation, none completed).
      { steps: { inventory_submitted: "awaiting_confirmation" } },
      // Not started (empty / absent map).
      { steps: {} },
      { steps: null },
    ]);
    expect(rollup.total).toBe(5);
    expect(rollup.onboarded).toBe(1);
    expect(rollup.inProgress).toBe(2);
    expect(rollup.notStarted).toBe(2);
    expect(rollup.onboarded + rollup.inProgress + rollup.notStarted).toBe(
      rollup.total,
    );
  });
});

describe("deriveSupplierStandingRollup", () => {
  it("counts each standing, every standing present at 0", () => {
    const rollup = deriveSupplierStandingRollup([
      { standing: "good" },
      { standing: "good" },
      { standing: "suspended" },
    ]);
    expect(rollup.good).toBe(2);
    expect(rollup.suspended).toBe(1);
    expect(rollup.watch).toBe(0);
    expect(rollup.diligent_first_timer).toBe(0);
  });
});

describe("deriveQuestionnaireCompletion", () => {
  it("computes per-send + overall completion rates", () => {
    const rollup = deriveQuestionnaireCompletion([
      {
        activationId: "a1",
        title: "Safety check-in",
        actions: [
          { status: "completed" },
          { status: "pending" },
        ],
      },
      {
        activationId: "a2",
        title: "Crew briefing",
        actions: [{ status: "pending" }],
      },
    ]);
    expect(rollup.totalSent).toBe(3);
    expect(rollup.totalCompleted).toBe(1);
    expect(rollup.completionPct).toBe(33);
    expect(rollup.sends[0]).toMatchObject({
      activationId: "a1",
      sent: 2,
      completed: 1,
      pending: 1,
      completionPct: 50,
    });
    expect(rollup.sends[1]).toMatchObject({ sent: 1, completed: 0, completionPct: 0 });
  });

  it("is all-zero for no sends", () => {
    expect(deriveQuestionnaireCompletion([])).toEqual({
      sends: [],
      totalSent: 0,
      totalCompleted: 0,
      completionPct: 0,
    });
  });
});
