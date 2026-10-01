import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@quagga/db";
import { MembershipRole, NotificationKind } from "@quagga/types";
import {
  boundStrings,
  dbMock,
  nullChecksOn,
  uniqueViolation,
} from "@/test/db-mock";

// Camp shifts (epic #57) — the store's WRITES. What these pin is the decision
// (who is refused, and that a refusal writes nothing), that the facts come
// from the database and not the request, that every write runs in ONE
// transaction behind a `FOR UPDATE` on the shift row, and that notices go out
// only after commit. The db mock cannot see a WHERE clause beyond what
// `boundStrings` / `nullChecksOn` read off it; the Playwright spec
// (e2e/specs/camp-lead/shifts.spec.ts) drives the real SQL.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const {
  addShiftTeam,
  assignToShift,
  createShifts,
  deleteShift,
  ensureStarterTeams,
  getShiftTileSummary,
  handShiftTo,
  leaveShift,
  listShiftTeams,
  loadShiftBoard,
  offerShift,
  removeShiftTeam,
  renameShiftTeam,
  respondToHandOn,
  signUpForShift,
  takeOfferedShift,
  unassignFromShift,
  updateShift,
  withdrawHandOn,
} = await import("../shifts-store");

// Values from the real vocabularies (AGENTS.md "Verification"). Ids fictional.
const LEAD = MembershipRole.enum.lead;
const ADMIN = MembershipRole.enum.admin;
const MEMBER = MembershipRole.enum.member;
const SHIFT_KIND = NotificationKind.enum.shift;
const OPEN = schema.shiftSignupModeEnum.enumValues[0]; // "open"
const ASSIGN = schema.shiftSignupModeEnum.enumValues[1]; // "assign"

const CAMP = "11111111-0000-4000-8000-00000000000a";
const EDITION = "eeeeeeee-0000-4000-8000-000000000001";
const SHIFT = "55555555-0000-4000-8000-000000000001";
const SOUND = "0b0b0b0b-0000-4000-8000-000000000001";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead
const JABU = "aaaaaaaa-0000-4000-8000-000000000002"; // member, holder
const LERATO = "aaaaaaaa-0000-4000-8000-000000000003"; // member
const REN = "aaaaaaaa-0000-4000-8000-000000000004"; // co-lead
const M = {
  [ALICE]: "22222222-0000-4000-8000-000000000001",
  [JABU]: "22222222-0000-4000-8000-000000000002",
  [LERATO]: "22222222-0000-4000-8000-000000000003",
  [REN]: "22222222-0000-4000-8000-000000000004",
} as const;
const NAME: Record<string, string> = {
  [ALICE]: "alice",
  [JABU]: "jabu",
  [LERATO]: "lerato",
  [REN]: "ren",
};
const ROLE: Record<string, MembershipRole> = {
  [ALICE]: LEAD,
  [JABU]: MEMBER,
  [LERATO]: MEMBER,
  [REN]: ADMIN,
};

const actorRow = (userId: string) => ({
  membershipId: M[userId as keyof typeof M],
  userId,
  role: ROLE[userId],
  username: NAME[userId],
  sanitizedAt: null,
});

const shiftRow = (overrides: Record<string, unknown> = {}) => ({
  id: SHIFT,
  name: "Kitchen · lunch",
  date: "2027-04-29",
  startMinute: 720,
  durationMinutes: 180,
  capacity: 2,
  signupMode: OPEN,
  teamId: null,
  teamName: null,
  requiredRoleId: null,
  requiredRoleName: null,
  ...overrides,
});

const assignment = (
  userId: string,
  extra: { offeredAt?: Date | null; handoverTo?: string | null } = {},
) => ({
  id: `a-${NAME[userId]}`,
  shiftId: SHIFT,
  membershipId: M[userId as keyof typeof M],
  offeredAt: extra.offeredAt ?? null,
  handoverTo: extra.handoverTo ?? null,
  createdAt: new Date("2027-04-01T00:00:00Z"),
});

/**
 * Queue what the database answers for one write: the membership lock (the
 * caller, plus — for an assign or a hand-to — the other party: `parties`,
 * default just the caller), the shift lock, the camp's active members (+ roles
 * held), and the camp's shifts (+ assignments) — the order the store reads
 * them in.
 */
function queueLocked(input: {
  actor: string | null;
  parties?: string[];
  members?: string[];
  held?: { userId: string; roleId: string }[];
  shift?: Record<string, unknown> | null;
  assignments?: ReturnType<typeof assignment>[];
  /** More of the camp's shifts this edition (for the clash checks). */
  otherShifts?: Record<string, unknown>[];
}) {
  const members = input.members ?? [ALICE, JABU, LERATO, REN];
  const parties = input.parties ?? (input.actor ? [input.actor] : []);
  dbMock.queue(parties.map(actorRow));
  if (input.shift === null) {
    dbMock.queue([]);
    return;
  }
  dbMock.queue(
    [{ id: SHIFT }],
    members.map(actorRow),
    (input.held ?? []).map((h) => ({
      membershipId: M[h.userId as keyof typeof M],
      projectRoleId: h.roleId,
    })),
    [shiftRow(input.shift ?? {}), ...(input.otherShifts ?? []).map(shiftRow)],
    input.assignments ?? [],
  );
}

const base = { groupId: CAMP, editionId: EDITION, shiftId: SHIFT };

function shiftInserts() {
  return dbMock
    .writesTo(schema.shiftAssignments)
    .filter((q) => q.kind === "insert");
}

function notices(): { userId: string; kind: string; title: string }[] {
  return dbMock
    .writesTo(schema.notifications)
    .flatMap((q) => q.arg("values") as { userId: string; kind: string; title: string }[]);
}

beforeEach(() => dbMock.reset());

describe("signUpForShift", () => {
  it("refuses a caller with no ACTIVE membership, and writes nothing", async () => {
    queueLocked({ actor: null });
    const result = await signUpForShift({ userId: LERATO, ...base });
    expect(result).toEqual({
      ok: false,
      error: "Only members of this camp can be on its shifts.",
    });
    expect(shiftInserts()).toHaveLength(0);
    // The caller's membership is read through activeMembership(): a former
    // member resolves to no membership at all.
    const actorRead = dbMock.queries[0]!;
    expect(nullChecksOn(actorRead, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);
  });

  it("puts the caller on — their membership from the DB — in one transaction, behind a shift lock", async () => {
    queueLocked({ actor: LERATO });
    expect(await signUpForShift({ userId: LERATO, ...base })).toEqual({
      ok: true,
    });
    expect(dbMock.transactions).toBe(1);
    const [insert] = shiftInserts();
    expect(insert!.tx).toBe(true);
    expect(insert!.arg("values")).toEqual({
      shiftId: SHIFT,
      membershipId: M[LERATO],
      assignedByUserId: null,
    });
    // The lock: FOR UPDATE on the shift, scoped to THIS camp and edition.
    const lock = dbMock.queries[1]!;
    expect(lock.arg("for")).toBe("update");
    expect(boundStrings(lock)).toEqual(
      expect.arrayContaining([SHIFT, CAMP, EDITION]),
    );
  });

  it("refuses a full shift", async () => {
    queueLocked({
      actor: LERATO,
      assignments: [assignment(JABU), assignment(REN)],
    });
    const result = await signUpForShift({ userId: LERATO, ...base });
    expect(result).toEqual({ ok: false, error: "That shift is full." });
    expect(shiftInserts()).toHaveLength(0);
  });

  it("refuses a shift that needs a camp role the caller doesn't hold, naming it", async () => {
    queueLocked({
      actor: LERATO,
      shift: { requiredRoleId: SOUND, requiredRoleName: "Sound Officer" },
      held: [{ userId: JABU, roleId: SOUND }],
    });
    const result = await signUpForShift({ userId: LERATO, ...base });
    expect(result).toEqual({
      ok: false,
      error: "This shift needs the Sound Officer role.",
    });
    expect(shiftInserts()).toHaveLength(0);
  });

  it("refuses a shift that is not this camp's (the lock finds nothing)", async () => {
    queueLocked({ actor: LERATO, shift: null });
    const result = await signUpForShift({ userId: LERATO, ...base });
    expect(result.ok).toBe(false);
    expect(shiftInserts()).toHaveLength(0);
  });

  it("reads only ACTIVE members' assignments", async () => {
    queueLocked({ actor: LERATO });
    await signUpForShift({ userId: LERATO, ...base });
    const read = dbMock
      .queriesTouching(schema.shiftAssignments)
      .find((q) => q.kind === "select");
    expect(nullChecksOn(read!, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);
  });
});

describe("assignToShift", () => {
  it("refuses a plain member, and writes neither a spot nor an audit row", async () => {
    queueLocked({ actor: JABU });
    const result = await assignToShift({
      actorUserId: JABU,
      membershipId: M[LERATO],
      ...base,
    });
    expect(result).toEqual({
      ok: false,
      error: "Only the camp's leads can change shifts.",
    });
    expect(shiftInserts()).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
    expect(notices()).toHaveLength(0);
  });

  it("refuses a membership that is not an ACTIVE member of this camp", async () => {
    // A former member (or another camp's membership id) is not in the active
    // member list the store read, so it resolves to no member.
    queueLocked({ actor: ALICE, members: [ALICE, JABU] });
    const result = await assignToShift({
      actorUserId: ALICE,
      membershipId: M[LERATO],
      ...base,
    });
    expect(result.ok).toBe(false);
    expect(shiftInserts()).toHaveLength(0);
  });

  it("lets a lead assign, audits it, and tells the member after commit", async () => {
    queueLocked({ actor: ALICE, parties: [ALICE, LERATO] });
    dbMock.queue(/* insert */ [], /* audit */ [], [
      { name: "Camp 404", slug: "camp-404" },
    ]);
    expect(
      await assignToShift({
        actorUserId: ALICE,
        membershipId: M[LERATO],
        ...base,
      }),
    ).toEqual({ ok: true });
    const [insert] = shiftInserts();
    expect(insert!.arg("values")).toEqual({
      shiftId: SHIFT,
      membershipId: M[LERATO],
      assignedByUserId: ALICE,
    });
    const [audit] = dbMock.writesTo(schema.auditEvents);
    expect(audit!.tx).toBe(true);
    expect(audit!.arg("values")).toMatchObject({
      actorId: ALICE,
      action: "camp.shift.assign",
      subject: LERATO,
    });
    // After commit: a separate, non-transactional insert.
    const write = dbMock.writesTo(schema.notifications)[0]!;
    expect(write.tx).toBe(false);
    expect(notices()).toEqual([
      expect.objectContaining({
        userId: LERATO,
        kind: SHIFT_KIND,
        title: "alice put you on Kitchen · lunch on Thu 29 Apr, 12:00–15:00",
      }),
    ]);
  });
});

describe("takeOfferedShift", () => {
  const offered = () => [
    assignment(JABU, { offeredAt: new Date("2027-04-20T00:00:00Z") }),
  ];

  it("moves the spot with a compare-and-set on it still being offered, and tells the holder and the leads", async () => {
    queueLocked({ actor: LERATO, assignments: offered() });
    dbMock.queue([{ id: "a-jabu" }], [{ name: "Camp 404", slug: "camp-404" }]);
    expect(
      await takeOfferedShift({
        userId: LERATO,
        assignmentId: "a-jabu",
        ...base,
      }),
    ).toEqual({ ok: true });

    const [cas] = dbMock
      .writesTo(schema.shiftAssignments)
      .filter((q) => q.kind === "update");
    expect(cas!.tx).toBe(true);
    expect(cas!.arg("set")).toEqual({
      membershipId: M[LERATO],
      offeredAt: null,
      handoverToMembershipId: null,
      assignedByUserId: null,
    });
    expect(nullChecksOn(cas!, schema.shiftAssignments.offeredAt)).toEqual([
      "is not null",
    ]);

    const sent = notices();
    expect(sent.map((n) => n.userId).sort()).toEqual([ALICE, JABU, REN].sort());
    expect(sent.find((n) => n.userId === JABU)!.title).toBe(
      "lerato took your Kitchen · lunch on Thu 29 Apr from Open shifts — it's theirs now",
    );
    expect(sent.find((n) => n.userId === ALICE)!.title).toBe(
      "Kitchen · lunch on Thu 29 Apr changed hands — jabu to lerato",
    );
    // The taker is not notified about their own action.
    expect(sent.some((n) => n.userId === LERATO)).toBe(false);
  });

  it("a co-lead who takes a shift is not also sent the leads' changed-hands notice", async () => {
    queueLocked({ actor: REN, assignments: offered() });
    dbMock.queue([{ id: "a-jabu" }], [{ name: "Camp 404", slug: "camp-404" }]);
    expect(
      await takeOfferedShift({ userId: REN, assignmentId: "a-jabu", ...base }),
    ).toEqual({ ok: true });
    const sent = notices();
    // Jabu hears it moved; Alice (the other lead) hears it changed hands;
    // Ren did it and hears nothing.
    expect(sent.map((n) => n.userId).sort()).toEqual([ALICE, JABU].sort());
  });

  it("the second taker loses: a lost compare-and-set notifies nobody", async () => {
    queueLocked({ actor: LERATO, assignments: offered() });
    dbMock.queue(/* CAS matched nothing */ []);
    const result = await takeOfferedShift({
      userId: LERATO,
      assignmentId: "a-jabu",
      ...base,
    });
    expect(result).toEqual({
      ok: false,
      error: "Someone already took that shift, or it was taken back.",
    });
    expect(notices()).toHaveLength(0);
  });

  it("refuses a spot that is not offered", async () => {
    queueLocked({ actor: LERATO, assignments: [assignment(JABU)] });
    const result = await takeOfferedShift({
      userId: LERATO,
      assignmentId: "a-jabu",
      ...base,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });
});

describe("hand to someone", () => {
  it("refuses handing to a former member (not in the active list)", async () => {
    queueLocked({
      actor: JABU,
      members: [ALICE, JABU],
      assignments: [assignment(JABU)],
    });
    const result = await handShiftTo({
      userId: JABU,
      toMembershipId: M[LERATO],
      ...base,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("refuses someone who is not on the shift", async () => {
    queueLocked({ actor: REN, assignments: [assignment(JABU)] });
    const result = await handShiftTo({
      userId: REN,
      toMembershipId: M[LERATO],
      ...base,
    });
    expect(result).toEqual({ ok: false, error: "You're not on that shift." });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("records the request on the holder's own row and tells the campmate", async () => {
    queueLocked({
      actor: JABU,
      parties: [JABU, LERATO],
      assignments: [assignment(JABU)],
    });
    dbMock.queue([], [{ name: "Camp 404", slug: "camp-404" }]);
    expect(
      await handShiftTo({ userId: JABU, toMembershipId: M[LERATO], ...base }),
    ).toEqual({ ok: true });
    const [update] = dbMock.writesTo(schema.shiftAssignments);
    expect(update!.arg("set")).toEqual({
      offeredAt: null,
      handoverToMembershipId: M[LERATO],
    });
    // Scoped to the holder's own membership, never a row id alone.
    expect(boundStrings(update!)).toEqual(
      expect.arrayContaining(["a-jabu", M[JABU]]),
    );
    expect(notices()).toEqual([
      expect.objectContaining({
        userId: LERATO,
        title: "jabu wants to hand you Kitchen · lunch on Thu 29 Apr, 12:00–15:00",
      }),
    ]);
  });

  it("only the person it was handed to can accept it", async () => {
    queueLocked({
      actor: REN,
      assignments: [assignment(JABU, { handoverTo: M[LERATO] })],
    });
    const result = await respondToHandOn({ userId: REN, accept: true, ...base });
    expect(result).toEqual({
      ok: false,
      error: "That request was withdrawn or already answered.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("accepting moves the spot (compare-and-set on the request) and tells the holder and the leads", async () => {
    queueLocked({
      actor: LERATO,
      assignments: [assignment(JABU, { handoverTo: M[LERATO] })],
    });
    dbMock.queue([{ name: "Camp 404", slug: "camp-404" }], [{ id: "a-jabu" }]);
    expect(
      await respondToHandOn({ userId: LERATO, accept: true, ...base }),
    ).toEqual({ ok: true });
    const [cas] = dbMock.writesTo(schema.shiftAssignments);
    expect(cas!.arg("set")).toMatchObject({
      membershipId: M[LERATO],
      handoverToMembershipId: null,
    });
    expect(boundStrings(cas!)).toEqual(
      expect.arrayContaining(["a-jabu", M[LERATO]]),
    );
    const sent = notices();
    expect(sent.find((n) => n.userId === JABU)!.title).toBe(
      "lerato accepted your Kitchen · lunch on Thu 29 Apr — it's theirs now",
    );
    expect(sent.filter((n) => n.title.includes("changed hands")).map((n) => n.userId).sort()).toEqual(
      [ALICE, REN].sort(),
    );
  });

  it("declining clears the request and tells the holder it's still theirs", async () => {
    queueLocked({
      actor: LERATO,
      assignments: [assignment(JABU, { handoverTo: M[LERATO] })],
    });
    dbMock.queue([{ name: "Camp 404", slug: "camp-404" }]);
    expect(
      await respondToHandOn({ userId: LERATO, accept: false, ...base }),
    ).toEqual({ ok: true });
    const [update] = dbMock.writesTo(schema.shiftAssignments);
    expect(update!.arg("set")).toEqual({ handoverToMembershipId: null });
    expect(notices()).toEqual([
      expect.objectContaining({
        userId: JABU,
        title: "lerato declined Kitchen · lunch on Thu 29 Apr — it's still yours",
      }),
    ]);
  });
});

describe("lead edits", () => {
  const edition = {
    id: EDITION,
    startDate: "2027-04-26",
    endDate: "2027-05-02",
  };
  const fields = {
    id: SHIFT,
    name: "Kitchen · lunch",
    teamId: null,
    date: "2027-04-29",
    startMinute: 720,
    durationMinutes: 180,
    capacity: 2,
    requiredRoleId: null,
    signupMode: "open" as const,
  };

  it("tells everyone on the shift when its time moves — not the lead who moved it", async () => {
    queueLocked({
      actor: ALICE,
      assignments: [assignment(JABU), assignment(ALICE)],
    });
    dbMock.queue(/* update */ [], /* audit */ [], [
      { name: "Camp 404", slug: "camp-404" },
    ]);
    expect(
      await updateShift({
        actorUserId: ALICE,
        groupId: CAMP,
        edition,
        fields: { ...fields, startMinute: 960 },
      }),
    ).toEqual({ ok: true });
    expect(notices()).toEqual([
      expect.objectContaining({
        userId: JABU,
        title:
          "alice moved Kitchen · lunch on Thu 29 Apr to Thu 29 Apr, 16:00–19:00",
      }),
    ]);
  });

  it("sends nothing when the day and time did not change", async () => {
    queueLocked({ actor: ALICE, assignments: [assignment(JABU)] });
    await updateShift({
      actorUserId: ALICE,
      groupId: CAMP,
      edition,
      fields: { ...fields, name: "Kitchen · brunch" },
    });
    expect(notices()).toHaveLength(0);
  });

  it("refuses shrinking a shift below the people already on it", async () => {
    queueLocked({
      actor: ALICE,
      assignments: [assignment(JABU), assignment(LERATO)],
    });
    const result = await updateShift({
      actorUserId: ALICE,
      groupId: CAMP,
      edition,
      fields: { ...fields, capacity: 1 },
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(0);
  });

  it("refuses a day outside the burn before touching the database", async () => {
    const result = await updateShift({
      actorUserId: ALICE,
      groupId: CAMP,
      edition,
      fields: { ...fields, date: "2027-06-01" },
    });
    expect(result.ok).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("refuses a plain member deleting a shift", async () => {
    dbMock.queue([actorRow(JABU)]);
    const result = await deleteShift({
      actorUserId: JABU,
      groupId: CAMP,
      editionId: EDITION,
      shiftId: SHIFT,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(0);
  });
});

// --- Review findings (adversarial review, epic #57) ------------------------
// Each block below was mutation-checked: revert the fix it names and it goes
// red. The mock cannot run two transactions at once, so what is pinned is the
// LOCK the store takes (which statement, which rows, which strength, and that
// it comes BEFORE the shift lock) and that the store trusts only what that
// lock returned.

/** The first statement of the write: the membership lock. */
function membershipLock() {
  return dbMock.queries[0]!;
}

/** `boundStrings`, minus its depth cap: the lock's `or(userId, id IN …)`
 * nests the membership ids deeper than the shared helper walks. */
function deepBound(query: { calls: { args: unknown[] }[] }): string[] {
  const found: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (value: unknown, depth: number) => {
    if (depth > 40) return;
    if (typeof value === "string") {
      found.push(value);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if (seen.has(value)) return;
    seen.add(value);
    for (const inner of Object.values(value)) walk(inner, depth + 1);
  };
  for (const call of query.calls) walk(call.args, 0);
  return found;
}

/** The shift row lock: the first `FOR UPDATE` touching `shifts`. */
function shiftLockIndex(): number {
  return dbMock.queries.findIndex(
    (q) =>
      q.kind === "select" &&
      q.arg("for") === "update" &&
      q.calls.some((c) => c.args.includes(schema.shifts)),
  );
}

describe("M1/M2 — every party's membership is locked before the shift", () => {
  const offered = () => [
    assignment(JABU, { offeredAt: new Date("2027-04-20T00:00:00Z") }),
  ];

  const writes: [string, () => Promise<unknown>, () => void, string[]][] = [
    [
      "assignToShift (the lead AND the member put on)",
      () => assignToShift({ actorUserId: ALICE, membershipId: M[LERATO], ...base }),
      () => queueLocked({ actor: ALICE, parties: [ALICE, LERATO] }),
      [ALICE, M[LERATO]],
    ],
    [
      "handShiftTo (the holder AND the campmate)",
      () => handShiftTo({ userId: JABU, toMembershipId: M[LERATO], ...base }),
      () =>
        queueLocked({
          actor: JABU,
          parties: [JABU, LERATO],
          assignments: [assignment(JABU)],
        }),
      [JABU, M[LERATO]],
    ],
    [
      "signUpForShift",
      () => signUpForShift({ userId: LERATO, ...base }),
      () => queueLocked({ actor: LERATO }),
      [LERATO],
    ],
    [
      "respondToHandOn (accept)",
      () => respondToHandOn({ userId: LERATO, accept: true, ...base }),
      () =>
        queueLocked({
          actor: LERATO,
          assignments: [assignment(JABU, { handoverTo: M[LERATO] })],
        }),
      [LERATO],
    ],
    [
      "takeOfferedShift",
      () => takeOfferedShift({ userId: LERATO, assignmentId: "a-jabu", ...base }),
      () => queueLocked({ actor: LERATO, assignments: offered() }),
      [LERATO],
    ],
  ];

  for (const [name, run, queue, bound] of writes) {
    it(`${name}: FOR NO KEY UPDATE on the memberships, active only, before the shift lock`, async () => {
      queue();
      await run();
      const lock = membershipLock();
      expect(lock.kind).toBe("select");
      expect(lock.tx).toBe(true);
      // Conflicts with an archive's UPDATE (M1) AND with itself (M2) — FOR
      // SHARE would let two sign-ups for one member through together.
      expect(lock.arg("for")).toBe("no key update");
      expect(lock.called("orderBy")).toBe(true);
      expect(deepBound(lock)).toEqual(expect.arrayContaining([CAMP, ...bound]));
      expect(nullChecksOn(lock, schema.memberships.archivedAt)).toEqual([
        "is null",
      ]);
      // Lock order: memberships, THEN the shift.
      expect(shiftLockIndex()).toBeGreaterThan(0);
    });
  }

  it("assignToShift refuses a member the lock did not return (archived while it waited), even if a stale list still has them", async () => {
    queueLocked({ actor: ALICE, parties: [ALICE] });
    const result = await assignToShift({
      actorUserId: ALICE,
      membershipId: M[LERATO],
      ...base,
    });
    expect(result).toEqual({
      ok: false,
      error: "Only members of this camp can be on its shifts.",
    });
    expect(shiftInserts()).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("handShiftTo refuses a campmate the lock did not return, and writes no request", async () => {
    queueLocked({
      actor: JABU,
      parties: [JABU],
      assignments: [assignment(JABU)],
    });
    const result = await handShiftTo({
      userId: JABU,
      toMembershipId: M[LERATO],
      ...base,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
    expect(notices()).toHaveLength(0);
  });
});

describe("deleted (sanitised) accounts are nobody on a shift", () => {
  it("the member list excludes them", async () => {
    queueLocked({ actor: LERATO });
    await signUpForShift({ userId: LERATO, ...base });
    const memberRead = dbMock.queries.find(
      (q) =>
        q.kind === "select" &&
        q !== dbMock.queries[0] &&
        q.calls.some((c) => c.args.includes(schema.memberships)) &&
        !q.called("for"),
    )!;
    expect(nullChecksOn(memberRead, schema.users.sanitizedAt)).toEqual([
      "is null",
    ]);
  });

  it("a lead cannot assign a sanitised account even when the lock returns its row", async () => {
    // The lock returns the target's row with sanitized_at set.
    dbMock.queue([
      actorRow(ALICE),
      { ...actorRow(LERATO), sanitizedAt: new Date("2027-01-01") },
    ]);
    dbMock.queue(
      [{ id: SHIFT }],
      [ALICE, JABU, LERATO, REN].map(actorRow),
      [],
      [shiftRow()],
      [],
    );
    const result = await assignToShift({
      actorUserId: ALICE,
      membershipId: M[LERATO],
      ...base,
    });
    expect(result.ok).toBe(false);
    expect(shiftInserts()).toHaveLength(0);
  });
});

describe("cross-camp ids answer like ids that do not exist", () => {
  const edition = {
    id: EDITION,
    startDate: "2027-04-26",
    endDate: "2027-05-02",
  };
  const fields = {
    name: "Kitchen · lunch",
    teamId: "7e7e7e7e-0000-4000-8000-000000000001",
    dates: ["2027-04-29"],
    startMinute: 720,
    durationMinutes: 180,
    capacity: 2,
    requiredRoleId: null,
    signupMode: OPEN,
  };

  it("refuses another camp's team on a new shift — the lookup is scoped to THIS camp", async () => {
    dbMock.queue([actorRow(ALICE)], /* team not in this camp */ []);
    const result = await createShifts({
      actorUserId: ALICE,
      groupId: CAMP,
      edition,
      fields,
    });
    expect(result).toEqual({ ok: false, error: "That team doesn't exist any more." });
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(0);
    const lookup = dbMock.queriesTouching(schema.shiftTeams)[0]!;
    expect(boundStrings(lookup)).toEqual(
      expect.arrayContaining([fields.teamId, CAMP]),
    );
  });

  it("refuses another camp's role as a shift's required role", async () => {
    dbMock.queue([actorRow(ALICE)], /* role not in this camp */ []);
    const result = await createShifts({
      actorUserId: ALICE,
      groupId: CAMP,
      edition,
      fields: { ...fields, teamId: null, requiredRoleId: SOUND },
    });
    expect(result).toEqual({
      ok: false,
      error: "That camp role doesn't exist any more.",
    });
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(0);
    const lookup = dbMock.queriesTouching(schema.projectRoles)[0]!;
    expect(boundStrings(lookup)).toEqual(expect.arrayContaining([SOUND, CAMP]));
  });

  it("renaming another camp's team changes nothing", async () => {
    dbMock.queue([actorRow(ALICE)], /* no row in this camp */ []);
    const result = await renameShiftTeam({
      actorUserId: ALICE,
      groupId: CAMP,
      teamId: fields.teamId,
      name: "Sound",
    });
    expect(result).toEqual({ ok: false, error: "That team doesn't exist any more." });
    const [update] = dbMock.writesTo(schema.shiftTeams);
    expect(boundStrings(update!)).toEqual(
      expect.arrayContaining([fields.teamId, CAMP]),
    );
  });

  it("removing another camp's team deletes nothing", async () => {
    dbMock.queue([actorRow(ALICE)], /* no row in this camp */ []);
    const result = await removeShiftTeam({
      actorUserId: ALICE,
      groupId: CAMP,
      teamId: fields.teamId,
    });
    expect(result).toEqual({ ok: false, error: "That team doesn't exist any more." });
    const [del] = dbMock.writesTo(schema.shiftTeams);
    expect(boundStrings(del!)).toEqual(
      expect.arrayContaining([fields.teamId, CAMP]),
    );
  });

  it("a team is added to the caller's own camp, never one named in the request", async () => {
    dbMock.queue([actorRow(ALICE)], [{ n: 0 }], [{ id: "t-new" }]);
    expect(
      await addShiftTeam({ actorUserId: ALICE, groupId: CAMP, name: "Sound" }),
    ).toEqual({ ok: true, id: "t-new" });
    const insert = dbMock
      .writesTo(schema.shiftTeams)
      .find((q) => q.kind === "insert")!;
    expect(insert.arg("values")).toMatchObject({ groupId: CAMP });
  });

  it("assigning onto another camp's shift: the scoped shift lock finds nothing", async () => {
    queueLocked({ actor: ALICE, parties: [ALICE, LERATO], shift: null });
    const result = await assignToShift({
      actorUserId: ALICE,
      membershipId: M[LERATO],
      ...base,
    });
    expect(result).toEqual({ ok: false, error: "That shift doesn't exist." });
    expect(shiftInserts()).toHaveLength(0);
    expect(boundStrings(dbMock.queries[shiftLockIndex()]!)).toEqual(
      expect.arrayContaining([SHIFT, CAMP, EDITION]),
    );
  });
});

describe("getShiftTileSummary — the camp page tile", () => {
  const rows = [
    // open-mode: 1 of 3 filled → 2 open
    { date: "2027-04-28", capacity: 3, signupMode: OPEN, teamName: "Kitchen", filled: 1 },
    // lead-only: 0 of 2 filled → 2 gaps a member cannot sign up for
    { date: "2027-04-29", capacity: 2, signupMode: ASSIGN, teamName: "Sound", filled: 0 },
  ];

  it("a member's count is only spots they could sign up for", async () => {
    dbMock.queue(rows);
    const summary = await getShiftTileSummary(CAMP, EDITION, {
      canManage: false,
    });
    expect(summary).toMatchObject({
      shifts: 2,
      open: 2,
      firstDate: "2027-04-28",
      lastDate: "2027-04-29",
    });
  });

  it("a lead's count is every gap", async () => {
    dbMock.queue(rows);
    const summary = await getShiftTileSummary(CAMP, EDITION, {
      canManage: true,
    });
    expect(summary.open).toBe(4);
  });

  it("counts filled spots as the board does: this camp's members only", async () => {
    dbMock.queue([]);
    await getShiftTileSummary(CAMP, EDITION, { canManage: true });
    // CAMP is bound inside the filled-count subquery as well as the outer
    // WHERE — twice, not once.
    expect(
      boundStrings(dbMock.queries[0]!).filter((v) => v === CAMP).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

// --- Coverage of the remaining store paths (PR #86) -------------------------
// Each block pins a decision the store owns: the refusal a caller sees, and
// that a refusal writes nothing.

const OTHER_SHIFT = "55555555-0000-4000-8000-000000000002";
const TEAM = "7e7e7e7e-0000-4000-8000-000000000009";
const CAMP_ROW = { name: "Camp 404", slug: "camp-404" };
const burn = { id: EDITION, startDate: "2027-04-26", endDate: "2027-05-02" };

/** An assignment on the camp's OTHER shift (for the clash checks). */
const onOther = (userId: string) => ({
  ...assignment(userId),
  id: `other-${NAME[userId]}`,
  shiftId: OTHER_SHIFT,
});

/** Overlaps Kitchen · lunch (12:00–15:00) on the same day. */
const overlapping = {
  id: OTHER_SHIFT,
  name: "Tea bar",
  startMinute: 780,
  durationMinutes: 120,
};

describe("loadShiftBoard — what the Shifts pages render", () => {
  it("lists active members with their camp roles, and hides assignments and requests naming anyone outside them", async () => {
    const FORMER = "22222222-0000-4000-8000-0000000000ff";
    dbMock.queue(
      /* members */ [actorRow(LERATO), actorRow(ALICE), actorRow(JABU)],
      /* teams */ [{ id: TEAM, name: "Kitchen" }],
      /* held roles */ [{ membershipId: M[JABU], projectRoleId: SOUND }],
      /* shifts */ [shiftRow()],
      /* assignments */ [
        assignment(JABU, { handoverTo: M[LERATO] }),
        // A former member's spot: not in the active list, so not on the board.
        { ...assignment(REN), membershipId: FORMER },
        // A request to someone no longer a member reads as no request.
        assignment(ALICE, { handoverTo: FORMER }),
      ],
    );
    const board = await loadShiftBoard(CAMP, EDITION);

    expect(board.teams).toEqual([{ id: TEAM, name: "Kitchen" }]);
    // Sorted by display name; held roles only where held.
    expect(board.members.map((m) => [m.displayName, m.heldRoleIds])).toEqual([
      ["alice", []],
      ["jabu", [SOUND]],
      ["lerato", []],
    ]);
    const [shift] = board.shifts;
    expect(shift!.assignments).toEqual([
      {
        id: "a-jabu",
        membershipId: M[JABU],
        userId: JABU,
        displayName: "jabu",
        offered: false,
        handoverTo: { membershipId: M[LERATO], displayName: "lerato" },
      },
      expect.objectContaining({ id: "a-alice", handoverTo: null }),
    ]);
  });

  it("a camp with no members and no shifts reads nothing further", async () => {
    dbMock.queue([], [], []);
    expect(await loadShiftBoard(CAMP, EDITION)).toEqual({
      shifts: [],
      members: [],
      teams: [],
    });
    // members + teams + shifts; no held-roles read, no assignments read.
    expect(dbMock.queries).toHaveLength(3);
  });

  it("listShiftTeams reads this camp's teams only", async () => {
    dbMock.queue([{ id: TEAM, name: "Sound" }]);
    expect(await listShiftTeams(CAMP)).toEqual([{ id: TEAM, name: "Sound" }]);
    expect(boundStrings(dbMock.queries[0]!)).toContain(CAMP);
  });
});

describe("ensureStarterTeams — seeded once per camp", () => {
  it("a camp already seeded is never handed the list again", async () => {
    dbMock.queue([{ seededAt: new Date("2027-01-01") }]);
    await ensureStarterTeams(CAMP);
    expect(dbMock.transactions).toBe(0);
    expect(dbMock.writesTo(schema.shiftTeams)).toHaveLength(0);
  });

  it("an unknown camp gets nothing", async () => {
    dbMock.queue([]);
    await ensureStarterTeams(CAMP);
    expect(dbMock.transactions).toBe(0);
    expect(dbMock.writesTo(schema.shiftTeams)).toHaveLength(0);
  });

  it("the lead who wins the compare-and-set writes the starter list, in order", async () => {
    dbMock.queue([{ seededAt: null }], /* claimed */ [{ id: CAMP }]);
    await ensureStarterTeams(CAMP);
    const [claim] = dbMock.writesTo(schema.groups);
    expect(nullChecksOn(claim!, schema.groups.shiftTeamsSeededAt)).toEqual([
      "is null",
    ]);
    const [insert] = dbMock.writesTo(schema.shiftTeams);
    expect(insert!.tx).toBe(true);
    expect(insert!.called("onConflictDoNothing")).toBe(true);
    const values = insert!.arg("values") as {
      groupId: string;
      name: string;
      nameNormalized: string;
      sort: number;
    }[];
    expect(values[0]).toEqual({
      groupId: CAMP,
      name: "Kitchen",
      nameNormalized: "kitchen",
      sort: 0,
    });
    expect(values.map((v) => v.sort)).toEqual(values.map((_, i) => i));
  });

  it("the lead who loses the compare-and-set writes nothing", async () => {
    dbMock.queue([{ seededAt: null }], /* another lead claimed it */ []);
    await ensureStarterTeams(CAMP);
    expect(dbMock.writesTo(schema.shiftTeams)).toHaveLength(0);
  });
});

describe("createShifts", () => {
  const fields = {
    name: "Kitchen · lunch",
    teamId: TEAM,
    dates: ["2027-04-29", "2027-04-30", "2027-04-29"],
    startMinute: 720,
    durationMinutes: 180,
    capacity: 2,
    requiredRoleId: SOUND,
    signupMode: OPEN,
  };

  it("creates one shift per distinct day and audits the ids", async () => {
    dbMock.queue(
      [actorRow(ALICE)],
      /* team is this camp's */ [{ id: TEAM }],
      /* role is this camp's */ [{ id: SOUND }],
      /* inserted */ [{ id: "s1" }, { id: "s2" }],
    );
    expect(
      await createShifts({ actorUserId: ALICE, groupId: CAMP, edition: burn, fields }),
    ).toEqual({ ok: true, created: 2 });
    const [insert] = dbMock.writesTo(schema.shifts);
    const rows = insert!.arg("values") as { shiftDate: string; groupId: string }[];
    expect(rows.map((r) => r.shiftDate)).toEqual(["2027-04-29", "2027-04-30"]);
    expect(rows.every((r) => r.groupId === CAMP)).toBe(true);
    const [audit] = dbMock.writesTo(schema.auditEvents);
    expect(audit!.arg("values")).toMatchObject({
      action: "camp.shift.create",
      meta: { groupId: CAMP, shiftIds: ["s1", "s2"] },
    });
  });

  it("refuses a day outside the burn before touching the database", async () => {
    const result = await createShifts({
      actorUserId: ALICE,
      groupId: CAMP,
      edition: burn,
      fields: { ...fields, dates: ["2027-06-01"] },
    });
    expect(result).toEqual({ ok: false, error: "Pick at least one day of the burn." });
    expect(dbMock.queries).toHaveLength(0);
  });

  it("refuses a plain member, and writes nothing", async () => {
    dbMock.queue([actorRow(JABU)]);
    const result = await createShifts({
      actorUserId: JABU,
      groupId: CAMP,
      edition: burn,
      fields,
    });
    expect(result).toEqual({
      ok: false,
      error: "Only the camp's leads can change shifts.",
    });
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(0);
  });
});

describe("updateShift — refusals after the lock", () => {
  const fields = {
    id: SHIFT,
    name: "Kitchen · lunch",
    teamId: TEAM,
    date: "2027-04-29",
    startMinute: 720,
    durationMinutes: 180,
    capacity: 2,
    requiredRoleId: SOUND,
    signupMode: OPEN,
  };

  it("refuses a plain member", async () => {
    dbMock.queue([actorRow(JABU)]);
    const result = await updateShift({
      actorUserId: JABU,
      groupId: CAMP,
      edition: burn,
      fields,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(0);
  });

  it("a shift that is not this camp's answers as missing", async () => {
    queueLocked({ actor: ALICE, shift: null });
    const result = await updateShift({
      actorUserId: ALICE,
      groupId: CAMP,
      edition: burn,
      fields,
    });
    expect(result).toEqual({ ok: false, error: "That shift doesn't exist." });
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(0);
  });

  it("refuses moving it onto another camp's team", async () => {
    queueLocked({ actor: ALICE });
    dbMock.queue(/* team not in this camp */ []);
    const result = await updateShift({
      actorUserId: ALICE,
      groupId: CAMP,
      edition: burn,
      fields,
    });
    expect(result).toEqual({ ok: false, error: "That team doesn't exist any more." });
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(0);
  });

  it("refuses requiring another camp's role", async () => {
    queueLocked({ actor: ALICE });
    dbMock.queue([{ id: TEAM }], /* role not in this camp */ []);
    const result = await updateShift({
      actorUserId: ALICE,
      groupId: CAMP,
      edition: burn,
      fields,
    });
    expect(result).toEqual({
      ok: false,
      error: "That camp role doesn't exist any more.",
    });
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(0);
  });

  it("a failed notice never fails the change", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    queueLocked({ actor: ALICE, assignments: [assignment(JABU)] });
    dbMock.queue(
      [{ id: TEAM }],
      [{ id: SOUND }],
      /* update */ [],
      /* audit */ [],
      [CAMP_ROW],
      /* notification insert */ new Error("notifications down"),
    );
    const result = await updateShift({
      actorUserId: ALICE,
      groupId: CAMP,
      edition: burn,
      fields: { ...fields, startMinute: 960 },
    });
    expect(result).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(
      "[notifications] shift notice failed",
      expect.any(Error),
    );
    spy.mockRestore();
  });
});

describe("deleteShift", () => {
  const input = {
    actorUserId: ALICE,
    groupId: CAMP,
    editionId: EDITION,
    shiftId: SHIFT,
  };

  it("deletes inside this camp, audits it, and tells everyone on it but the lead", async () => {
    queueLocked({
      actor: ALICE,
      assignments: [assignment(JABU), assignment(ALICE)],
    });
    dbMock.queue(/* delete */ [], /* audit */ [], [CAMP_ROW]);
    expect(await deleteShift(input)).toEqual({ ok: true });
    const [del] = dbMock.writesTo(schema.shifts);
    expect(del!.kind).toBe("delete");
    expect(boundStrings(del!)).toEqual(expect.arrayContaining([SHIFT, CAMP]));
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject({
      action: "camp.shift.delete",
      meta: { shiftId: SHIFT },
    });
    expect(notices().map((n) => n.userId)).toEqual([JABU]);
  });

  it("a shift that is not this camp's answers as missing, and deletes nothing", async () => {
    queueLocked({ actor: ALICE, shift: null });
    expect(await deleteShift(input)).toEqual({
      ok: false,
      error: "That shift doesn't exist.",
    });
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(0);
  });

  it("the lock found the row but the shift is not in this edition's list: missing", async () => {
    dbMock.queue([actorRow(ALICE)], [{ id: SHIFT }], [actorRow(ALICE)], [], /* no shifts */ []);
    expect(await deleteShift(input)).toEqual({
      ok: false,
      error: "That shift doesn't exist.",
    });
    expect(dbMock.writesTo(schema.shifts)).toHaveLength(0);
  });
});

describe("unassignFromShift", () => {
  const input = (assignmentId: string, actorUserId = ALICE) => ({
    actorUserId,
    groupId: CAMP,
    editionId: EDITION,
    shiftId: SHIFT,
    assignmentId,
  });

  it("refuses a plain member, and deletes nothing", async () => {
    queueLocked({ actor: JABU, assignments: [assignment(LERATO)] });
    expect(await unassignFromShift(input("a-lerato", JABU))).toEqual({
      ok: false,
      error: "Only the camp's leads can change shifts.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("a shift that is not this camp's answers as missing", async () => {
    queueLocked({ actor: ALICE, shift: null });
    expect(await unassignFromShift(input("a-jabu"))).toEqual({
      ok: false,
      error: "That shift doesn't exist.",
    });
  });

  it("an assignment no longer on the shift is a stale page, and deletes nothing", async () => {
    queueLocked({ actor: ALICE, assignments: [assignment(JABU)] });
    expect(await unassignFromShift(input("a-lerato"))).toEqual({
      ok: false,
      error: "That shift changed while you were looking — refresh and try again.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("takes the member off (scoped to the shift), audits it, and tells them", async () => {
    queueLocked({ actor: ALICE, assignments: [assignment(JABU)] });
    dbMock.queue(/* delete */ [], /* audit */ [], [CAMP_ROW]);
    expect(await unassignFromShift(input("a-jabu"))).toEqual({ ok: true });
    const [del] = dbMock.writesTo(schema.shiftAssignments);
    expect(del!.kind).toBe("delete");
    expect(del!.tx).toBe(true);
    expect(boundStrings(del!)).toEqual(expect.arrayContaining(["a-jabu", SHIFT]));
    expect(dbMock.writesTo(schema.auditEvents)[0]!.arg("values")).toMatchObject({
      actorId: ALICE,
      action: "camp.shift.unassign",
      subject: JABU,
      meta: { membershipId: M[JABU] },
    });
    expect(notices()).toEqual([
      expect.objectContaining({ userId: JABU, kind: SHIFT_KIND }),
    ]);
  });

  it("a lead taking themselves off is not notified about it", async () => {
    queueLocked({ actor: ALICE, assignments: [assignment(ALICE)] });
    dbMock.queue([], [], [CAMP_ROW]);
    expect(await unassignFromShift(input("a-alice"))).toEqual({ ok: true });
    expect(notices()).toHaveLength(0);
  });
});

describe("leave, offer and withdraw — the holder's own spot", () => {
  const input = (userId: string) => ({ userId, ...base });

  for (const [name, run] of [
    ["leaveShift", leaveShift],
    ["offerShift", offerShift],
    ["withdrawHandOn", withdrawHandOn],
  ] as const) {
    it(`${name}: refuses a caller with no active membership`, async () => {
      dbMock.queue(/* lockActor finds nobody */ []);
      expect(await run(input(LERATO))).toEqual({
        ok: false,
        error: "Only members of this camp can be on its shifts.",
      });
      expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
    });

    it(`${name}: a shift that is not this camp's answers as missing`, async () => {
      queueLocked({ actor: LERATO, shift: null });
      expect(await run(input(LERATO))).toEqual({
        ok: false,
        error: "That shift doesn't exist.",
      });
    });

    it(`${name}: refuses someone who is not on the shift — even with someone else's spot there`, async () => {
      queueLocked({ actor: LERATO, assignments: [assignment(JABU)] });
      expect(await run(input(LERATO))).toEqual({
        ok: false,
        error: "You're not on that shift.",
      });
      expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
    });
  }

  it("leaveShift deletes only the caller's own row, and tells nobody", async () => {
    queueLocked({ actor: JABU, assignments: [assignment(LERATO), assignment(JABU)] });
    expect(await leaveShift(input(JABU))).toEqual({ ok: true });
    const [del] = dbMock.writesTo(schema.shiftAssignments);
    expect(del!.kind).toBe("delete");
    expect(boundStrings(del!)).toEqual(expect.arrayContaining(["a-jabu", M[JABU]]));
    expect(boundStrings(del!)).not.toContain("a-lerato");
    expect(notices()).toHaveLength(0);
  });

  it("offerShift marks the caller's spot offered and clears any pending hand-to", async () => {
    queueLocked({
      actor: JABU,
      assignments: [assignment(JABU, { handoverTo: M[LERATO] })],
    });
    expect(await offerShift(input(JABU))).toEqual({ ok: true });
    const [update] = dbMock.writesTo(schema.shiftAssignments);
    const set = update!.arg("set") as { offeredAt: unknown; handoverToMembershipId: unknown };
    expect(set.offeredAt).toBeInstanceOf(Date);
    expect(set.handoverToMembershipId).toBeNull();
    expect(boundStrings(update!)).toEqual(expect.arrayContaining(["a-jabu", M[JABU]]));
  });

  it("withdrawHandOn clears both the offer and the request on the caller's own row", async () => {
    queueLocked({
      actor: JABU,
      assignments: [assignment(JABU, { offeredAt: new Date("2027-04-20") })],
    });
    expect(await withdrawHandOn(input(JABU))).toEqual({ ok: true });
    const [update] = dbMock.writesTo(schema.shiftAssignments);
    expect(update!.arg("set")).toEqual({
      offeredAt: null,
      handoverToMembershipId: null,
    });
    expect(boundStrings(update!)).toEqual(expect.arrayContaining(["a-jabu", M[JABU]]));
  });
});

describe("signUpForShift — the remaining refusals", () => {
  it("someone already on it hears it in the first person", async () => {
    queueLocked({ actor: LERATO, assignments: [assignment(LERATO)] });
    expect(await signUpForShift({ userId: LERATO, ...base })).toEqual({
      ok: false,
      error: "You're already on that shift.",
    });
    expect(shiftInserts()).toHaveLength(0);
  });

  it("a lead-assigned shift is not open for sign-up", async () => {
    queueLocked({ actor: LERATO, shift: { signupMode: ASSIGN } });
    expect(await signUpForShift({ userId: LERATO, ...base })).toEqual({
      ok: false,
      error: "The camp's leads assign this shift — it isn't open for sign-up.",
    });
    expect(shiftInserts()).toHaveLength(0);
  });

  it("a required role whose name is gone still refuses, generically", async () => {
    queueLocked({
      actor: LERATO,
      shift: { requiredRoleId: SOUND, requiredRoleName: null },
    });
    expect(await signUpForShift({ userId: LERATO, ...base })).toEqual({
      ok: false,
      error: "This shift needs a camp role you don't hold.",
    });
  });

  it("refuses a shift that overlaps one the caller is already on", async () => {
    queueLocked({
      actor: LERATO,
      otherShifts: [overlapping],
      assignments: [onOther(LERATO)],
    });
    expect(await signUpForShift({ userId: LERATO, ...base })).toEqual({
      ok: false,
      error: "That clashes with another shift at the same time.",
    });
    expect(shiftInserts()).toHaveLength(0);
  });

  it("another shift that does NOT overlap is no clash", async () => {
    queueLocked({
      actor: LERATO,
      otherShifts: [{ ...overlapping, startMinute: 900 }],
      assignments: [onOther(LERATO)],
    });
    expect(await signUpForShift({ userId: LERATO, ...base })).toEqual({ ok: true });
    expect(shiftInserts()).toHaveLength(1);
  });

  it("a caller the lock returned but who is no longer in the member list is no member", async () => {
    // Locked, then (sanitised) missing from the active member read.
    queueLocked({ actor: LERATO, members: [ALICE, JABU] });
    expect(await signUpForShift({ userId: LERATO, ...base })).toEqual({
      ok: false,
      error: "Only members of this camp can be on its shifts.",
    });
    expect(shiftInserts()).toHaveLength(0);
  });
});

describe("takeOfferedShift — the remaining refusals", () => {
  const offeredBy = (userId: string) =>
    assignment(userId, { offeredAt: new Date("2027-04-20T00:00:00Z") });
  const take = (userId: string) =>
    takeOfferedShift({ userId, assignmentId: "a-jabu", ...base });

  it("a shift that is not this camp's answers as missing", async () => {
    queueLocked({ actor: LERATO, shift: null });
    expect(await take(LERATO)).toEqual({ ok: false, error: "That shift doesn't exist." });
  });

  it("refuses a caller with no active membership", async () => {
    queueLocked({ actor: null, assignments: [offeredBy(JABU)] });
    expect(await take(LERATO)).toEqual({
      ok: false,
      error: "Only members of this camp can be on its shifts.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("someone already on the shift cannot take a second spot on it", async () => {
    queueLocked({ actor: LERATO, assignments: [offeredBy(JABU), assignment(LERATO)] });
    expect(await take(LERATO)).toEqual({
      ok: false,
      error: "You're already on that shift.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("refuses a taker without the required role, naming it", async () => {
    queueLocked({
      actor: LERATO,
      shift: { requiredRoleId: SOUND, requiredRoleName: "Sound Officer" },
      assignments: [offeredBy(JABU)],
    });
    expect(await take(LERATO)).toEqual({
      ok: false,
      error: "This shift needs the Sound Officer role.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("refuses generically when the required role's name is gone", async () => {
    queueLocked({
      actor: LERATO,
      shift: { requiredRoleId: SOUND, requiredRoleName: null },
      assignments: [offeredBy(JABU)],
    });
    expect(await take(LERATO)).toEqual({
      ok: false,
      error: "This shift needs a camp role you don't hold.",
    });
  });

  it("refuses a taker already on an overlapping shift", async () => {
    queueLocked({
      actor: LERATO,
      otherShifts: [overlapping],
      assignments: [offeredBy(JABU), onOther(LERATO)],
    });
    expect(await take(LERATO)).toEqual({
      ok: false,
      error: "You're on another shift at that time.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("the holder cannot take back their own offer this way", async () => {
    queueLocked({ actor: JABU, assignments: [offeredBy(JABU)] });
    expect(await take(JABU)).toEqual({
      ok: false,
      error: "Pick someone other than yourself.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });
});

describe("handShiftTo — the remaining refusals", () => {
  const hand = (userId: string, to: string) =>
    handShiftTo({ userId, toMembershipId: to, ...base });

  it("refuses a caller with no active membership, before locking the shift", async () => {
    queueLocked({ actor: null, shift: null });
    expect(await hand(JABU, M[LERATO])).toEqual({
      ok: false,
      error: "Only members of this camp can be on its shifts.",
    });
    expect(shiftLockIndex()).toBe(-1);
  });

  it("a shift that is not this camp's answers as missing", async () => {
    queueLocked({ actor: JABU, parties: [JABU, LERATO], shift: null });
    expect(await hand(JABU, M[LERATO])).toEqual({
      ok: false,
      error: "That shift doesn't exist.",
    });
  });

  it("refuses handing it to yourself", async () => {
    queueLocked({ actor: JABU, assignments: [assignment(JABU)] });
    expect(await hand(JABU, M[JABU])).toEqual({
      ok: false,
      error: "Pick someone other than yourself.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("refuses a campmate already on an overlapping shift", async () => {
    queueLocked({
      actor: JABU,
      parties: [JABU, LERATO],
      otherShifts: [overlapping],
      assignments: [assignment(JABU), onOther(LERATO)],
    });
    expect(await hand(JABU, M[LERATO])).toEqual({
      ok: false,
      error: "That clashes with another shift at the same time.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });
});

describe("respondToHandOn — the remaining refusals", () => {
  const request = () => [assignment(JABU, { handoverTo: M[LERATO] })];
  const respond = (accept: boolean) =>
    respondToHandOn({ userId: LERATO, accept, ...base });

  it("refuses a caller with no active membership", async () => {
    queueLocked({ actor: null, shift: null });
    expect(await respond(true)).toEqual({
      ok: false,
      error: "Only members of this camp can be on its shifts.",
    });
  });

  it("a shift that is not this camp's answers as missing", async () => {
    queueLocked({ actor: LERATO, shift: null });
    expect(await respond(true)).toEqual({
      ok: false,
      error: "That shift doesn't exist.",
    });
  });

  it("accepting is re-checked: a role taken away since the request refuses, naming it", async () => {
    queueLocked({
      actor: LERATO,
      shift: { requiredRoleId: SOUND, requiredRoleName: "Sound Officer" },
      assignments: request(),
    });
    dbMock.queue([CAMP_ROW]);
    expect(await respond(true)).toEqual({
      ok: false,
      error: "This shift needs the Sound Officer role.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
    expect(notices()).toHaveLength(0);
  });

  it("…and generically when the role's name is gone", async () => {
    queueLocked({
      actor: LERATO,
      shift: { requiredRoleId: SOUND, requiredRoleName: null },
      assignments: request(),
    });
    dbMock.queue([CAMP_ROW]);
    expect(await respond(true)).toEqual({
      ok: false,
      error: "This shift needs a camp role you don't hold.",
    });
  });

  it("accepting is re-checked: a clash booked since the request refuses", async () => {
    queueLocked({
      actor: LERATO,
      otherShifts: [overlapping],
      assignments: [...request(), onOther(LERATO)],
    });
    dbMock.queue([CAMP_ROW]);
    expect(await respond(true)).toEqual({
      ok: false,
      error: "You're on another shift at that time — hand that one on first.",
    });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });

  it("an accept that loses the compare-and-set (withdrawn meanwhile) is stale and notifies nobody", async () => {
    queueLocked({ actor: LERATO, assignments: request() });
    dbMock.queue([CAMP_ROW], /* CAS matched nothing */ []);
    expect(await respond(true)).toEqual({
      ok: false,
      error: "That shift changed while you were looking — refresh and try again.",
    });
    expect(notices()).toHaveLength(0);
  });
});

describe("shift teams — lead only, one name per camp", () => {
  it("addShiftTeam refuses a plain member", async () => {
    dbMock.queue([actorRow(JABU)]);
    expect(
      await addShiftTeam({ actorUserId: JABU, groupId: CAMP, name: "Sound" }),
    ).toEqual({ ok: false, error: "Only the camp's leads can change shifts." });
    expect(dbMock.writesTo(schema.shiftTeams)).toHaveLength(0);
  });

  it("addShiftTeam refuses a camp at the team limit", async () => {
    dbMock.queue([actorRow(ALICE)], [{ n: 30 }]);
    expect(
      await addShiftTeam({ actorUserId: ALICE, groupId: CAMP, name: "Sound" }),
    ).toEqual({ ok: false, error: "A camp can have up to 30 teams." });
    expect(dbMock.writesTo(schema.shiftTeams)).toHaveLength(0);
  });

  it("addShiftTeam sorts the new team last and marks the camp's list as edited", async () => {
    dbMock.queue([actorRow(ALICE)], [{ n: 3 }], [{ id: "t-new" }]);
    expect(
      await addShiftTeam({ actorUserId: ALICE, groupId: CAMP, name: "  Sound " }),
    ).toEqual({ ok: true, id: "t-new" });
    const insert = dbMock.writesTo(schema.shiftTeams)[0]!;
    expect(insert.arg("values")).toMatchObject({ sort: 3, nameNormalized: "sound" });
    const [seeded] = dbMock.writesTo(schema.groups);
    expect(nullChecksOn(seeded!, schema.groups.shiftTeamsSeededAt)).toEqual([
      "is null",
    ]);
  });

  it("addShiftTeam maps a duplicate name — even one wrapped as a cause — to a message", async () => {
    dbMock.queue([actorRow(ALICE)], [{ n: 0 }], uniqueViolation("shift_teams_name_idx"));
    expect(
      await addShiftTeam({ actorUserId: ALICE, groupId: CAMP, name: "Sound" }),
    ).toEqual({ ok: false, error: "The camp already has a team with that name." });

    dbMock.reset();
    const wrapped = new Error("Failed query", {
      cause: uniqueViolation("shift_teams_name_idx"),
    });
    dbMock.queue([actorRow(ALICE)], [{ n: 0 }], wrapped);
    expect(
      await addShiftTeam({ actorUserId: ALICE, groupId: CAMP, name: "Sound" }),
    ).toEqual({ ok: false, error: "The camp already has a team with that name." });
  });

  it("addShiftTeam rethrows anything that is not a duplicate", async () => {
    dbMock.queue([actorRow(ALICE)], [{ n: 0 }], new Error("connection reset"));
    await expect(
      addShiftTeam({ actorUserId: ALICE, groupId: CAMP, name: "Sound" }),
    ).rejects.toThrow("connection reset");
  });

  it("renameShiftTeam refuses a plain member, and updates nothing", async () => {
    dbMock.queue([actorRow(JABU)]);
    expect(
      await renameShiftTeam({ actorUserId: JABU, groupId: CAMP, teamId: TEAM, name: "Sound" }),
    ).toEqual({ ok: false, error: "Only the camp's leads can change shifts." });
    expect(dbMock.writesTo(schema.shiftTeams)).toHaveLength(0);
  });

  it("renameShiftTeam renames this camp's team, normalising the name", async () => {
    dbMock.queue([actorRow(ALICE)], [{ id: TEAM }]);
    expect(
      await renameShiftTeam({ actorUserId: ALICE, groupId: CAMP, teamId: TEAM, name: "Tea Bar" }),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.shiftTeams)[0]!.arg("set")).toEqual({
      name: "Tea Bar",
      nameNormalized: "tea bar",
    });
  });

  it("renameShiftTeam maps a duplicate name to a message, and rethrows anything else", async () => {
    dbMock.queue([actorRow(ALICE)], uniqueViolation());
    expect(
      await renameShiftTeam({ actorUserId: ALICE, groupId: CAMP, teamId: TEAM, name: "Sound" }),
    ).toEqual({ ok: false, error: "The camp already has a team with that name." });

    dbMock.reset();
    dbMock.queue([actorRow(ALICE)], new Error("connection reset"));
    await expect(
      renameShiftTeam({ actorUserId: ALICE, groupId: CAMP, teamId: TEAM, name: "Sound" }),
    ).rejects.toThrow("connection reset");
  });

  it("removeShiftTeam refuses a plain member, and deletes nothing", async () => {
    dbMock.queue([actorRow(JABU)]);
    expect(
      await removeShiftTeam({ actorUserId: JABU, groupId: CAMP, teamId: TEAM }),
    ).toEqual({ ok: false, error: "Only the camp's leads can change shifts." });
    expect(dbMock.writesTo(schema.shiftTeams)).toHaveLength(0);
  });

  it("removeShiftTeam removes this camp's team", async () => {
    dbMock.queue([actorRow(ALICE)], [{ id: TEAM }]);
    expect(
      await removeShiftTeam({ actorUserId: ALICE, groupId: CAMP, teamId: TEAM }),
    ).toEqual({ ok: true });
    expect(boundStrings(dbMock.writesTo(schema.shiftTeams)[0]!)).toEqual(
      expect.arrayContaining([TEAM, CAMP]),
    );
  });
});

describe("respondToHandOn — accepting a shift you are already on", () => {
  it("a campmate a lead put on the shift after the request hears it in the first person", async () => {
    // Jabu asked Lerato to take his spot; a lead then put Lerato on the same
    // shift. Accepting would give her two spots, so it is refused — and the
    // message is to HER, not about a third person.
    queueLocked({
      actor: LERATO,
      assignments: [assignment(JABU, { handoverTo: M[LERATO] }), assignment(LERATO)],
    });
    dbMock.queue([CAMP_ROW]);
    expect(
      await respondToHandOn({ userId: LERATO, accept: true, ...base }),
    ).toEqual({ ok: false, error: "You're already on that shift." });
    expect(dbMock.writesTo(schema.shiftAssignments)).toHaveLength(0);
  });
});
