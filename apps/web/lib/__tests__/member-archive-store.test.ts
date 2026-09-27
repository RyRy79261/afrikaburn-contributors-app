import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { GroupKind, MembershipRole } from "@quagga/types";
import { boundStrings, dbMock, nullChecksOn } from "@/test/db-mock";

// Former camp members (CDB-036) — the archive and restore WRITES. What these
// pin is the decision (who is refused, and that a refusal writes nothing), the
// shape of the one transaction (compare-and-set on the row, waive the camp's
// pending questionnaires, audit), and that nothing else is deleted. The
// access side — every read treating an archived row as no membership — is
// pinned by membership-archive-access.test.ts and the source guard.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const stubs = vi.hoisted(() => ({
  /** `${groupId}:${userId}` → the actor's permission membership. */
  perms: new Map<string, unknown>(),
}));

vi.mock("../roles-store", () => ({
  getMemberPermissions: async (groupId: string, userId: string) =>
    stubs.perms.get(`${groupId}:${userId}`) ?? null,
}));

const { archiveMember, restoreMember } =
  await import("../member-archive-store");

// Values from the real vocabularies (AGENTS.md "Verification"). Ids fictional.
const THEME_CAMP = GroupKind.enum.theme_camp;
const ORG = GroupKind.enum.org;
const LEAD = MembershipRole.enum.lead;
const ADMIN = MembershipRole.enum.admin;
const MEMBER = MembershipRole.enum.member;
// From the real pg enum, not a string typed here.
const WAIVED = schema.requiredActionStatusEnum.enumValues.find(
  (v) => v === "waived",
)!;

const CAMP = "11111111-0000-4000-8000-00000000000a";
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead
const REN = "aaaaaaaa-0000-4000-8000-000000000002"; // member
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // co-lead
const M_REN = "22222222-0000-4000-8000-000000000002";

function targetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: M_REN,
    userId: REN,
    role: MEMBER,
    archivedAt: null,
    groupKind: THEME_CAMP,
    ...overrides,
  };
}

const input = (actorUserId = ALICE) => ({
  actorUserId,
  groupId: CAMP,
  membershipId: M_REN,
});

beforeEach(() => {
  dbMock.reset();
  stubs.perms = new Map<string, unknown>([
    [`${CAMP}:${ALICE}`, { structuralRole: LEAD, rolePermissions: [{}] }],
    [`${CAMP}:${JABU}`, { structuralRole: ADMIN, rolePermissions: [{}] }],
    [`${CAMP}:${REN}`, { structuralRole: MEMBER, rolePermissions: [{}] }],
  ]);
});

describe("archiveMember — refusals write nothing", () => {
  it("refuses a caller without manage_members", async () => {
    dbMock.queue([targetRow({ id: "m-jabu", userId: JABU, role: MEMBER })]);
    expect(await archiveMember(input(REN))).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
    });
    expect(dbMock.transactions).toBe(0);
    expect(dbMock.writesTo(schema.memberships)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("refuses a caller who is not (or no longer) a member of this camp", async () => {
    // getMemberPermissions resolves the caller's ACTIVE membership of the camp;
    // a former lead, or a lead of another camp, gets null.
    dbMock.queue([targetRow()]);
    expect(
      await archiveMember(input("aaaaaaaa-0000-4000-8000-0000000000ff")),
    ).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(dbMock.transactions).toBe(0);
  });

  it("NEVER archives the lead — the no-lockout backstop", async () => {
    dbMock.queue([targetRow({ userId: ALICE, role: LEAD })]);
    const result = await archiveMember(input(JABU));
    expect(result).toEqual({
      ok: false,
      error: "The camp lead can't be archived. Transfer the lead role first.",
    });
    expect(dbMock.transactions).toBe(0);
    expect(dbMock.writesTo(schema.memberships)).toHaveLength(0);
  });

  it("refuses a co-lead archiving another co-lead", async () => {
    dbMock.queue([targetRow({ userId: "co-lead-2", role: ADMIN })]);
    expect(await archiveMember(input(JABU))).toEqual({
      ok: false,
      error: "Only the camp lead can archive or restore a co-lead.",
    });
    expect(dbMock.transactions).toBe(0);
  });

  it("refuses archiving yourself", async () => {
    dbMock.queue([targetRow({ userId: JABU, role: ADMIN })]);
    expect((await archiveMember(input(JABU))).ok).toBe(false);
    expect(dbMock.transactions).toBe(0);
  });

  it("refuses a membership of another camp (scoped lookup finds nothing)", async () => {
    dbMock.queue([]);
    expect(await archiveMember(input())).toEqual({
      ok: false,
      error: "That person isn't in this camp.",
    });
    // The lookup was scoped to THIS camp and this membership id.
    const lookup = dbMock.queriesTouching(schema.memberships)[0]!;
    expect(boundStrings(lookup)).toEqual(expect.arrayContaining([CAMP, M_REN]));
  });

  it("refuses an org-group membership", async () => {
    dbMock.queue([targetRow({ groupKind: ORG })]);
    expect((await archiveMember(input())).ok).toBe(false);
    expect(dbMock.transactions).toBe(0);
  });

  it("refuses someone already archived", async () => {
    dbMock.queue([targetRow({ archivedAt: new Date("2027-01-01") })]);
    expect(await archiveMember(input())).toEqual({
      ok: false,
      error: "They're already a former member.",
    });
  });
});

describe("archiveMember — the write", () => {
  it("marks the row archived, waives this camp's pending questionnaires, and audits — one transaction", async () => {
    dbMock.queue(
      [targetRow()],
      /* CAS update … returning */ [{ id: M_REN }],
      /* waive … returning */ [{ id: "ra-1" }, { id: "ra-2" }],
      /* audit */ [],
    );
    expect(await archiveMember(input())).toEqual({ ok: true });
    expect(dbMock.transactions).toBe(1);

    const [cas] = dbMock.writesTo(schema.memberships);
    expect(cas!.kind).toBe("update");
    expect(cas!.tx).toBe(true);
    expect(cas!.arg("set")).toMatchObject({ archivedByUserId: ALICE });
    expect(
      (cas!.arg("set") as { archivedAt: unknown }).archivedAt,
    ).toBeInstanceOf(Date);
    // Compare-and-set: still active, still the role that was judged.
    expect(nullChecksOn(cas!, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);
    expect(boundStrings(cas!)).toEqual(
      expect.arrayContaining([M_REN, CAMP, MEMBER]),
    );

    const [waive] = dbMock.writesTo(schema.requiredActions);
    expect(waive!.tx).toBe(true);
    expect(waive!.arg("set")).toEqual({ status: WAIVED });
    // Only THIS person's, only pending, only this camp's activations.
    expect(boundStrings(waive!)).toEqual(
      expect.arrayContaining([REN, "pending"]),
    );
    const activations = dbMock.queriesTouching(schema.questionnaireActivations);
    expect(activations).toHaveLength(1);
    expect(boundStrings(activations[0]!)).toContain(CAMP);

    const [audit] = dbMock.writesTo(schema.auditEvents);
    expect(audit!.tx).toBe(true);
    expect(audit!.arg("values")).toEqual({
      actorId: ALICE,
      action: "camp.member.archive",
      subject: REN,
      meta: {
        groupId: CAMP,
        membershipId: M_REN,
        role: MEMBER,
        waivedQuestionnaires: 2,
      },
    });
  });

  it("deletes NOTHING — history stays", async () => {
    dbMock.queue([targetRow()], [{ id: M_REN }], [], []);
    await archiveMember(input());
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
    // Nothing hung off the membership is written at all.
    for (const table of [
      schema.memberRoleAssignments,
      schema.membershipLogistics,
      schema.questionnaireResponses,
      schema.notifications,
    ]) {
      expect(dbMock.writesTo(table)).toHaveLength(0);
    }
  });

  it("lets the lead archive a co-lead", async () => {
    dbMock.queue(
      [targetRow({ userId: JABU, role: ADMIN })],
      [{ id: M_REN }],
      [],
      [],
    );
    expect(await archiveMember(input())).toEqual({ ok: true });
  });

  it("writes no audit when the row changed underneath (lost compare-and-set)", async () => {
    dbMock.queue([targetRow()], /* CAS matched nothing */ []);
    const result = await archiveMember(input());
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.requiredActions)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });
});

describe("restoreMember", () => {
  const archived = (overrides: Record<string, unknown> = {}) =>
    targetRow({ archivedAt: new Date("2027-02-01"), ...overrides });

  it("brings the SAME row back and audits it", async () => {
    dbMock.queue([archived()], [{ id: M_REN }], []);
    expect(await restoreMember(input())).toEqual({ ok: true });

    const [cas] = dbMock.writesTo(schema.memberships);
    expect(cas!.kind).toBe("update");
    expect(cas!.arg("set")).toEqual({
      archivedAt: null,
      archivedByUserId: null,
    });
    expect(nullChecksOn(cas!, schema.memberships.archivedAt)).toEqual([
      "is not null",
    ]);
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toEqual({
      actorId: ALICE,
      action: "camp.member.restore",
      subject: REN,
      meta: {
        groupId: CAMP,
        membershipId: M_REN,
        role: MEMBER,
        via: "restore",
      },
    });
    // No insert: restoring never creates a second membership.
    expect(dbMock.queriesOfKind("insert").map((q) => q.arg("insert"))).toEqual([
      schema.auditEvents,
    ]);
  });

  it("refuses restoring a current member", async () => {
    dbMock.queue([targetRow()]);
    expect(await restoreMember(input())).toEqual({
      ok: false,
      error: "They're still a current member.",
    });
    expect(dbMock.transactions).toBe(0);
  });

  it("refuses a co-lead restoring a former co-lead (the lead's call)", async () => {
    dbMock.queue([archived({ userId: "co-lead-2", role: ADMIN })]);
    expect((await restoreMember(input(JABU))).ok).toBe(false);
    expect(dbMock.transactions).toBe(0);
  });

  it("refuses a caller without manage_members", async () => {
    dbMock.queue([archived({ userId: JABU })]);
    expect((await restoreMember(input(REN))).ok).toBe(false);
    expect(dbMock.transactions).toBe(0);
  });
});
