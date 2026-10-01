import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import {
  GroupKind,
  MembershipRole,
  OrgOutboundSelector,
  RegistrationStatus,
  RoleAssignmentConsent,
} from "@quagga/types";
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
const ACCEPTED = RoleAssignmentConsent.enum.accepted;
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
      /* revoke their invites … returning */ [{ id: "inv-1" }],
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
    // (the camp's own activations — the subquery FROM activations; the org
    // lookup joins them instead)
    const activations = dbMock
      .queriesTouching(schema.questionnaireActivations)
      .filter((q) => q.arg("from") === schema.questionnaireActivations);
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
        waivedOrgQuestionnaires: 0,
        revokedInvites: 1,
        freedShiftSpots: 0,
      },
    });
  });

  it("revokes every unused invite to THIS camp that the archived person minted", async () => {
    // Invites are bearer tokens. Without this, an archived co-lead holding a
    // link they made earlier could redeem it and restore themselves.
    dbMock.queue(
      [targetRow({ userId: JABU, role: ADMIN })],
      [{ id: M_REN }],
      [],
      [{ id: "inv-member" }, { id: "inv-lead-transfer" }],
      [],
    );
    expect(await archiveMember(input())).toEqual({ ok: true });

    const revokes = dbMock.writesTo(schema.invites);
    expect(revokes).toHaveLength(1);
    const [revoke] = revokes;
    expect(revoke!.kind).toBe("update");
    // Same transaction as the archive: never an archived member with live links.
    expect(revoke!.tx).toBe(true);
    // The existing revoke mechanism: stamp used_at (no redeemer recorded).
    expect(Object.keys(revoke!.arg("set") as object)).toEqual(["usedAt"]);
    expect((revoke!.arg("set") as { usedAt: unknown }).usedAt).toBeInstanceOf(
      Date,
    );
    // Only THIS camp's, only the ones THEY minted, only unused ones — any
    // kind, lead transfers included.
    expect(boundStrings(revoke!)).toEqual(expect.arrayContaining([CAMP, JABU]));
    expect(nullChecksOn(revoke!, schema.invites.usedAt)).toEqual(["is null"]);
    expect(
      (
        dbMock.writesTo(schema.auditEvents)[0]!.arg("values") as {
          meta: { revokedInvites: number };
        }
      ).meta.revokedInvites,
    ).toBe(2);
  });

  it("deletes NOTHING but their shift spots — history stays", async () => {
    dbMock.queue([targetRow()], [{ id: M_REN }], [], []);
    await archiveMember(input());
    // The ONE delete is their camp shift spots (epic #57): a future
    // commitment the camp must refill, not history.
    const deletes = dbMock.queriesOfKind("delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.arg("delete")).toBe(schema.shiftAssignments);
    expect(deletes[0]!.tx).toBe(true);
    expect(boundStrings(deletes[0]!)).toContain(M_REN);
    // …and hand-on requests made TO them are cancelled, not deleted.
    const cleared = dbMock
      .writesTo(schema.shiftAssignments)
      .filter((q) => q.kind === "update");
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.arg("set")).toEqual({ handoverToMembershipId: null });
    expect(boundStrings(cleared[0]!)).toContain(M_REN);
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
    expect(dbMock.writesTo(schema.invites)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });
});

// Decided 2026-09-28 (Ryan): archiving also waives the person's pending ORG
// questionnaires that reached them through their role in THIS camp. The rule
// itself is @quagga/core `orgActionsLostByArchive` (tested there against the
// real resolver); these pin the wiring — what is loaded, in the archive
// transaction, and exactly which rows are waived and counted.
describe("archiveMember — org questionnaires reached through this camp", () => {
  const EDITION = "eeeeeeee-0000-4000-8000-000000000027";
  const OTHER_CAMP = "11111111-0000-4000-8000-00000000000b";
  const M_OTHER = "22222222-0000-4000-8000-00000000000b";
  const APPROVED = RegistrationStatus.enum.approved;
  const leadsForm = {
    id: "ra-org-leads",
    editionId: EDITION,
    audience: {
      kind: "org_outbound",
      selectors: [OrgOutboundSelector.enum.registered_camp_leads],
    },
  };
  const burnersOrLeadsForm = {
    id: "ra-org-burners-or-leads",
    editionId: EDITION,
    audience: {
      kind: "org_outbound",
      selectors: [
        OrgOutboundSelector.enum.all_current_burners,
        OrgOutboundSelector.enum.camp_leads,
      ],
    },
  };
  const coLeadHere = {
    membershipId: M_REN,
    userId: JABU,
    groupId: CAMP,
    role: ADMIN,
    kind: THEME_CAMP,
  };
  const registered = (groupId: string) => ({
    groupId,
    editionId: EDITION,
    status: APPROVED,
    grantsInterest: false,
  });

  /** Archive Jabu (co-lead) up to the org lookup; the rest is per test. */
  function queueArchiveOfCoLead(...rest: unknown[]) {
    dbMock.queue(
      [targetRow({ userId: JABU, role: ADMIN })],
      /* CAS */ [{ id: M_REN }],
      /* camp waive */ [],
      /* revoke invites */ [],
      ...rest,
    );
  }

  it("waives a 'registered camp leads' form that reached them only as this camp's co-lead, and counts it", async () => {
    queueArchiveOfCoLead(
      /* pending camp-role org actions */ [leadsForm, burnersOrLeadsForm],
      /* their memberships (current + this one) */ [coLeadHere],
      /* registrations */ [registered(CAMP)],
      /* bios — still a current burner */ [
        { userId: JABU, editionId: EDITION },
      ],
      /* role assignments */ [],
      /* project roles */ [],
      /* waive … returning */ [{ id: "ra-org-leads" }],
      /* audit */ [],
    );
    expect(await archiveMember(input())).toEqual({ ok: true });

    // The lookup: this person's PENDING actions from ORG-authored activations
    // with a camp-role audience — in the archive transaction.
    const lookup = dbMock
      .queriesOfKind("select")
      .find((q) => q.arg("from") === schema.requiredActions)!;
    expect(lookup.tx).toBe(true);
    expect(boundStrings(lookup)).toEqual(
      expect.arrayContaining([JABU, "pending", "org_outbound", "org_officer"]),
    );
    expect(boundStrings(lookup)).not.toContain("org_internal");
    expect(
      nullChecksOn(lookup, schema.questionnaireActivations.groupId),
    ).toEqual(["is null"]);

    // Their memberships: the current ones, plus the one just archived.
    const own = dbMock
      .queriesOfKind("select")
      .find((q) => q.arg("from") === schema.memberships && q.tx)!;
    expect(boundStrings(own)).toEqual(expect.arrayContaining([JABU, M_REN]));
    expect(nullChecksOn(own, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);

    // Exactly the lost form is waived — the one they still get as a burner
    // is not.
    const waives = dbMock.writesTo(schema.requiredActions);
    expect(waives).toHaveLength(2); // camp waive + org waive
    const orgWaive = waives[1]!;
    expect(orgWaive.tx).toBe(true);
    expect(orgWaive.arg("set")).toEqual({ status: WAIVED });
    expect(boundStrings(orgWaive)).toContain("ra-org-leads");
    expect(boundStrings(orgWaive)).not.toContain("ra-org-burners-or-leads");
    expect(boundStrings(orgWaive)).toContain("pending");

    const audit = dbMock.writesTo(schema.auditEvents)[0]!.arg("values") as {
      meta: Record<string, unknown>;
    };
    expect(audit.meta).toMatchObject({
      waivedQuestionnaires: 0,
      waivedOrgQuestionnaires: 1,
    });
  });

  it("keeps the form when they are still a co-lead of ANOTHER registered camp", async () => {
    queueArchiveOfCoLead(
      [leadsForm],
      [
        coLeadHere,
        { ...coLeadHere, membershipId: M_OTHER, groupId: OTHER_CAMP },
      ],
      [registered(CAMP), registered(OTHER_CAMP)],
      [],
      [],
      [],
      /* audit */ [],
    );
    expect(await archiveMember(input())).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.requiredActions)).toHaveLength(1); // camp only
    const audit = dbMock.writesTo(schema.auditEvents)[0]!.arg("values") as {
      meta: Record<string, unknown>;
    };
    expect(audit.meta).toMatchObject({ waivedOrgQuestionnaires: 0 });
  });

  it("loads nothing more when no camp-role org form is pending", async () => {
    queueArchiveOfCoLead(/* pending */ [], /* audit */ []);
    expect(await archiveMember(input())).toEqual({ ok: true });
    expect(
      dbMock
        .queriesOfKind("select")
        .filter((q) => q.tx && q.arg("from") === schema.memberships),
    ).toHaveLength(0);
    expect(dbMock.writesTo(schema.requiredActions)).toHaveLength(1);
  });
});

describe("restoreMember", () => {
  const archived = (overrides: Record<string, unknown> = {}) =>
    targetRow({ archivedAt: new Date("2027-02-01"), ...overrides });

  it("brings the SAME row back and audits it", async () => {
    dbMock.queue([archived()], [{ id: M_REN }], /* no roles held */ [], []);
    expect(await restoreMember(input())).toEqual({ ok: true });

    const [cas] = dbMock.writesTo(schema.memberships);
    expect(cas!.kind).toBe("update");
    expect(cas!.arg("set")).toEqual({
      archivedAt: null,
      archivedByUserId: null,
      role: MEMBER,
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
        previousRole: MEMBER,
        role: MEMBER,
        droppedRoleAssignments: [],
        via: "restore",
      },
    });
    // No insert: restoring never creates a second membership.
    expect(dbMock.queriesOfKind("insert").map((q) => q.arg("insert"))).toEqual([
      schema.auditEvents,
    ]);
  });

  // Decided 2026-09-28 (Ryan): a restored member comes back WITHOUT their
  // previous privileges — plain member, no custom project roles.
  it("drops their custom role assignments (officer consent included) and records them in the audit", async () => {
    const dropped = [
      {
        projectRoleId: "role-kitchen",
        consentStatus: ACCEPTED,
        orgVisible: false,
      },
      {
        projectRoleId: "role-safety-officer",
        consentStatus: ACCEPTED,
        orgVisible: true,
      },
    ];
    dbMock.queue([archived()], [{ id: M_REN }], dropped, []);
    expect(await restoreMember(input())).toEqual({ ok: true });

    const deletes = dbMock.writesTo(schema.memberRoleAssignments);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.kind).toBe("delete");
    // Same transaction as the restore: never an active row with old roles.
    expect(deletes[0]!.tx).toBe(true);
    // Scoped to THIS person's membership of THIS camp, now active again.
    // (Every restore-time sub-select — roles here, shifts below — is.)
    const scope = dbMock
      .queriesTouching(schema.memberships)
      .filter((q) => q.kind === "select" && q.tx);
    expect(scope.length).toBeGreaterThanOrEqual(1);
    for (const q of scope) {
      expect(boundStrings(q)).toEqual(expect.arrayContaining([REN, CAMP]));
      expect(nullChecksOn(q, schema.memberships.archivedAt)).toEqual([
        "is null",
      ]);
    }

    // Nothing about what they held is lost: it is in the audit row.
    const audit = dbMock.writesTo(schema.auditEvents)[0]!.arg("values") as {
      meta: { droppedRoleAssignments: unknown };
    };
    expect(audit.meta.droppedRoleAssignments).toEqual(dropped);
  });

  it("comes back on NO camp shifts: leftover spots deleted, requests to them cancelled, same transaction (epic #57)", async () => {
    dbMock.queue([archived()], [{ id: M_REN }], /* no roles held */ [], []);
    expect(await restoreMember(input())).toEqual({ ok: true });

    const writes = dbMock.writesTo(schema.shiftAssignments);
    const deletes = writes.filter((q) => q.kind === "delete");
    const cleared = writes.filter((q) => q.kind === "update");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.tx).toBe(true);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.tx).toBe(true);
    expect(cleared[0]!.arg("set")).toEqual({ handoverToMembershipId: null });
    // Both are keyed by a sub-select of THIS person's now-active membership
    // of THIS camp (the roles' sub-select is the other one).
    const scope = dbMock
      .queriesTouching(schema.memberships)
      .filter((q) => q.kind === "select" && q.tx);
    expect(scope).toHaveLength(2);
    for (const q of scope) {
      expect(boundStrings(q)).toEqual(expect.arrayContaining([REN, CAMP]));
      expect(nullChecksOn(q, schema.memberships.archivedAt)).toEqual([
        "is null",
      ]);
    }
  });

  it("touches no shift rows when the restore lost its compare-and-set", async () => {
    dbMock.queue([archived()], /* CAS matched nothing */ []);
    expect((await restoreMember(input())).ok).toBe(false);
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("brings a former CO-LEAD back as a plain member — the restorer hands back no structural role", async () => {
    dbMock.queue(
      [archived({ userId: JABU, role: ADMIN })],
      [{ id: M_REN }],
      [],
      [],
    );
    expect(await restoreMember(input())).toEqual({ ok: true });
    const [cas] = dbMock.writesTo(schema.memberships);
    expect((cas!.arg("set") as { role: unknown }).role).toBe(MEMBER);
    // Compare-and-set still judges the role that was decided on.
    expect(boundStrings(cas!)).toContain(ADMIN);
    expect(
      (
        dbMock.writesTo(schema.auditEvents)[0]!.arg("values") as {
          meta: Record<string, unknown>;
        }
      ).meta,
    ).toMatchObject({ previousRole: ADMIN, role: MEMBER });
  });

  it("writes no role deletion when the row changed underneath", async () => {
    dbMock.queue([archived()], /* CAS matched nothing */ []);
    expect((await restoreMember(input())).ok).toBe(false);
    expect(dbMock.writesTo(schema.memberRoleAssignments)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
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
