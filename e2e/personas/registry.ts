// e2e/personas/registry.ts — THE single place the authz matrix lives.
//
// The negative-path suite (M3-30) reads from this file rather than scattering
// "who can't do what" across a dozen specs. Each capability is phrased as a
// GUARD to prove: the assertion is that the server-side guard REFUSES, not that
// a link is hidden (a hidden link is not a security boundary — AGENTS.md rule 7,
// spec §7). "refuses" here means: the protected surface returns a refusal state
// (403/redirect-to-sign-in/"not found"/"can't do that"), NOT merely a missing nav item.
//
// TWO TIERS OF PROOF — stated honestly so the "delete-the-guard, watch-it-go-red"
// guarantee (roadmap M3-30 adversarial pass) is claimed only where it truly holds:
//
//  (A) E2E-provable refusals. The protected surface itself is reachable by URL,
//      so navigating to it as the wrong persona yields an OBSERVABLE server
//      refusal (redirect / 404 / staff-wall / data-never-sent). Deleting the
//      server guard makes the corresponding negative spec go red. This is every
//      capability in this registry: reachOrgConsole, reviewRegistration,
//      discover/openFreeCamp, readOtherCampRegistration, seeOrgSupplierNotes,
//      seeHardLockedFieldPublicly, reachGodOnlySurface (a non-org account is
//      walled off before the surface renders).
//
//  (B) Mutations with NO client entry point for the wrong persona. A few "cannot"s
//      are server actions the wrong persona has no reachable trigger for at all —
//      the control is server-OMITTED and the action id is Next-hashed, so there is
//      no build-stable way to POST it from Playwright and be refused. For these
//      the E2E proves only that NO UI path exposes the action, while the pure
//      server refusal is a @quagga/core PREDICATE test in the SAME `turbo run
//      test` gate (AGENTS.md rule 7: authz predicates live in core). Deleting the
//      predicate turns THAT test red. The cases and their guarding predicate test
//      (all verified present, all in the `turbo run test` gate):
//        - god is granted ONLY for a VERIFIED GOD_EMAILS address — the root of the
//          escalation ceiling; setOrgStaffRole is then god-only at the action layer
//          (requireOrgSession({god:true})).
//          ......... packages/core/src/__tests__/god-emails.test.ts
//        - a camp cannot rename/recolour/delete an OFFICER role
//          (canRenameRoleKind/canDeleteRoleKind("officer") === false).
//          ......... packages/core/src/__tests__/project-roles.test.ts
//        - a plain member (baseline role) holds NO project permissions, so cannot
//          mint an invite or manage roles (PROJECT_ADMIN_ROLES / hasProjectPermission).
//          ......... packages/core/src/__tests__/project-permissions.test.ts
//                    + project-roles.test.ts (Burner seeded with none)
//      The affected specs each carry a matching HONEST SCOPE NOTE pointing here.
//
// Product laws this encodes (AGENTS.md "Product laws" + docs/*-spec.md):
//   - Free (unregistered) camps are undiscoverable to strangers — directory,
//     profiles, type-aheads all enforce it.
//   - Privacy hard-locks: phone / emergency contacts / ID are NEVER on any public
//     surface, regardless of flags. The ONLY path sharing a phone with the org is
//     an ACCEPTED officer registration.
//   - Structural roles (lead/admin) hold every project permission irrevocably.
//   - God is granted ONLY via GOD_EMAILS + a VERIFIED email; never self-service.
//   - Suppliers never see org-internal supplier notes.

import type { AppName } from "../lib/env";

/** The personas the suite can instantiate. */
export type PersonaKind =
  | "anonymous" // no session
  | "burner" // signed-up participant, onboarded
  | "camp_lead" // burner who created a camp (structural lead)
  | "camp_member" // burner who joined a camp via invite (no privileges granted)
  | "other_camp_lead" // lead of a DIFFERENT camp (cross-tenant isolation)
  | "supplier" // supplier-portal account
  | "org_staff" // org account WITHOUT god (elevated to org_staff, not god)
  | "god"; // GOD_EMAILS + verified — full org console

/** A capability the persona either HAS (allowed) or MUST BE REFUSED (forbidden). */
export interface Capability {
  /** Stable id used by specs to select the guard to prove. */
  id: string;
  /** Which app the surface lives on. */
  app: AppName;
  /** Human description of the action. */
  action: string;
  /**
   * For a FORBIDDEN capability: how the guard should refuse. The negative-path
   * spec asserts this observable refusal, and (per the adversarial pass) a
   * reviewer deletes the server guard to confirm the spec then goes red.
   */
  refusalHint?: string;
}

export interface PersonaSpec {
  kind: PersonaKind;
  summary: string;
  /** Things this persona is allowed to do (happy-path coverage lives elsewhere). */
  allowed: Capability[];
  /** Things this persona MUST be refused — the negative-path suite iterates these. */
  forbidden: Capability[];
}

// --- Capability catalogue (referenced by id from specs) --------------------

const C = {
  reachOrgConsole: {
    id: "reach-org-console",
    app: "org",
    action: "load the organiser console overview",
    refusalHint:
      "resolveOrgSession → 'forbidden'/'unauthenticated' state, console not rendered",
  },
  reviewRegistration: {
    id: "review-registration",
    app: "org",
    action: "open a registration in the queue and request changes / approve",
    refusalHint: "requireOrgSession refuses; action rejects a non-org actor",
  },
  discoverFreeCamp: {
    id: "discover-free-camp",
    app: "web",
    action: "find a free (unregistered) camp in the directory / type-ahead",
    refusalHint:
      "groups-store free-camp filter excludes it from stranger results",
  },
  openFreeCampPage: {
    id: "open-free-camp-page",
    app: "web",
    action: "open a free camp's page directly by slug as a non-member",
    refusalHint:
      "camp page: `!camp.registered && !camp.viewerRole` → notFound()/redirect",
  },
  readOtherCampRegistration: {
    id: "read-other-camp-registration",
    app: "web",
    action: "read another camp's registration submission",
    refusalHint:
      "getCurrentCampUser/enforceGate scopes to the viewer's own camp membership",
  },
  seeOrgSupplierNotes: {
    id: "see-org-supplier-notes",
    app: "suppliers",
    action: "read org-internal supplier notes from the portal",
    refusalHint:
      "supplier session/onboarding query never SELECTs `notes` (privacy-wire)",
  },
  seeHardLockedFieldPublicly: {
    id: "see-hard-locked-field-public",
    app: "web",
    action:
      "see a hard-locked field (phone, emergency contact, ID) on any public surface",
    refusalHint:
      "bio public projection strips HARD_LOCKED_PRIVATE_FIELDS regardless of flags",
  },
  reachGodOnlySurface: {
    id: "reach-god-only-surface",
    app: "org",
    action: "reach a god-only surface (e.g. accounts role management)",
    refusalHint: "requireOrgSession({ god: true }) throws for org_staff",
  },
  createCamp: { id: "create-camp", app: "web", action: "create a camp" },
  registerOwnCamp: {
    id: "register-own-camp",
    app: "web",
    action: "submit the six-section registration for their own theme camp",
  },
  inviteToOwnCamp: {
    id: "invite-to-own-camp",
    app: "web",
    action: "create an invite link for their camp",
  },
  completeBio: {
    id: "complete-bio",
    app: "web",
    action: "complete their Burner Bio",
  },
  onboardSupplier: {
    id: "onboard-supplier",
    app: "suppliers",
    action: "walk supplier onboarding + acknowledge a document",
  },
} as const satisfies Record<string, Capability>;

// --- The registry ----------------------------------------------------------

export const PERSONAS: Record<PersonaKind, PersonaSpec> = {
  anonymous: {
    kind: "anonymous",
    summary: "No session. Sees only public surfaces.",
    allowed: [],
    forbidden: [
      C.reachOrgConsole,
      C.discoverFreeCamp,
      C.openFreeCampPage,
      C.seeHardLockedFieldPublicly,
      C.reviewRegistration,
    ],
  },
  burner: {
    kind: "burner",
    summary: "Onboarded participant. Can create/join camps; not org staff.",
    allowed: [C.completeBio, C.createCamp, C.inviteToOwnCamp],
    forbidden: [
      C.reachOrgConsole,
      C.reviewRegistration,
      C.reachGodOnlySurface,
      C.discoverFreeCamp, // a stranger burner still can't discover someone else's free camp
      C.seeHardLockedFieldPublicly,
    ],
  },
  camp_lead: {
    kind: "camp_lead",
    summary:
      "Burner who created a camp — structural lead, all project permissions irrevocably.",
    allowed: [C.createCamp, C.registerOwnCamp, C.inviteToOwnCamp],
    forbidden: [
      C.reachOrgConsole,
      C.readOtherCampRegistration,
      C.reachGodOnlySurface,
    ],
  },
  camp_member: {
    kind: "camp_member",
    summary:
      "Joined a camp via invite; holds no custom privileges by default (default-deny).",
    allowed: [C.completeBio],
    forbidden: [
      C.reachOrgConsole,
      C.readOtherCampRegistration,
      C.reachGodOnlySurface,
    ],
  },
  other_camp_lead: {
    kind: "other_camp_lead",
    summary: "Lead of a DIFFERENT camp — used to prove cross-tenant isolation.",
    allowed: [C.createCamp, C.registerOwnCamp],
    forbidden: [C.readOtherCampRegistration, C.reachOrgConsole],
  },
  supplier: {
    kind: "supplier",
    summary:
      "Supplier-portal account. Onboarding + documents; never org-internal data.",
    allowed: [C.onboardSupplier],
    forbidden: [C.seeOrgSupplierNotes, C.reachOrgConsole, C.reviewRegistration],
  },
  org_staff: {
    kind: "org_staff",
    summary:
      "Org account WITHOUT god. Can review; cannot reach god-only surfaces.",
    allowed: [C.reachOrgConsole, C.reviewRegistration],
    forbidden: [C.reachGodOnlySurface],
  },
  god: {
    kind: "god",
    summary:
      "GOD_EMAILS + verified email. Full org console incl. role management.",
    allowed: [C.reachOrgConsole, C.reviewRegistration, C.reachGodOnlySurface],
    forbidden: [],
  },
};

/** Every distinct capability, for a completeness meta-test. */
export const ALL_CAPABILITIES: Capability[] = Object.values(C);

/** Look up a persona's spec. */
export function persona(kind: PersonaKind): PersonaSpec {
  return PERSONAS[kind];
}

/** Iterate every (persona, forbidden capability) pair — the negative-path source. */
export function forbiddenMatrix(): Array<{
  kind: PersonaKind;
  capability: Capability;
}> {
  const rows: Array<{ kind: PersonaKind; capability: Capability }> = [];
  for (const spec of Object.values(PERSONAS)) {
    for (const capability of spec.forbidden) {
      rows.push({ kind: spec.kind, capability });
    }
  }
  return rows;
}

/**
 * Hard-locked private fields — mirrors packages/core HARD_LOCKED_PRIVATE_FIELDS
 * (source of truth: packages/core/src/privacy.ts). Kept here as a literal so the
 * harness stays pointable at a remote deployment without the monorepo, but any
 * drift is a bug: the PII-projection guard (M3-12) pins the canonical list.
 */
export const HARD_LOCKED_PRIVATE_FIELDS = [
  "saId",
  "passport",
  "phone",
  "onsiteContactName",
  "onsiteContactPhone",
  "offsiteContactName",
  "offsiteContactPhone",
  "medical",
] as const;
