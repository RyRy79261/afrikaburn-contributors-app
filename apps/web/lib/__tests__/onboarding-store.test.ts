import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { buildOnboardingPreset, defaultOnboardingAudience } from "@quagga/core";
import { dbMock } from "@/test/db-mock";

// CAMP ONBOARDING STORE (epic #54). What this pins — decisions, not SQL (the
// db mock cannot see a WHERE clause; the Playwright spec is the SQL proof):
//
//   - a DRAFT reaches nobody: sending is the only path that writes
//     required_actions, and it is a compare-and-set, so a lost race writes
//     nothing and notifies nobody;
//   - a draft from an earlier edition is never sent into this one;
//   - the completion view runs NO names query unless names were asked for
//     (ONBOARD-020 — not hidden, not loaded);
//   - a late joiner is reached only when the audience, resolved exactly as at
//     send time, includes them.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const CAMP = "11111111-0000-4000-8000-000000000001";
const ACT = "33333333-0000-4000-8000-000000000003";

const stubs = vi.hoisted(() => ({
  activation: null as unknown,
  targets: [] as string[],
  inserted: [] as { userIds: readonly string[] }[],
  notified: [] as { userIds: readonly string[]; onboarding?: boolean }[],
}));

vi.mock("../questionnaire-store", () => ({
  getActivation: async () => stubs.activation,
  resolveProjectTargets: async () => stubs.targets,
  insertActivationActions: async (
    _tx: unknown,
    _a: unknown,
    userIds: readonly string[],
  ) => {
    stubs.inserted.push({ userIds });
    return [...userIds];
  },
  notifyQuestionnaireTargets: async (
    userIds: readonly string[],
    a: { onboarding?: boolean },
  ) => {
    stubs.notified.push({ userIds, onboarding: a.onboarding });
    return false;
  },
}));
vi.mock("../camp-tenure", () => ({
  loadCampTenure: async () =>
    new Map([
      ["m1", "new"],
      ["m2", "returning"],
    ]),
}));

const {
  sendOnboardingDraft,
  getOnboardingCompletion,
  deliverOpenOnboardingsToNewMember,
  createOnboardingDraft,
  getOnboardingDraft,
  saveOnboardingDraft,
  discardOnboardingDraft,
} = await import("../onboarding-store");

function activation(overrides: Record<string, unknown> = {}) {
  return {
    id: ACT,
    questionnaireKey: `proj:${CAMP}:abc`,
    title: "Welcome",
    description: null,
    blocking: false,
    dueAt: null,
    status: "draft",
    authoredScope: "group",
    groupId: CAMP,
    editionId: "ed-2027",
    audience: defaultOnboardingAudience(CAMP),
    definition: buildOnboardingPreset(),
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.reset();
  stubs.activation = activation();
  stubs.targets = ["u-a", "u-b"];
  stubs.inserted = [];
  stubs.notified = [];
});

const STAMP = new Date("2027-03-01T10:00:00.000Z");

/** Does a drizzle SQL tree carry this exact value as a bound parameter? */
function bindsValue(tree: unknown, wanted: unknown): boolean {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): boolean => {
    if (v === wanted) return true;
    if (depth > 16 || typeof v !== "object" || v === null) return false;
    if (seen.has(v)) return false;
    seen.add(v);
    return Object.values(v).some((inner) => walk(inner, depth + 1));
  };
  return walk(tree, 0);
}

describe("sendOnboardingDraft", () => {
  const send = () =>
    sendOnboardingDraft({
      draft: {
        ...(stubs.activation as ReturnType<typeof activation>),
        updatedAt: STAMP,
      } as never,
      groupId: CAMP,
      activeEditionId: "ed-2027",
      senderUserId: "lead",
    });

  it("claims the draft, writes one action per target, then notifies as onboarding", async () => {
    dbMock.queue([{ key: `proj:${CAMP}:abc` }]); // the draft → open claim
    const r = await send();
    expect(r).toEqual({ ok: true, sent: 2, emailDelivered: false });
    expect(stubs.inserted).toEqual([{ userIds: ["u-a", "u-b"] }]);
    expect(stubs.notified).toEqual([
      { userIds: ["u-a", "u-b"], onboarding: true },
    ]);
    const claim = dbMock.writesTo(schema.questionnaireActivations)[0]!;
    expect(claim.tx).toBe(true);
    expect(claim.arg("set")).toMatchObject({ status: "open" });
    // The claim is pinned to the version that was authorised: a save landing
    // between authorisation and send (blocking switched on, say) makes it miss.
    expect(bindsValue(claim.arg("where"), STAMP)).toBe(true);
  });

  it("writes and notifies NOTHING when the claim is lost (already sent)", async () => {
    dbMock.queue([]); // compare-and-set matched no row
    const r = await send();
    expect(r.ok).toBe(false);
    expect(stubs.inserted).toHaveLength(0);
    expect(stubs.notified).toHaveLength(0);
  });

  it("refuses a draft written for an earlier edition, and says what to do", async () => {
    stubs.activation = activation({ editionId: "ed-2026" });
    const r = await send();
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringMatching(/discard it/),
    });
    expect(dbMock.queries).toHaveLength(0);
    expect(stubs.inserted).toHaveLength(0);
  });

  it("refuses another camp's draft", async () => {
    stubs.activation = activation({ groupId: "someone-else" });
    expect((await send()).ok).toBe(false);
    expect(stubs.inserted).toHaveLength(0);
  });

  it("refuses a definition that isn't a valid onboarding", async () => {
    const { preset: _p, ...plain } = buildOnboardingPreset();
    stubs.activation = activation({ definition: plain });
    expect((await send()).ok).toBe(false);
    expect(stubs.inserted).toHaveLength(0);
  });
});

describe("getOnboardingCompletion — totals first, names only on demand", () => {
  beforeEach(() => {
    stubs.activation = activation({ status: "open" });
  });

  it("does not query anybody's name without a names filter", async () => {
    dbMock.queue(
      [
        {
          userId: "u1",
          status: "completed",
          completedAt: new Date(),
          membershipId: "m1",
        },
        {
          userId: "u2",
          status: "pending",
          completedAt: null,
          membershipId: "m2",
        },
      ],
      [{ n: 3 }],
    );
    const view = await getOnboardingCompletion({
      activationId: ACT,
      groupId: CAMP,
      names: null,
    });
    expect(view?.names).toBeNull();
    expect(view?.totals).toMatchObject({
      total: 2,
      complete: 1,
      newTotal: 1,
      newComplete: 1,
      returningTotal: 1,
      returningComplete: 0,
    });
    expect(view?.memberCount).toBe(3);
    expect(dbMock.queriesTouching(schema.users)).toHaveLength(0);
  });

  it("loads names when asked, filtered", async () => {
    dbMock.queue(
      [
        {
          userId: "u1",
          status: "completed",
          completedAt: new Date(),
          membershipId: "m1",
        },
        {
          userId: "u2",
          status: "pending",
          completedAt: null,
          membershipId: "m2",
        },
      ],
      [{ n: 2 }],
      [{ id: "u2", username: "jabu", sanitizedAt: null }],
    );
    const view = await getOnboardingCompletion({
      activationId: ACT,
      groupId: CAMP,
      names: "incomplete",
    });
    expect(view?.names?.map((n) => [n.displayName, n.tenure])).toEqual([
      ["jabu", "returning"],
    ]);
  });

  it("returns nothing for a draft, another camp's, or a plain questionnaire", async () => {
    for (const a of [
      activation({ status: "draft" }),
      activation({ status: "open", groupId: "other" }),
      activation({
        status: "open",
        definition: { version: "1", pages: buildOnboardingPreset().pages },
      }),
    ]) {
      stubs.activation = a;
      expect(
        await getOnboardingCompletion({
          activationId: ACT,
          groupId: CAMP,
          names: "all",
        }),
      ).toBeNull();
    }
  });
});

describe("deliverOpenOnboardingsToNewMember", () => {
  beforeEach(() => {
    stubs.activation = activation({ status: "open" });
  });

  it("delivers when the audience reaches the newcomer", async () => {
    stubs.targets = ["newcomer", "u-a"];
    dbMock.queue([{ id: ACT }], [{ status: "open" }]);
    const n = await deliverOpenOnboardingsToNewMember({
      groupId: CAMP,
      userId: "newcomer",
      editionId: "ed-2027",
    });
    expect(n).toBe(1);
    expect(stubs.inserted).toEqual([{ userIds: ["newcomer"] }]);
    expect(stubs.notified).toEqual([
      { userIds: ["newcomer"], onboarding: true },
    ]);
  });

  it("delivers nothing when the audience doesn't reach them (e.g. a new co-lead, leads switched off)", async () => {
    stubs.targets = ["u-a"];
    dbMock.queue([{ id: ACT }], [{ status: "open" }]);
    const n = await deliverOpenOnboardingsToNewMember({
      groupId: CAMP,
      userId: "newcomer",
      editionId: "ed-2027",
    });
    expect(n).toBe(0);
    expect(stubs.inserted).toHaveLength(0);
    expect(stubs.notified).toHaveLength(0);
  });

  it("delivers nothing if the onboarding was closed in the meantime", async () => {
    stubs.targets = ["newcomer"];
    dbMock.queue([{ id: ACT }], [{ status: "closed" }]);
    const n = await deliverOpenOnboardingsToNewMember({
      groupId: CAMP,
      userId: "newcomer",
      editionId: "ed-2027",
    });
    expect(n).toBe(0);
    expect(stubs.inserted).toHaveLength(0);
    expect(stubs.notified).toHaveLength(0);
  });
});

describe("deliverOpenOnboardingsToNewMember — a former member let back in", () => {
  it("revives their WAIVED row (archiving withdrew it) and notifies them", async () => {
    stubs.activation = activation({ status: "open" });
    stubs.targets = ["returner"];
    // The insert is a no-op against the existing waived row…
    const realInsert = stubs.inserted;
    void realInsert;
    dbMock.queue(
      [{ id: ACT }],
      [{ status: "open" }],
      // …and the waived → pending update brings it back.
      [{ userId: "returner" }],
    );
    const { deliverOpenOnboardingsToNewMember: deliver } =
      await import("../onboarding-store");
    // Make the mocked insert report "nothing new" for this case.
    const qs = await import("../questionnaire-store");
    const spy = vi
      .spyOn(qs, "insertActivationActions")
      .mockResolvedValueOnce([]);
    const n = await deliver({
      groupId: CAMP,
      userId: "returner",
      editionId: "ed-2027",
    });
    spy.mockRestore();
    expect(n).toBe(1);
    const revive = dbMock.writesTo(schema.requiredActions)[0]!;
    expect(revive.arg("set")).toMatchObject({ status: "pending" });
    expect(stubs.notified).toEqual([
      { userIds: ["returner"], onboarding: true },
    ]);
  });
});

describe("drafts — create, read, autosave, discard", () => {
  it("creates a NON-blocking draft from the preset with the default audience", async () => {
    dbMock.queue(undefined, [{ id: ACT }]);
    const id = await createOnboardingDraft({
      groupId: CAMP,
      editionId: "ed-2027",
      createdByUserId: "u-lead",
      campName: "Camp 404",
    });
    expect(id).toBe(ACT);
    const [act] = dbMock.writesTo(schema.questionnaireActivations);
    const values = act!.arg("values") as Record<string, unknown>;
    expect(values.status).toBe("draft");
    expect(values.blocking).toBe(false);
    expect(values.audience).toEqual(defaultOnboardingAudience(CAMP));
    // A draft reaches nobody: no required_actions are written.
    expect(dbMock.writesTo(schema.requiredActions)).toHaveLength(0);
  });

  it("reads back this camp's draft with its version stamp", async () => {
    dbMock.queue([{ updatedAt: STAMP }]);
    const row = await getOnboardingDraft(ACT, CAMP);
    expect(row?.updatedAt).toBe(STAMP);
  });

  it("returns null for another camp's, a sent one, or a plain questionnaire", async () => {
    stubs.activation = activation({ groupId: "other-camp" });
    expect(await getOnboardingDraft(ACT, CAMP)).toBeNull();
    stubs.activation = activation({ status: "open" });
    expect(await getOnboardingDraft(ACT, CAMP)).toBeNull();
    stubs.activation = activation({ definition: { pages: [] } });
    expect(await getOnboardingDraft(ACT, CAMP)).toBeNull();
    // None of them got as far as the stamp read.
    expect(dbMock.queries).toHaveLength(0);
  });

  const saveInput = {
    activationId: ACT,
    groupId: CAMP,
    title: "Welcome to the camp",
    description: null,
    definition: buildOnboardingPreset(),
    audience: defaultOnboardingAudience(CAMP),
    blocking: false,
    dueAt: null,
  };

  it("autosaves a draft into both the activation and its definition", async () => {
    dbMock.queue([{ key: `proj:${CAMP}:abc` }], undefined);
    expect(await saveOnboardingDraft(saveInput)).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.questionnaireActivations)).toHaveLength(1);
    expect(dbMock.writesTo(schema.questionnaireDefinitions)).toHaveLength(1);
  });

  it("refuses to edit a sent onboarding and leaves the definition alone", async () => {
    dbMock.queue([]);
    const res = await saveOnboardingDraft(saveInput);
    expect(res).toMatchObject({ ok: false, reason: "not_draft" });
    expect(dbMock.writesTo(schema.questionnaireDefinitions)).toHaveLength(0);
  });

  it("refuses an invalid definition without writing", async () => {
    const res = await saveOnboardingDraft({
      ...saveInput,
      definition: { pages: [] } as never,
    });
    expect(res).toMatchObject({ ok: false, reason: "invalid" });
    expect(dbMock.queries).toHaveLength(0);
  });

  it("discards a draft and its definition", async () => {
    dbMock.queue([{ key: `proj:${CAMP}:abc` }], undefined);
    expect(await discardOnboardingDraft(ACT, CAMP)).toBe(true);
    expect(dbMock.writesTo(schema.questionnaireDefinitions)).toHaveLength(1);
  });

  it("discards nothing once sent (only Close recalls a sent one)", async () => {
    dbMock.queue([]);
    expect(await discardOnboardingDraft(ACT, CAMP)).toBe(false);
    expect(dbMock.writesTo(schema.questionnaireDefinitions)).toHaveLength(0);
  });
});
