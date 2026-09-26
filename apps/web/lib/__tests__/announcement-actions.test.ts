import { describe, it, expect, beforeEach, vi } from "vitest";
import { ANNOUNCEMENT_MESSAGES } from "@quagga/core";
import { dbMock } from "@/test/db-mock";
import { resetNextMocks } from "@/test/next-mocks";

// Camp announcement ACTIONS (epic #56): the boundary. Zod first, then the camp
// (never the org group), then the sender's permission and audience scope —
// all before the store is asked to write anything.

vi.mock("@/lib/db", async () =>
  (await import("@/test/db-mock")).dbModuleMock(),
);
vi.mock("next/cache", async () =>
  (await import("@/test/next-mocks")).nextCacheMock(),
);

const CAMP = "11111111-1111-4111-8111-111111111111";
const KITCHEN = "c0000000-0000-4000-8000-000000000001";
const BUILD = "c0000000-0000-4000-8000-000000000002";
const BASELINE = "b0000000-0000-4000-8000-000000000000";

const stubs = vi.hoisted(() => ({
  sender: null as unknown,
  saved: [] as unknown[],
  published: [] as unknown[],
  scheduling: false,
}));

vi.mock("@/lib/session", () => ({
  requireCampUser: async () => ({ id: "u-author", email: "a@example.com" }),
}));
vi.mock("@/lib/edition", () => ({
  getActiveEdition: async () => ({ id: "ed-2027", year: 2027 }),
}));
vi.mock("@/lib/announcements-store", () => ({
  announcementSchedulingEnabled: () => stubs.scheduling,
  getSenderContext: async () => stubs.sender,
  saveCampAnnouncementDraft: async (input: unknown) => {
    stubs.saved.push(input);
    return { ok: true, id: "d0000000-0000-4000-8000-000000000001" };
  },
  deleteCampAnnouncementDraft: async () => ({ ok: true }),
  publishCampAnnouncement: async (input: unknown) => {
    stubs.published.push(input);
    return { ok: true, recipients: 2, scheduledFor: null };
  },
  setCampAnnouncementPinned: async () => ({ ok: true }),
}));

const actions = await import("@/app/(app)/camps/[slug]/announcements/actions");

function kitchenPoster() {
  return {
    perms: {
      structuralRole: "member",
      rolePermissions: [
        {
          post_announcements: {
            audienceRoles: [KITCHEN],
            mayRequireAck: false,
          },
        },
      ],
    },
    baselineRoleId: BASELINE,
    campRoleIds: new Set([BASELINE, KITCHEN, BUILD]),
  };
}

const DRAFT = {
  slug: "mad-hatters",
  title: "Kitchen shift change",
  bodyMd: "Breakfast now starts at 7.",
  mode: "roles",
  roleIds: [KITCHEN],
};

beforeEach(() => {
  dbMock.reset();
  resetNextMocks();
  stubs.sender = kitchenPoster();
  stubs.saved = [];
  stubs.published = [];
  stubs.scheduling = false;
});

describe("saveAnnouncementDraftAction", () => {
  it("saves a draft inside the sender's scope, for THIS camp", async () => {
    dbMock.queue([{ id: CAMP, kind: "theme_camp" }]);
    const result = await actions.saveAnnouncementDraftAction(DRAFT);
    expect(result).toMatchObject({ ok: true });
    expect(stubs.saved[0]).toMatchObject({
      groupId: CAMP,
      actorId: "u-author",
      fields: {
        audience: {
          kind: "project",
          groupId: CAMP,
          mode: "roles",
          roleIds: [KITCHEN],
        },
      },
    });
  });

  it("refuses the org group before any permission is read", async () => {
    dbMock.queue([{ id: "org-1", kind: "org" }]);
    const result = await actions.saveAnnouncementDraftAction({
      ...DRAFT,
      slug: "afrikaburn",
    });
    expect(result).toEqual({ ok: false, error: "Camp not found." });
    expect(stubs.saved).toHaveLength(0);
  });

  it("refuses a member without post_announcements", async () => {
    dbMock.queue([{ id: CAMP, kind: "theme_camp" }]);
    stubs.sender = {
      ...kitchenPoster(),
      perms: { structuralRole: "member", rolePermissions: [{}] },
    };
    const result = await actions.saveAnnouncementDraftAction(DRAFT);
    expect(result.ok).toBe(false);
    expect(stubs.saved).toHaveLength(0);
  });

  it("refuses an audience outside the sender's scope", async () => {
    dbMock.queue([{ id: CAMP, kind: "theme_camp" }]);
    const result = await actions.saveAnnouncementDraftAction({
      ...DRAFT,
      roleIds: [BUILD],
    });
    expect(result).toEqual({
      ok: false,
      error: ANNOUNCEMENT_MESSAGES.notAllowed,
    });
    expect(stubs.saved).toHaveLength(0);
  });

  it("refuses must-acknowledge without mayRequireAck", async () => {
    dbMock.queue([{ id: CAMP, kind: "theme_camp" }]);
    const result = await actions.saveAnnouncementDraftAction({
      ...DRAFT,
      presentation: "acknowledge",
    });
    expect(result.ok).toBe(false);
    expect(stubs.saved).toHaveLength(0);
  });

  it("refuses a non-https meeting link at the boundary, before any read", async () => {
    const result = await actions.saveAnnouncementDraftAction({
      ...DRAFT,
      meetingUrl: "http://meet.example.com/x",
    });
    expect(result.ok).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("refuses a send time in the past", async () => {
    stubs.scheduling = true;
    dbMock.queue([{ id: CAMP, kind: "theme_camp" }]);
    const result = await actions.saveAnnouncementDraftAction({
      ...DRAFT,
      sendAt: "2020-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(stubs.saved).toHaveLength(0);
  });
});

describe("scheduled sending is off unless a scheduler is wired", () => {
  const tomorrow = () =>
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Regression: a lead could save and publish a scheduled announcement that
  // nothing would ever dispatch, and a published one cannot be edited.
  it("refuses a future send time while scheduling is off", async () => {
    dbMock.queue([{ id: CAMP, kind: "theme_camp" }]);
    const result = await actions.saveAnnouncementDraftAction({
      ...DRAFT,
      sendAt: tomorrow(),
    });
    expect(result).toEqual({
      ok: false,
      error: ANNOUNCEMENT_MESSAGES.schedulingOff,
    });
    expect(stubs.saved).toHaveLength(0);
  });

  it("still saves a send-now draft while scheduling is off", async () => {
    dbMock.queue([{ id: CAMP, kind: "theme_camp" }]);
    const result = await actions.saveAnnouncementDraftAction(DRAFT);
    expect(result).toMatchObject({ ok: true });
    expect(stubs.saved).toHaveLength(1);
  });

  it("accepts a future send time once scheduling is on", async () => {
    stubs.scheduling = true;
    dbMock.queue([{ id: CAMP, kind: "theme_camp" }]);
    const result = await actions.saveAnnouncementDraftAction({
      ...DRAFT,
      sendAt: tomorrow(),
    });
    expect(result).toMatchObject({ ok: true });
    expect(stubs.saved).toHaveLength(1);
  });
});

describe("publishAnnouncementAction", () => {
  it("hands the store the camp, the caller and the ACTIVE edition to re-check against", async () => {
    dbMock.queue([{ id: CAMP, kind: "theme_camp" }]);
    const result = await actions.publishAnnouncementAction({
      slug: "mad-hatters",
      id: "d0000000-0000-4000-8000-000000000001",
    });
    expect(result).toEqual({ ok: true, recipients: 2, scheduledFor: null });
    expect(stubs.published[0]).toMatchObject({
      groupId: CAMP,
      actorId: "u-author",
      activeEditionId: "ed-2027",
    });
  });

  it("refuses a non-uuid id without touching the database", async () => {
    const result = await actions.publishAnnouncementAction({
      slug: "mad-hatters",
      id: "../etc",
    });
    expect(result.ok).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });
});
