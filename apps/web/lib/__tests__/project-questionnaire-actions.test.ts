import { describe, it, expect, beforeEach, vi } from "vitest";
import { dbMock } from "@/test/db-mock";
import { resetNextMocks, revalidated } from "@/test/next-mocks";

// PROJECT-SCOPED QUESTIONNAIRES (CREATIVE-007). The camp questionnaire actions
// now serve artworks and mutant vehicles too — the spine is kind-agnostic — so
// two things have to hold:
//
//   1. The ORG group is never a valid target. Org questionnaires are authored
//      in the console; a participant-app action that resolved the org's slug
//      would be one permission check away from sending or recalling one.
//   2. The page a send refreshes is the group's OWN route, by kind.

vi.mock("@/lib/db", async () =>
  (await import("@/test/db-mock")).dbModuleMock(),
);
vi.mock("next/cache", async () =>
  (await import("@/test/next-mocks")).nextCacheMock(),
);

const stubs = vi.hoisted(() => ({
  permissionsAsked: [] as string[],
  created: [] as unknown[],
}));

vi.mock("@/lib/session", () => ({
  requireCampUser: async () => ({ id: "user-lead", email: "lead@example.com" }),
}));
vi.mock("@/lib/edition", () => ({
  getActiveEdition: async () => ({ id: "ed-2027", year: 2027 }),
}));
vi.mock("@/lib/roles-store", () => ({
  // A structural lead: every project permission, irrevocably.
  getMemberPermissions: async (groupId: string) => {
    stubs.permissionsAsked.push(groupId);
    return { structuralRole: "lead", rolePermissions: [] };
  },
  getBaselineRoleId: async () => "role-baseline",
}));
vi.mock("@/lib/questionnaire-store", () => ({
  createAndActivateProjectQuestionnaire: async (input: unknown) => {
    stubs.created.push(input);
    return { activationId: "act-1", sent: 3, emailDelivered: true };
  },
}));

const { createQuestionnaireAction, closeQuestionnaireAction } =
  await import("@/app/(app)/camps/[slug]/questionnaires/actions");

// The smallest definition the shared `Questionnaire` schema accepts.
const DEFINITION = {
  version: "1",
  pages: [
    {
      id: "p1",
      kind: "intro",
      heading: "Build week",
      body: "When do you arrive?",
    },
  ],
};

function send(slug: string) {
  return createQuestionnaireAction({
    slug,
    title: "Build week",
    definition: DEFINITION,
    mode: "everyone",
    roleIds: [],
    blocking: false,
    dueAt: null,
  });
}

beforeEach(() => {
  dbMock.reset();
  resetNextMocks();
  stubs.permissionsAsked = [];
  stubs.created = [];
});

describe("createQuestionnaireAction on a creative project", () => {
  it.each([
    ["artwork", "/artworks/baobab/questionnaires"],
    ["mutant_vehicle", "/vehicles/baobab/questionnaires"],
    ["theme_camp", "/camps/baobab/questionnaires"],
  ])("sends for a %s and refreshes %s", async (kind, path) => {
    dbMock.queue([{ id: "grp-1", kind }]);

    const result = await send("baobab");

    expect(result).toMatchObject({ ok: true, activationId: "act-1" });
    expect(stubs.created).toHaveLength(1);
    expect(stubs.created[0]).toMatchObject({
      groupId: "grp-1",
      audience: { kind: "project", groupId: "grp-1" },
    });
    expect(revalidated.map((r) => r.path)).toEqual([path]);
  });

  it("refuses the org group before any permission is read", async () => {
    dbMock.queue([{ id: "grp-org", kind: "org" }]);

    const result = await send("afrikaburn");

    expect(result.ok).toBe(false);
    expect(stubs.permissionsAsked).toHaveLength(0);
    expect(stubs.created).toHaveLength(0);
  });
});

describe("closeQuestionnaireAction on a creative project", () => {
  it("refuses the org group before reading the activation", async () => {
    dbMock.queue([{ id: "grp-org", kind: "org" }]);

    const result = await closeQuestionnaireAction({
      slug: "afrikaburn",
      activationId: "aaaaaaaa-0000-4000-8000-000000000001",
    });

    expect(result.ok).toBe(false);
    // Only the group lookup ran — no activation read, no write.
    expect(dbMock.queries).toHaveLength(1);
  });
});
