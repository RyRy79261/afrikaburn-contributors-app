import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { dbMock, uniqueViolation } from "@/test/db-mock";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const {
  ensureDefaultRoles,
  listRoles,
  createRole,
  renameRole,
  setRoleAppearance,
  setRolePermissions,
  removeRole,
  setMemberRoles,
  assignOfficer,
  unassignOfficer,
  respondToOfficer,
  pendingOfficerConsents,
  getMemberPermissions,
  getBaselineRoleId,
  getRoleAssignments,
  getOfficerStatus,
  membershipIdsWithRoles,
} = await import("../roles-store");

const GROUP = "11111111-1111-1111-1111-111111111111";
const EDITION = "eeeeeeee-0000-0000-0000-000000000000";
const USER = "aaaaaaaa-0000-0000-0000-000000000001";
const MEMBERSHIP = "mmmmmmmm-0000-0000-0000-000000000001";

const BASELINE_ID = "role-baseline";
const TEAM_LEAD_ID = "role-team-lead";
const CAPTAIN_ID = "role-captain";
const CUSTOM_ID = "role-custom";
const SAFETY_BARON_ID = "role-safety-baron";

interface RoleFixture {
  id: string;
  name: string;
  isDefault: boolean;
  sort: number;
  kind: string;
  color: string;
  emoji: string | null;
  permissions: Record<string, unknown>;
  officerKey: string | null;
}

function role(overrides: Partial<RoleFixture> = {}): RoleFixture {
  return {
    id: CUSTOM_ID,
    name: "Kitchen crew",
    isDefault: false,
    sort: 5,
    kind: "custom",
    color: "neutral",
    emoji: null,
    permissions: {},
    officerKey: null,
    ...overrides,
  };
}

const BASELINE = role({
  id: BASELINE_ID,
  name: "Burner",
  kind: "baseline",
  sort: 0,
  isDefault: true,
  permissions: { view_member_details: true },
});
const TEAM_LEAD = role({
  id: TEAM_LEAD_ID,
  name: "Team lead",
  kind: "default",
  sort: 1,
  isDefault: true,
  permissions: { view_member_details: true },
});
const CAPTAIN = role({
  id: CAPTAIN_ID,
  name: "Captain",
  kind: "captain",
  sort: 2,
  isDefault: true,
});
const SAFETY_BARON = role({
  id: SAFETY_BARON_ID,
  name: "Safety Baron",
  kind: "officer",
  sort: 100,
  isDefault: true,
  emoji: "🔥",
  officerKey: "fire_safety_officer",
});

/**
 * `listRoles` runs `ensureDefaultRoles` first, so this queues two results: the
 * existence PROBE, then the listing itself.
 *
 * The probe always carries an officer row even when the listing under test does
 * not, because the probe's only job is to decide whether seeding runs — and a
 * test about role names has nothing to say about the officer catalog being
 * materialised. The seeding branch has its own tests above.
 */
function queueRoles(roles: RoleFixture[] = [BASELINE, TEAM_LEAD, SAFETY_BARON]) {
  const probe = roles.map((r) => ({
    id: r.id,
    kind: r.kind,
    officerKey: r.officerKey,
  }));
  if (!roles.some((r) => r.kind === "officer")) {
    probe.push({
      id: SAFETY_BARON_ID,
      kind: "officer",
      officerKey: "fire_safety_officer",
    });
  }
  dbMock.queue(probe, roles);
}

beforeEach(() => {
  dbMock.reset();
});

describe("ensureDefaultRoles", () => {
  it("seeds the defaults and the officer catalog in ONE insert, then scopes Team lead", async () => {
    // 24 sequential inserts became 1 when this was collapsed; the conflict
    // target is what still makes two concurrent requests harmless.
    dbMock.queue(
      /* nothing exists yet */ [],
      /* the multi-row insert */ [],
      /* read back what was seeded */ [
        { id: BASELINE_ID, kind: "baseline" },
        { id: TEAM_LEAD_ID, kind: "default" },
      ],
      /* the Team lead scope patch */ [],
    );

    await ensureDefaultRoles(GROUP);

    const insert = dbMock.onlyQuery("insert");
    const rows = insert.arg("values") as { kind: string }[];
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.filter((r) => r.kind === "officer")).toHaveLength(5);

    // Team lead's questionnaire audience is re-pointed at the BASELINE role id,
    // which is what scopes it to Burner audiences.
    const patch = dbMock.onlyQuery("update").arg("set") as {
      permissions: { manage_questionnaires: { audienceRoles: string[] } };
    };
    expect(patch.permissions.manage_questionnaires.audienceRoles).toEqual([
      BASELINE_ID,
    ]);
  });

  it("tops a pre-feature camp up with officer rows only, and re-scopes nothing", async () => {
    dbMock.queue(
      [{ id: BASELINE_ID, kind: "baseline", officerKey: null }],
      /* the top-up insert */ [],
    );

    await ensureDefaultRoles(GROUP);

    const rows = dbMock.onlyQuery("insert").arg("values") as { kind: string }[];
    expect(rows.every((r) => r.kind === "officer")).toBe(true);
    // `haveAny` was true, so the seeded read-back and the patch never ran.
    expect(dbMock.queriesOfKind("update")).toHaveLength(0);
  });

  it("writes nothing at all when both defaults and officers exist", async () => {
    dbMock.queue([
      { id: BASELINE_ID, kind: "baseline", officerKey: null },
      { id: SAFETY_BARON_ID, kind: "officer", officerKey: "fire_safety_officer" },
    ]);

    await ensureDefaultRoles(GROUP);

    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
    expect(dbMock.queriesOfKind("update")).toHaveLength(0);
  });
});

describe("listRoles", () => {
  it("normalises a missing officerKey to null", async () => {
    queueRoles([role({ officerKey: undefined as unknown as null })]);
    const roles = await listRoles(GROUP);
    expect(roles[0]!.officerKey).toBeNull();
  });
});

describe("createRole / renameRole — one name per camp", () => {
  it("REFUSES an empty name before it queries anything", async () => {
    expect(await createRole(GROUP, "   ")).toEqual({
      ok: false,
      error: "Give the role a short, non-empty name.",
    });
    expect(dbMock.queries).toHaveLength(0);
  });

  it("REFUSES a name that collides once normalised", async () => {
    // "Kitchen crew", "kitchen-crew" and "kitchencrew" are the same role as far
    // as the unique index is concerned, so the message has to come from here
    // rather than from a 500 later.
    queueRoles([BASELINE, role({ name: "Kitchen crew" })]);

    expect(await createRole(GROUP, "kitchen-crew")).toEqual({
      ok: false,
      error: "A role with that name already exists.",
    });
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("REFUSES once the camp is at the role cap", async () => {
    queueRoles(
      Array.from({ length: 20 }, (_, i) =>
        role({ id: `r-${i}`, name: `Crew ${i}` }),
      ),
    );

    const result = await createRole(GROUP, "One more");
    expect(result.ok).toBe(false);
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("maps the unique-index violation to the same graceful message", async () => {
    // The pre-check races: two leads adding "Kitchen crew" at once both pass
    // it, and the index is the real guarantee.
    queueRoles([BASELINE]);
    dbMock.queue(uniqueViolation("project_roles_group_id_name_normalized_idx"));

    expect(await createRole(GROUP, "Kitchen crew")).toEqual({
      ok: false,
      error: "A role with that name already exists.",
    });
  });

  it("appends the new role after the highest existing sort", async () => {
    queueRoles([BASELINE, role({ sort: 9 })]);
    dbMock.queue([]);

    expect(await createRole(GROUP, "  Bar   crew ", { color: "teal" })).toEqual({
      ok: true,
    });
    expect(dbMock.onlyQuery("insert").arg("values")).toMatchObject({
      groupId: GROUP,
      // Cleaned: trimmed and internal whitespace collapsed.
      name: "Bar crew",
      kind: "custom",
      color: "teal",
      sort: 10,
      permissions: {},
    });
  });

  it("renameRole REFUSES an officer role — the catalog is org-uniform", async () => {
    queueRoles();

    expect(await renameRole(GROUP, SAFETY_BARON_ID, "Fire person")).toEqual({
      ok: false,
      error: "Officer roles can't be renamed.",
    });
    expect(dbMock.queriesOfKind("update")).toHaveLength(0);
  });

  it("renameRole REFUSES a role that no longer exists", async () => {
    queueRoles();
    expect(await renameRole(GROUP, "role-gone", "Anything")).toEqual({
      ok: false,
      error: "That role no longer exists.",
    });
  });

  it("renameRole lets a role keep its own normalized key (a pure case change)", async () => {
    queueRoles([BASELINE, role({ name: "Kitchen crew" })]);
    dbMock.queue([]);

    expect(await renameRole(GROUP, CUSTOM_ID, "Kitchen Crew")).toEqual({
      ok: true,
    });
    expect(dbMock.onlyQuery("update").arg("set")).toMatchObject({
      name: "Kitchen Crew",
      nameNormalized: "kitchencrew",
    });
  });

  it("renameRole REFUSES a collision with a DIFFERENT role", async () => {
    queueRoles([
      BASELINE,
      role({ id: CUSTOM_ID, name: "Kitchen crew" }),
      role({ id: "role-other", name: "Bar crew" }),
    ]);

    expect(await renameRole(GROUP, CUSTOM_ID, "bar crew")).toEqual({
      ok: false,
      error: "A role with that name already exists.",
    });
  });
});

describe("setRoleAppearance / setRolePermissions / removeRole", () => {
  it("REFUSES to restyle an officer role", async () => {
    queueRoles();
    expect(await setRoleAppearance(GROUP, SAFETY_BARON_ID, { color: "teal" })).toEqual(
      { ok: false, error: "Officer roles use the AfrikaBurn catalog styling." },
    );
  });

  it("keeps the current colour and emoji when the patch omits them", async () => {
    queueRoles([BASELINE, role({ color: "teal", emoji: "🍳" })]);
    dbMock.queue([]);

    await setRoleAppearance(GROUP, CUSTOM_ID, {});
    expect(dbMock.onlyQuery("update").arg("set")).toMatchObject({
      color: "teal",
      emoji: "🍳",
    });
  });

  it("clears the emoji when the patch says null explicitly", async () => {
    // `undefined` (keep) and `null` (clear) are different answers; collapsing
    // them makes an emoji impossible to remove.
    queueRoles([BASELINE, role({ emoji: "🍳" })]);
    dbMock.queue([]);

    await setRoleAppearance(GROUP, CUSTOM_ID, { emoji: null });
    expect(dbMock.onlyQuery("update").arg("set")).toMatchObject({ emoji: null });
  });

  it("LOCKS captain permissions to everything, whatever the caller passed", async () => {
    queueRoles([BASELINE, CAPTAIN]);
    dbMock.queue([]);

    await setRolePermissions(GROUP, CAPTAIN_ID, {});
    const set = dbMock.onlyQuery("update").arg("set") as {
      permissions: Record<string, unknown>;
    };
    expect(Object.keys(set.permissions).length).toBeGreaterThan(0);
    expect(set.permissions.manage_roles).toBe(true);
  });

  it("stores a custom role's permissions as given", async () => {
    queueRoles([BASELINE, role()]);
    dbMock.queue([]);

    await setRolePermissions(GROUP, CUSTOM_ID, { assign_roles: true });
    expect(dbMock.onlyQuery("update").arg("set")).toMatchObject({
      permissions: { assign_roles: true },
    });
  });

  it("removeRole deletes a custom role and REFUSES every permanent kind", async () => {
    queueRoles([BASELINE, role()]);
    dbMock.queue([]);
    expect(await removeRole(GROUP, CUSTOM_ID)).toEqual({ ok: true });
    expect(dbMock.queriesOfKind("delete")).toHaveLength(1);

    dbMock.reset();
    queueRoles();
    expect(await removeRole(GROUP, SAFETY_BARON_ID)).toEqual({
      ok: false,
      error: "Only custom roles can be deleted.",
    });
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
  });

  it("removeRole REFUSES an id from another camp", async () => {
    queueRoles();
    expect(await removeRole(GROUP, "role-from-camp-b")).toEqual({
      ok: false,
      error: "That role no longer exists.",
    });
  });
});

describe("setMemberRoles — the escalation guard", () => {
  const ELEVATING = role({
    id: "role-elevating",
    name: "Deputy",
    permissions: { manage_roles: true },
  });

  it("REFUSES a member who is not in this camp, and opens no transaction", async () => {
    dbMock.queue([]);

    expect(await setMemberRoles(GROUP, MEMBERSHIP, [CUSTOM_ID])).toEqual({
      ok: false,
      error: "That member isn't in this camp.",
    });
    expect(dbMock.transactions).toBe(0);
  });

  it("REFUSES an assign_roles-only caller handing out a role that manages roles", async () => {
    // Otherwise an assign_roles holder self-assigns Captain (or any
    // manage_roles role) and walks out with every project permission.
    dbMock.queue([{ id: MEMBERSHIP }]);
    queueRoles([BASELINE, ELEVATING]);

    expect(await setMemberRoles(GROUP, MEMBERSHIP, ["role-elevating"])).toEqual({
      ok: false,
      error: "Only a role manager can assign roles that manage roles or members.",
    });
    expect(dbMock.transactions).toBe(0);
  });

  it("permits the same assignment for a manage_roles holder", async () => {
    dbMock.queue([{ id: MEMBERSHIP }]);
    queueRoles([BASELINE, ELEVATING]);
    dbMock.queue(/* delete */ [], /* insert */ []);

    expect(
      await setMemberRoles(GROUP, MEMBERSHIP, ["role-elevating"], {
        allowElevated: true,
      }),
    ).toEqual({ ok: true });
    expect(dbMock.transactions).toBe(1);
  });

  it("replaces the assignable set atomically, ignoring baseline, officer and unknown ids", async () => {
    // Baseline is derived (everyone holds it, never stored) and officers go
    // through the consent flow, so neither may be quick-assigned. Without the
    // transaction, a failure between the delete and the insert strips a member
    // of their roles without granting the replacements — a silent authz
    // downgrade nobody would see.
    dbMock.queue([{ id: MEMBERSHIP }]);
    queueRoles([BASELINE, TEAM_LEAD, SAFETY_BARON, role()]);
    dbMock.queue([], []);

    expect(
      await setMemberRoles(GROUP, MEMBERSHIP, [
        CUSTOM_ID,
        CUSTOM_ID,
        BASELINE_ID,
        SAFETY_BARON_ID,
        "role-from-camp-b",
      ]),
    ).toEqual({ ok: true });

    const insert = dbMock.writesTo(schema.memberRoleAssignments).find(
      (q) => q.kind === "insert",
    );
    expect(insert?.arg("values")).toEqual([
      {
        membershipId: MEMBERSHIP,
        projectRoleId: CUSTOM_ID,
        consentStatus: "accepted",
        orgVisible: false,
      },
    ]);
    expect(insert?.tx).toBe(true);
  });

  it("clearing every role still runs the delete, and skips the empty insert", async () => {
    dbMock.queue([{ id: MEMBERSHIP }]);
    queueRoles([BASELINE, role()]);
    dbMock.queue([]);

    expect(await setMemberRoles(GROUP, MEMBERSHIP, [])).toEqual({ ok: true });
    expect(
      dbMock.writesTo(schema.memberRoleAssignments).map((q) => q.kind),
    ).toEqual(["delete"]);
  });
});

describe("assignOfficer — nothing is shared until the burner answers", () => {
  it("creates a PENDING consent, not an accepted one", async () => {
    // An officer registration is the ONE path that shares a burner's phone
    // number with AfrikaBurn. A row written as `accepted` would share it
    // without anybody having agreed.
    queueRoles();
    dbMock.queue(
      /* membership check */ [{ id: MEMBERSHIP }],
      /* the upsert */ [],
      /* notification hook: membership → userId */ [{ userId: USER }],
      /* camp name + slug */ [{ name: "Mad Hatters", slug: "mad-hatters" }],
      /* insertNotifications */ [],
    );

    expect(await assignOfficer(GROUP, MEMBERSHIP, SAFETY_BARON_ID)).toEqual({
      ok: true,
    });

    const upsert = dbMock.writesTo(schema.memberRoleAssignments)[0]!;
    expect(upsert.arg("values")).toMatchObject({
      membershipId: MEMBERSHIP,
      projectRoleId: SAFETY_BARON_ID,
      consentStatus: "pending",
      acceptedAt: null,
      orgVisible: false,
      // A row left over from a previous edition must not keep that edition's
      // consent while it waits to be accepted again.
      consentEditionId: null,
    });

    const notified = dbMock.writesTo(schema.notifications)[0]!;
    expect((notified.arg("values") as { userId: string }[])[0]!.userId).toBe(
      USER,
    );
  });

  it("REFUSES a role that is not an officer role of this camp", async () => {
    queueRoles();
    expect(await assignOfficer(GROUP, MEMBERSHIP, CUSTOM_ID)).toEqual({
      ok: false,
      error: "That officer role doesn't exist.",
    });
  });

  it("REFUSES an elevating officer role for an assign_roles-only caller", async () => {
    // Officer roles seed with no permissions, but a camp CAN give Safety Baron
    // manage_roles — and an officer assignment is self-acceptable. Without this
    // guard a member holding only assign_roles names themselves, accepts their
    // own consent banner, and holds the authority quick-assign refuses them.
    queueRoles([
      BASELINE,
      role({
        id: SAFETY_BARON_ID,
        kind: "officer",
        officerKey: "fire_safety_officer",
        permissions: { manage_roles: true },
      }),
    ]);

    expect(await assignOfficer(GROUP, MEMBERSHIP, SAFETY_BARON_ID)).toEqual({
      ok: false,
      error: "Only a role manager can assign roles that manage roles or members.",
    });
    expect(dbMock.writesTo(schema.memberRoleAssignments)).toHaveLength(0);
  });

  it("REFUSES a membership that belongs to another camp", async () => {
    queueRoles();
    dbMock.queue([]);

    expect(await assignOfficer(GROUP, MEMBERSHIP, SAFETY_BARON_ID)).toEqual({
      ok: false,
      error: "That member isn't in this camp.",
    });
  });

  it("still assigns when the notification hook fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    queueRoles();
    dbMock.queue(
      [{ id: MEMBERSHIP }],
      [],
      new Error("notifications table is on fire"),
    );

    expect(await assignOfficer(GROUP, MEMBERSHIP, SAFETY_BARON_ID)).toEqual({
      ok: true,
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("respondToOfficer — the consent itself", () => {
  it("a DECLINE removes the assignment and shares nothing", async () => {
    queueRolesForRespond();
    dbMock.queue([]);

    expect(
      await respondToOfficer(USER, GROUP, SAFETY_BARON_ID, false, EDITION),
    ).toEqual({ ok: true });

    expect(dbMock.queriesOfKind("delete")).toHaveLength(1);
    // Nothing was stamped org-visible — a decline must not share a phone number.
    expect(dbMock.queriesOfKind("update")).toHaveLength(0);
  });

  it("an ACCEPT stamps the consent against THIS edition and opens org visibility", async () => {
    queueRolesForRespond();
    dbMock.queue(
      /* update … returning */ [{ membershipId: MEMBERSHIP }],
      /* camp lookup */ [{ name: "Mad Hatters", slug: "mad-hatters" }],
      /* the confirmation notification */ [],
    );

    expect(
      await respondToOfficer(USER, GROUP, SAFETY_BARON_ID, true, EDITION),
    ).toEqual({ ok: true });

    const set = dbMock.onlyQuery("update").arg("set") as Record<string, unknown>;
    expect(set.consentStatus).toBe("accepted");
    expect(set.orgVisible).toBe(true);
    // Consent to share a phone number with AfrikaBurn is consent for ONE burn.
    expect(set.consentEditionId).toBe(EDITION);
  });

  it("REFUSES an accept that updated no row — never report a registration that did not happen", async () => {
    // The banner turns `{ ok: true }` into "Thanks — you're registered." A
    // member whose assignment was withdrawn while the banner sat open would be
    // told they were the Safety Baron while the camp's slot read unassigned and
    // AfrikaBurn had no contact for the post.
    queueRolesForRespond();
    dbMock.queue(/* returning */ []);

    expect(
      await respondToOfficer(USER, GROUP, SAFETY_BARON_ID, true, EDITION),
    ).toEqual({
      ok: false,
      error: "That officer role isn't waiting on you any more.",
    });
  });

  it("REFUSES a roleId that is not an OFFICER role of this camp", async () => {
    // This action carries no permission gate by design — a member consenting on
    // their own behalf needs none — which made it a free write on any
    // assignment row of their own membership: `accept: false` silently dropped
    // a Team lead role (and with it a questionnaire audience), `accept: true`
    // stamped a consent flag on a row that was never a consent moment.
    queueRolesForRespond();

    expect(
      await respondToOfficer(USER, GROUP, TEAM_LEAD_ID, false, EDITION),
    ).toEqual({ ok: false, error: "That officer role doesn't exist." });
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
  });

  it("REFUSES someone who is not in the camp at all", async () => {
    dbMock.queue([]);

    expect(
      await respondToOfficer(USER, GROUP, SAFETY_BARON_ID, true, EDITION),
    ).toEqual({ ok: false, error: "You're not in this camp." });
  });

  function queueRolesForRespond() {
    dbMock.queue([{ id: MEMBERSHIP }]);
    queueRoles();
  }
});

describe("unassignOfficer", () => {
  it("REFUSES a role id from another camp — the cross-camp write", async () => {
    // Both ids arrive from the client while the permission check upstream
    // authorises the caller only for their OWN camp, so a lead of camp A could
    // strip an officer from camp B.
    queueRoles();

    expect(await unassignOfficer(GROUP, MEMBERSHIP, "role-from-camp-b")).toEqual(
      { ok: false, error: "That officer role doesn't exist." },
    );
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
  });

  it("REFUSES a membership from another camp", async () => {
    queueRoles();
    dbMock.queue([]);

    expect(await unassignOfficer(GROUP, MEMBERSHIP, SAFETY_BARON_ID)).toEqual({
      ok: false,
      error: "That member isn't in this camp.",
    });
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
  });

  it("clears the assignment when both ids belong to the camp", async () => {
    queueRoles();
    dbMock.queue([{ id: MEMBERSHIP }], []);

    expect(await unassignOfficer(GROUP, MEMBERSHIP, SAFETY_BARON_ID)).toEqual({
      ok: true,
    });
    expect(dbMock.queriesOfKind("delete")).toHaveLength(1);
  });
});

describe("pendingOfficerConsents", () => {
  it("includes ACCEPTED rows — consent that cannot be withdrawn is not consent", async () => {
    // Filtering to `pending` made the banner vanish the moment someone
    // accepted, and their phone number was shared with AfrikaBurn with no way
    // back short of asking the lead who assigned them.
    dbMock.queue([
      {
        membershipId: MEMBERSHIP,
        roleId: SAFETY_BARON_ID,
        officerKey: "fire_safety_officer",
        officerName: "Safety Baron",
        emoji: "🔥",
        groupId: GROUP,
        groupName: "Mad Hatters",
        groupSlug: "mad-hatters",
        consent: "accepted",
      },
      {
        membershipId: MEMBERSHIP,
        roleId: "role-broken",
        officerKey: null,
        officerName: "Corrupt",
        emoji: null,
        groupId: GROUP,
        groupName: "Mad Hatters",
        groupSlug: "mad-hatters",
        consent: "pending",
      },
    ]);

    const consents = await pendingOfficerConsents(USER);
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({
      officerKey: "fire_safety_officer",
      consent: "accepted",
    });
  });

  it("maps any other consent value to pending", async () => {
    dbMock.queue([
      {
        membershipId: MEMBERSHIP,
        roleId: SAFETY_BARON_ID,
        officerKey: "fire_safety_officer",
        officerName: "Safety Baron",
        emoji: null,
        groupId: GROUP,
        groupName: "Mad Hatters",
        groupSlug: "mad-hatters",
        consent: "pending",
      },
    ]);

    expect((await pendingOfficerConsents(USER))[0]!.consent).toBe("pending");
  });
});

describe("getMemberPermissions", () => {
  it("is null for someone who is not a member", async () => {
    dbMock.queue([]);
    expect(await getMemberPermissions(GROUP, USER)).toBeNull();
  });

  it("always includes the derived baseline and counts only ACCEPTED assignments", async () => {
    // Baseline is held by everyone and never stored. A pending officer
    // assignment must NOT contribute permissions — acceptance is what makes it
    // count.
    dbMock.queue([{ id: MEMBERSHIP, role: "member" }]);
    queueRoles([BASELINE, TEAM_LEAD, SAFETY_BARON]);
    dbMock.queue([{ projectRoleId: TEAM_LEAD_ID }]);

    expect(await getMemberPermissions(GROUP, USER)).toEqual({
      structuralRole: "member",
      rolePermissions: [BASELINE.permissions, TEAM_LEAD.permissions],
    });
  });

  it("returns the structural role even when the camp has no baseline row", async () => {
    dbMock.queue([{ id: MEMBERSHIP, role: "lead" }]);
    queueRoles([role()]);
    dbMock.queue([]);

    expect(await getMemberPermissions(GROUP, USER)).toEqual({
      structuralRole: "lead",
      rolePermissions: [],
    });
  });
});

describe("getBaselineRoleId / getRoleAssignments / membershipIdsWithRoles", () => {
  it("getBaselineRoleId is null when there is no baseline role", async () => {
    queueRoles([role()]);
    expect(await getBaselineRoleId(GROUP)).toBeNull();
  });

  it("getRoleAssignments groups several roles under one membership", async () => {
    dbMock.queue([
      {
        membershipId: MEMBERSHIP,
        projectRoleId: TEAM_LEAD_ID,
        consent: "accepted",
        orgVisible: false,
      },
      {
        membershipId: MEMBERSHIP,
        projectRoleId: SAFETY_BARON_ID,
        consent: "pending",
        orgVisible: false,
      },
    ]);

    const map = await getRoleAssignments(GROUP);
    expect(map.get(MEMBERSHIP)).toHaveLength(2);
  });

  it("membershipIdsWithRoles returns empty for an empty role list, without querying", async () => {
    expect(await membershipIdsWithRoles(GROUP, [])).toEqual([]);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("membershipIdsWithRoles de-duplicates a membership holding two of the roles", async () => {
    dbMock.queue([
      { membershipId: MEMBERSHIP },
      { membershipId: MEMBERSHIP },
      { membershipId: "ms-2" },
    ]);

    expect(await membershipIdsWithRoles(GROUP, [TEAM_LEAD_ID, CUSTOM_ID])).toEqual(
      [MEMBERSHIP, "ms-2"],
    );
  });
});

describe("getOfficerStatus", () => {
  it("treats a DRAFT registration as not applicable — the org console says the same", async () => {
    // The two disagreed on `draft`: a camp part-way through drafting was told
    // on its own page that it had required officers outstanding, in red, while
    // the console left it out of coverage entirely.
    dbMock.queue([{ status: "draft", sound: null }]);
    queueRoles();
    dbMock.queue(/* assignments */ []);

    const status = await getOfficerStatus(GROUP, EDITION);
    expect(status.isRegisteredOrInFlight).toBe(false);
    expect(status.officers).toHaveLength(1);
    // A vacant slot is present with no assignments, so the settings page can
    // show the post as unfilled rather than omitting it.
    expect(status.officers[0]).toMatchObject({
      officerKey: "fire_safety_officer",
      assignments: [],
    });
  });

  it("counts a camp under review as in flight, and a pending assignment as filling the slot", async () => {
    dbMock.queue([{ status: "under_review", sound: "Level 4 — Large rig" }]);
    queueRoles();
    dbMock.queue([
      {
        membershipId: MEMBERSHIP,
        projectRoleId: SAFETY_BARON_ID,
        consent: "pending",
        orgVisible: false,
      },
    ]);

    const status = await getOfficerStatus(GROUP, EDITION);
    expect(status.isRegisteredOrInFlight).toBe(true);
    expect(status.officers[0]!.assignments).toEqual([
      { membershipId: MEMBERSHIP, consent: "pending", orgVisible: false },
    ]);
    expect(status.outstanding.applies).toBe(true);
    expect(status.outstanding.outstanding).not.toContain(
      "fire_safety_officer",
    );
  });

  it("is not applicable for a camp with no registration at all", async () => {
    dbMock.queue([]);
    queueRoles();
    dbMock.queue([]);

    const status = await getOfficerStatus(GROUP, EDITION);
    expect(status.isRegisteredOrInFlight).toBe(false);
  });
});
