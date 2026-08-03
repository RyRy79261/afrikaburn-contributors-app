import { describe, it, expect } from "vitest";
import { resolveAudience, type AudienceContext } from "../audience";
import type { AudienceSpec } from "@quagga/types";

// --- Fixture world -------------------------------------------------------
// One org, two theme camps, one MV, one artwork. Users are named by role so
// assertions read plainly. Membership ids are `m:<user>:<group>`.

const ORG = "g-org";
const CAMP_REG = "g-camp-registered"; // approved registration
const CAMP_UNREG = "g-camp-unregistered"; // draft registration
const MV = "g-mv";
const ART = "g-art";
const EDITION = "e-2027";
const OTHER_EDITION = "e-2026";

function membership(
  userId: string,
  groupId: string,
  role: AudienceContext["memberships"][number]["role"],
) {
  return { membershipId: `m:${userId}:${groupId}`, userId, groupId, role };
}

function baseCtx(): AudienceContext {
  return {
    editionId: EDITION,
    orgGroupId: ORG,
    groups: [
      { id: ORG, kind: "org" },
      { id: CAMP_REG, kind: "theme_camp" },
      { id: CAMP_UNREG, kind: "theme_camp" },
      { id: MV, kind: "mutant_vehicle" },
      { id: ART, kind: "artwork" },
    ],
    memberships: [
      membership("staff", ORG, "org_staff"),
      membership("god", ORG, "god"),
      membership("orgMember", ORG, "member"),

      membership("campRegLead", CAMP_REG, "lead"),
      membership("campRegAdmin", CAMP_REG, "admin"),
      membership("campRegMember", CAMP_REG, "member"),

      membership("campUnregLead", CAMP_UNREG, "lead"),

      membership("mvLead", MV, "lead"),
      membership("mvMember", MV, "member"),

      membership("artLead", ART, "admin"),
    ],
    registrations: [
      {
        groupId: CAMP_REG,
        editionId: EDITION,
        status: "approved",
        grantsInterest: null,
      },
      {
        groupId: CAMP_UNREG,
        editionId: EDITION,
        status: "draft",
        grantsInterest: null,
      },
      {
        groupId: MV,
        editionId: EDITION,
        status: "submitted",
        grantsInterest: true,
      },
      {
        groupId: ART,
        editionId: EDITION,
        status: "approved",
        grantsInterest: false,
      },
    ],
    bios: [
      { userId: "campRegLead", editionId: EDITION },
      { userId: "orgMember", editionId: EDITION },
      { userId: "staleBurner", editionId: OTHER_EDITION },
    ],
    roleAssignments: [],
    // Two suppliers with claimed accounts; accountless catalog rows are absent
    // by construction (the caller filters `user_id IS NULL` out).
    suppliers: [{ userId: "supplierA" }, { userId: "supplierB" }],
  };
}

describe("resolveAudience — org internal", () => {
  it("returns every org-group member regardless of role", () => {
    const spec: AudienceSpec = { kind: "org_internal" };
    expect(resolveAudience(spec, baseCtx())).toEqual([
      "god",
      "orgMember",
      "staff",
    ]);
  });
});

describe("resolveAudience — org outbound selectors", () => {
  it("all_current_burners = bios for the active edition only", () => {
    const spec: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["all_current_burners"],
    };
    // staleBurner is on a different edition and must be excluded.
    expect(resolveAudience(spec, baseCtx())).toEqual(["campRegLead", "orgMember"]);
  });

  it("camp_leads = leads/admins of every theme_camp", () => {
    const spec: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["camp_leads"],
    };
    expect(resolveAudience(spec, baseCtx())).toEqual([
      "campRegAdmin",
      "campRegLead",
      "campUnregLead",
    ]);
  });

  it("registered_camp_leads = leads/admins of approved camps only", () => {
    const spec: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["registered_camp_leads"],
    };
    // campUnregLead excluded (draft); members never included.
    expect(resolveAudience(spec, baseCtx())).toEqual([
      "campRegAdmin",
      "campRegLead",
    ]);
  });

  it("mv_leads = leads/admins of mutant_vehicle groups", () => {
    const spec: AudienceSpec = { kind: "org_outbound", selectors: ["mv_leads"] };
    expect(resolveAudience(spec, baseCtx())).toEqual(["mvLead"]);
  });

  it("mv_grant_requesters = leads of MV groups with grants_interest true", () => {
    const spec: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["mv_grant_requesters"],
    };
    expect(resolveAudience(spec, baseCtx())).toEqual(["mvLead"]);
  });

  it("art_leads = leads/admins of artwork groups", () => {
    const spec: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["art_leads"],
    };
    expect(resolveAudience(spec, baseCtx())).toEqual(["artLead"]);
  });

  it("art_grant_requesters is empty when no artwork wants a grant", () => {
    // ART's registration has grantsInterest=false.
    const spec: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["art_grant_requesters"],
    };
    expect(resolveAudience(spec, baseCtx())).toEqual([]);
  });

  it("grant-requester audiences are empty when no such registrations exist", () => {
    const ctx = baseCtx();
    ctx.registrations = ctx.registrations.map((r) => ({
      ...r,
      grantsInterest: null,
    }));
    const spec: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["mv_grant_requesters", "art_grant_requesters"],
    };
    expect(resolveAudience(spec, ctx)).toEqual([]);
  });

  it("dedupes across multiple selectors", () => {
    const spec: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["camp_leads", "registered_camp_leads"],
    };
    // campRegLead/campRegAdmin appear in both selectors — once each in output.
    expect(resolveAudience(spec, baseCtx())).toEqual([
      "campRegAdmin",
      "campRegLead",
      "campUnregLead",
    ]);
  });
});

describe("resolveAudience — org suppliers", () => {
  it("returns every account-linked supplier, sorted + de-duplicated", () => {
    const spec: AudienceSpec = { kind: "org_suppliers" };
    expect(resolveAudience(spec, baseCtx())).toEqual(["supplierA", "supplierB"]);
  });

  it("resolves to nobody when no supplier has claimed an account", () => {
    const ctx = baseCtx();
    ctx.suppliers = [];
    const spec: AudienceSpec = { kind: "org_suppliers" };
    expect(resolveAudience(spec, ctx)).toEqual([]);
  });

  it("treats an absent suppliers set as empty (optional field)", () => {
    const ctx = baseCtx();
    delete ctx.suppliers;
    const spec: AudienceSpec = { kind: "org_suppliers" };
    expect(resolveAudience(spec, ctx)).toEqual([]);
  });

  it("ADVERSARIAL: reaches ONLY suppliers — no burner, lead, officer or org member leaks in", () => {
    const spec: AudienceSpec = { kind: "org_suppliers" };
    const result = resolveAudience(spec, baseCtx());
    // Every non-supplier principal in the fixture must be absent.
    for (const outsider of [
      "god",
      "staff",
      "orgMember",
      "campRegLead",
      "campRegAdmin",
      "campRegMember",
      "campUnregLead",
      "mvLead",
      "mvMember",
      "artLead",
    ]) {
      expect(result).not.toContain(outsider);
    }
    expect(result).toEqual(["supplierA", "supplierB"]);
  });

  it("de-duplicates a supplier that appears twice (multi-edition claim rows)", () => {
    const ctx = baseCtx();
    ctx.suppliers = [
      { userId: "supplierA" },
      { userId: "supplierA" },
      { userId: "supplierB" },
    ];
    const spec: AudienceSpec = { kind: "org_suppliers" };
    expect(resolveAudience(spec, ctx)).toEqual(["supplierA", "supplierB"]);
  });
});

describe("resolveAudience — project", () => {
  it("everyone = all members of the project group", () => {
    const spec: AudienceSpec = {
      kind: "project",
      groupId: CAMP_REG,
      mode: "everyone",
      roleIds: [],
    };
    expect(resolveAudience(spec, baseCtx())).toEqual([
      "campRegAdmin",
      "campRegLead",
      "campRegMember",
    ]);
  });

  it("roles = members holding any wanted custom role, deduped", () => {
    const ctx = baseCtx();
    ctx.roleAssignments = [
      { membershipId: "m:campRegLead:g-camp-registered", projectRoleId: "r-captain" },
      { membershipId: "m:campRegMember:g-camp-registered", projectRoleId: "r-teamlead" },
      // multi-role member: campRegLead also a team lead — must not duplicate.
      { membershipId: "m:campRegLead:g-camp-registered", projectRoleId: "r-teamlead" },
      // assignment for a different group's membership — must be ignored.
      { membershipId: "m:mvLead:g-mv", projectRoleId: "r-captain" },
    ];
    const spec: AudienceSpec = {
      kind: "project",
      groupId: CAMP_REG,
      mode: "roles",
      roleIds: ["r-captain", "r-teamlead"],
    };
    expect(resolveAudience(spec, ctx)).toEqual(["campRegLead", "campRegMember"]);
  });

  it("roles mode with empty roleIds resolves to nobody", () => {
    const spec: AudienceSpec = {
      kind: "project",
      groupId: CAMP_REG,
      mode: "roles",
      roleIds: [],
    };
    expect(resolveAudience(spec, baseCtx())).toEqual([]);
  });

  it("only wanted roles count — an unlisted role is excluded", () => {
    const ctx = baseCtx();
    ctx.roleAssignments = [
      { membershipId: "m:campRegMember:g-camp-registered", projectRoleId: "r-other" },
    ];
    const spec: AudienceSpec = {
      kind: "project",
      groupId: CAMP_REG,
      mode: "roles",
      roleIds: ["r-captain"],
    };
    expect(resolveAudience(spec, ctx)).toEqual([]);
  });
});

describe("resolveAudience — baseline derivation", () => {
  it("targeting the baseline role resolves to the whole camp (derived, not stored)", () => {
    const ctx = baseCtx();
    ctx.projectRoles = [
      { id: "r-baseline", groupId: CAMP_REG, kind: "baseline", officerKey: null },
      { id: "r-captain", groupId: CAMP_REG, kind: "captain", officerKey: null },
    ];
    // No roleAssignments for baseline exist — it must still be everyone.
    const spec: AudienceSpec = {
      kind: "project",
      groupId: CAMP_REG,
      mode: "roles",
      roleIds: ["r-baseline"],
    };
    expect(resolveAudience(spec, ctx)).toEqual([
      "campRegAdmin",
      "campRegLead",
      "campRegMember",
    ]);
  });
});

describe("resolveAudience — org officer", () => {
  function officerCtx(): AudienceContext {
    const ctx = baseCtx();
    ctx.projectRoles = [
      // Sound Officer role materialised in the REGISTERED camp…
      { id: "so-reg", groupId: CAMP_REG, kind: "officer", officerKey: "sound_officer" },
      // …and in the UNREGISTERED (draft) camp — must never resolve.
      { id: "so-unreg", groupId: CAMP_UNREG, kind: "officer", officerKey: "sound_officer" },
      { id: "lnt-reg", groupId: CAMP_REG, kind: "officer", officerKey: "lnt_officer" },
    ];
    ctx.roleAssignments = [
      // accepted sound officer in the registered camp → resolves
      {
        membershipId: "m:campRegMember:g-camp-registered",
        projectRoleId: "so-reg",
        consent: "accepted",
      },
      // pending sound officer (registered camp) → excluded until accepted
      {
        membershipId: "m:campRegAdmin:g-camp-registered",
        projectRoleId: "so-reg",
        consent: "pending",
      },
      // accepted sound officer but in an UNREGISTERED camp → excluded
      {
        membershipId: "m:campUnregLead:g-camp-unregistered",
        projectRoleId: "so-unreg",
        consent: "accepted",
      },
      // accepted LNT officer, registered camp
      {
        membershipId: "m:campRegLead:g-camp-registered",
        projectRoleId: "lnt-reg",
        consent: "accepted",
      },
    ];
    return ctx;
  }

  it("resolves accepted officers of the wanted key in registered camps only", () => {
    const spec: AudienceSpec = {
      kind: "org_officer",
      officerKeys: ["sound_officer"],
    };
    expect(resolveAudience(spec, officerCtx())).toEqual(["campRegMember"]);
  });

  it("resolves across multiple officer keys, deduped + sorted", () => {
    const spec: AudienceSpec = {
      kind: "org_officer",
      officerKeys: ["sound_officer", "lnt_officer"],
    };
    expect(resolveAudience(spec, officerCtx())).toEqual([
      "campRegLead",
      "campRegMember",
    ]);
  });

  it("empty when no accepted officers of that key exist in a registered camp", () => {
    const spec: AudienceSpec = {
      kind: "org_officer",
      officerKeys: ["fire_safety_officer"],
    };
    expect(resolveAudience(spec, officerCtx())).toEqual([]);
  });
});

// `leads` mode (roadmap M4-20). Form 2 asks a camp how big it is, where it wants
// to be and what noise it will make — questions only someone who can answer FOR
// the camp should answer. `lead`/`admin` are structural: they are the membership
// row rather than a grant on top of it, so `roles` mode has no id to name them by.
describe("project audience — leads mode", () => {
  const ctx = {
    memberships: [
      { membershipId: "m1", userId: "u-lead", groupId: "g1", role: "lead" as const },
      { membershipId: "m2", userId: "u-admin", groupId: "g1", role: "admin" as const },
      { membershipId: "m3", userId: "u-member", groupId: "g1", role: "member" as const },
      // Another camp's lead — the control. A per-camp send must never widen.
      { membershipId: "m4", userId: "u-other", groupId: "g2", role: "lead" as const },
    ],
    groups: [],
    registrations: [],
    bios: [],
    roleAssignments: [],
    editionId: "e1",
    orgGroupId: "org1",
  };

  it("reaches lead and admin, and nobody else", () => {
    const got = resolveAudience(
      { kind: "project", groupId: "g1", mode: "leads", roleIds: [] },
      ctx,
    );
    expect([...got].sort()).toEqual(["u-admin", "u-lead"]);
  });

  it("does not reach a plain member of the same camp", () => {
    const got = resolveAudience(
      { kind: "project", groupId: "g1", mode: "leads", roleIds: [] },
      ctx,
    );
    expect(got).not.toContain("u-member");
  });

  it("does not leak into another camp", () => {
    // The failure that matters: one camp's Form 2 reaching a different camp's
    // lead would put one camp's business in another camp's inbox.
    const got = resolveAudience(
      { kind: "project", groupId: "g1", mode: "leads", roleIds: [] },
      ctx,
    );
    expect(got).not.toContain("u-other");
  });

  it("ignores roleIds — structural roles are not grants", () => {
    const got = resolveAudience(
      { kind: "project", groupId: "g1", mode: "leads", roleIds: ["some-role"] },
      ctx,
    );
    expect([...got].sort()).toEqual(["u-admin", "u-lead"]);
  });
});
