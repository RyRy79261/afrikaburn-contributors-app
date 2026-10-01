import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildOnboardingPreset, defaultOnboardingAudience } from "@quagga/core";
import { dbMock } from "@/test/db-mock";
import { resetNextMocks } from "@/test/next-mocks";

// CAMP ONBOARDING ACTIONS (epic #54). The authz boundary: every action parses
// with Zod, resolves the camp from the SLUG (never a client-supplied group
// id), and runs @quagga/core `canAuthorOnboarding` against the audience and
// blocking choice actually being written — and, for an existing draft, the
// one already stored.

vi.mock("@/lib/db", async () =>
  (await import("@/test/db-mock")).dbModuleMock(),
);
vi.mock("next/cache", async () =>
  (await import("@/test/next-mocks")).nextCacheMock(),
);

const CAMP = "11111111-0000-4000-8000-000000000001";
const OTHER_CAMP_ROLE = "99999999-0000-4000-8000-000000000009";
const OWN_ROLE = "22222222-0000-4000-8000-000000000002";
const DRAFT = "33333333-0000-4000-8000-000000000003";

const stubs = vi.hoisted(() => ({
  perms: null as null | { structuralRole: string; rolePermissions: unknown[] },
  draft: null as unknown,
  saved: [] as unknown[],
  sent: [] as unknown[],
  created: [] as unknown[],
  carried: null as unknown,
  thisEdition: [] as unknown[],
  prepared: 0,
}));

vi.mock("@/lib/session", () => ({
  requireCampUser: async () => ({ id: "user-1", email: "u@example.com" }),
}));
vi.mock("@/lib/edition", () => ({
  getActiveEdition: async () => ({ id: "ed-2027", year: 2027, name: "AfrikaBurn 2027" }),
}));
vi.mock("@/lib/roles-store", () => ({
  getMemberPermissions: async () => stubs.perms,
  getBaselineRoleId: async () => "role-baseline",
  listRoles: async () => [
    { id: "role-baseline", kind: "baseline" },
    { id: OWN_ROLE, kind: "custom" },
  ],
}));
vi.mock("@/lib/onboarding-store", () => ({
  createOnboardingDraft: async (i: unknown) => {
    stubs.created.push(i);
    return DRAFT;
  },
  getOnboardingDraft: async () => stubs.draft,
  saveOnboardingDraft: async (i: unknown) => {
    stubs.saved.push(i);
    return { ok: true };
  },
  sendOnboardingDraft: async (i: unknown) => {
    stubs.sent.push(i);
    return { ok: true, sent: 4, emailDelivered: false };
  },
  discardOnboardingDraft: async () => true,
  prepareOnboardingCarry: async () => {
    stubs.prepared += 1;
    return stubs.carried;
  },
  listOnboardingsForEdition: async () => stubs.thisEdition,
  insertOnboardingDraft: async (d: unknown) => {
    stubs.created.push(d);
    return DRAFT;
  },
}));

const {
  startOnboardingAction,
  saveOnboardingDraftAction,
  sendOnboardingAction,
  carryForwardOnboardingAction,
} = await import("@/app/(app)/camps/[slug]/questionnaires/onboarding-actions");

const LEAD = { structuralRole: "lead", rolePermissions: [] };
const MEMBER = { structuralRole: "member", rolePermissions: [] };
const SCOPED_NO_BLOCK = {
  structuralRole: "member",
  rolePermissions: [
    {
      manage_questionnaires: { audienceRoles: ["role-baseline"], mayBlock: false },
    },
  ],
};

function storedDraft(blocking = false) {
  return {
    id: DRAFT,
    groupId: CAMP,
    status: "draft",
    blocking,
    audience: defaultOnboardingAudience(CAMP),
    definition: buildOnboardingPreset(),
  };
}

function saveInput(overrides: Record<string, unknown> = {}) {
  return {
    slug: "the-camp",
    activationId: DRAFT,
    title: "Welcome",
    definition: buildOnboardingPreset(),
    audience: {
      mode: "everyone",
      roleIds: [],
      tenure: ["new", "returning"],
      structuralRoles: ["member"],
    },
    blocking: false,
    dueAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.reset();
  resetNextMocks();
  stubs.perms = LEAD;
  stubs.draft = storedDraft();
  stubs.saved = [];
  stubs.sent = [];
  stubs.created = [];
  stubs.carried = null;
  stubs.thisEdition = [];
  stubs.prepared = 0;
});

describe("startOnboardingAction", () => {
  it("creates a draft for a lead — and sends nothing", async () => {
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await startOnboardingAction({ slug: "the-camp" });
    expect(r).toEqual({ ok: true, activationId: DRAFT });
    expect(stubs.created).toHaveLength(1);
    expect(stubs.sent).toHaveLength(0);
  });

  it("refuses a plain member", async () => {
    stubs.perms = MEMBER;
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await startOnboardingAction({ slug: "the-camp" });
    expect(r.ok).toBe(false);
    expect(stubs.created).toHaveLength(0);
  });

  it("refuses a non-member exactly like an unknown slug (no existence oracle)", async () => {
    stubs.perms = null;
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    expect(await startOnboardingAction({ slug: "the-camp" })).toEqual({
      ok: false,
      error: "Camp not found.",
    });
    expect(stubs.created).toHaveLength(0);
  });

  it.each(["artwork", "mutant_vehicle", "org"])(
    "refuses a %s — onboarding is a camp's",
    async (kind) => {
      dbMock.queue([{ id: CAMP, kind, name: "X" }]);
      expect((await startOnboardingAction({ slug: "x" })).ok).toBe(false);
      expect(stubs.created).toHaveLength(0);
    },
  );
});

describe("saveOnboardingDraftAction", () => {
  it("anchors the audience on the camp in the URL and drops foreign role ids", async () => {
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await saveOnboardingDraftAction(
      saveInput({
        audience: {
          mode: "roles",
          roleIds: [OWN_ROLE, OTHER_CAMP_ROLE],
          tenure: ["new"],
          structuralRoles: ["member", "lead"],
        },
      }),
    );
    expect(r).toEqual({ ok: true });
    expect(stubs.saved[0]).toMatchObject({
      groupId: CAMP,
      audience: {
        kind: "project",
        groupId: CAMP,
        mode: "roles",
        roleIds: [OWN_ROLE],
        tenure: ["new"],
        structuralRoles: ["member", "lead"],
      },
    });
  });

  it("refuses a definition that isn't an onboarding (a survey smuggled in)", async () => {
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const def = {
      version: "1",
      preset: "onboarding",
      pages: [
        {
          id: "p",
          kind: "questions",
          title: "Your ID",
          questions: [{ id: "q", kind: "short_text", prompt: "ID number?" }],
        },
      ],
    };
    const r = await saveOnboardingDraftAction(saveInput({ definition: def }));
    expect(r.ok).toBe(false);
    expect(stubs.saved).toHaveLength(0);
  });

  it("holds a scoped author to may_block — no switching blocking on", async () => {
    stubs.perms = SCOPED_NO_BLOCK;
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await saveOnboardingDraftAction(saveInput({ blocking: true }));
    expect(r.ok).toBe(false);
    expect(stubs.saved).toHaveLength(0);
  });

  it("refuses to edit a draft the author could not have written", async () => {
    stubs.perms = SCOPED_NO_BLOCK;
    stubs.draft = storedDraft(true); // a lead made it blocking
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await saveOnboardingDraftAction(saveInput({ blocking: false }));
    expect(r.ok).toBe(false);
    expect(stubs.saved).toHaveLength(0);
  });

  it("says 'already sent' once the draft is gone", async () => {
    stubs.draft = null;
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await saveOnboardingDraftAction(saveInput());
    expect(r).toMatchObject({ ok: false, sent: true });
  });

  it("rejects a due date that doesn't exist", async () => {
    for (const dueAt of ["2027-02-31", "2027-13-01"]) {
      const r = await saveOnboardingDraftAction(saveInput({ dueAt }));
      expect(r.ok, dueAt).toBe(false);
    }
    expect(stubs.saved).toHaveLength(0);
  });

  it("rejects malformed input before touching anything", async () => {
    const r = await saveOnboardingDraftAction({ slug: "x", activationId: "nope" });
    expect(r.ok).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("sendOnboardingAction", () => {
  it("sends the stored draft for a lead, into the active edition", async () => {
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await sendOnboardingAction({ slug: "the-camp", activationId: DRAFT });
    expect(r).toMatchObject({ ok: true, sent: 4 });
    expect(stubs.sent[0]).toMatchObject({
      // The very row that was authorised is what gets sent.
      draft: { id: DRAFT, groupId: CAMP },
      groupId: CAMP,
      activeEditionId: "ed-2027",
      senderUserId: "user-1",
    });
  });

  it("refuses a plain member", async () => {
    stubs.perms = MEMBER;
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await sendOnboardingAction({ slug: "the-camp", activationId: DRAFT });
    expect(r.ok).toBe(false);
    expect(stubs.sent).toHaveLength(0);
  });
});

describe("carryForwardOnboardingAction", () => {
  it("checks permission BEFORE looking up the source (no history probe)", async () => {
    stubs.perms = MEMBER;
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await carryForwardOnboardingAction({
      slug: "the-camp",
      sourceActivationId: DRAFT,
    });
    expect(r.ok).toBe(false);
    expect(stubs.prepared).toBe(0);
  });

  it("refuses a second draft for the same edition", async () => {
    stubs.thisEdition = [{ activationId: "x", status: "draft" }];
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await carryForwardOnboardingAction({
      slug: "the-camp",
      sourceActivationId: DRAFT,
    });
    expect(r.ok).toBe(false);
    expect(stubs.created).toHaveLength(0);
  });

  it("authorises the CARRIED audience — a scoped author can't carry a blocking one", async () => {
    stubs.perms = SCOPED_NO_BLOCK;
    stubs.carried = {
      ok: true,
      draft: {
        groupId: CAMP,
        audience: defaultOnboardingAudience(CAMP),
        blocking: true,
      },
    };
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await carryForwardOnboardingAction({
      slug: "the-camp",
      sourceActivationId: DRAFT,
    });
    expect(r.ok).toBe(false);
    expect(stubs.created).toHaveLength(0);
  });

  it("writes the draft for a lead", async () => {
    stubs.carried = {
      ok: true,
      draft: {
        groupId: CAMP,
        audience: defaultOnboardingAudience(CAMP),
        blocking: true,
      },
    };
    dbMock.queue([{ id: CAMP, kind: "theme_camp", name: "The camp" }]);
    const r = await carryForwardOnboardingAction({
      slug: "the-camp",
      sourceActivationId: DRAFT,
    });
    expect(r).toEqual({ ok: true, activationId: DRAFT });
    expect(stubs.created).toHaveLength(1);
  });
});
