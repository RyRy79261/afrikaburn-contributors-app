import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { dbMock } from "@/test/db-mock";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const {
  EDITABLE_STATUSES,
  isEditableStatus,
  getRegistration,
  getRegistrationCampContext,
  getSectionReviews,
  listSuppliersForPicker,
  getDeclaredSupplierIds,
  getDeclaredSuppliers,
  saveRegistrationDraft,
  applyCampAction,
} = await import("../registration-store");

const GROUP = "11111111-1111-4111-8111-111111111111";
const EDITION = "eeeeeeee-0000-4000-8000-000000000000";
const REGISTRATION = "77777777-7777-4777-8777-777777777777";
const VIEWER = "aaaaaaaa-0000-4000-8000-000000000001";

/** The sections the submit gate actually requires — Form 1's four, not all
 * six. Requiring a September applicant to declare their January answers would
 * be an unanswerable form, so `isSubmittable` gates on these. */
const SUBMITTABLE_SECTIONS = [
  "identity",
  "lnt",
  "participation",
  "suppliers_commerce",
];

/** A `registrations` row as `select()` returns it — only the columns the code
 * under test reads matter. */
function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: REGISTRATION,
    groupId: GROUP,
    editionId: EDITION,
    status: "draft",
    completedSections: SUBMITTABLE_SECTIONS,
    decisionReason: null,
    submittedAt: null,
    ...overrides,
  };
}

/** Every field the wizard autosaves. Values are irrelevant to the decisions
 * under test; completeness is computed from them by @quagga/core. */
function values(overrides: Record<string, unknown> = {}) {
  return {
    campDescription: "Tea, all night.",
    s1ContactEmail: null,
    s1AltContactName: null,
    s1AltContactPhone: null,
    s1AltContactEmail: null,
    s2LntPlan: null,
    s2LntLeadName: null,
    s2LntLeadPhone: null,
    s2LntLeadEmail: null,
    s3ParticipationPlan: null,
    s3OperatingHours: [],
    s3ScheduleDetail: null,
    s3GiftingFood: null,
    s4ExpectedPopulation: null,
    s4FirstArrivalDate: null,
    s4WorkAccessPasses: null,
    s4AreaDimensions: null,
    s4LayoutUploadUrls: [],
    s5AmplifiedMusic: null,
    s5SoundPlan: null,
    s5PlacementFirstChoice: null,
    s5PlacementSecondChoice: null,
    s5NeighbourRequest: null,
    s5FamilyFriendly: null,
    s6SuppliersNote: null,
    s6PaidPerformers: null,
    s6FeeStructure: null,
    s6ExpectedBudgetZar: null,
    s6PlugAndPlayAck: null,
    supplierIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.reset();
});

describe("isEditableStatus — the editable-status state machine", () => {
  it("is true for exactly draft and changes_requested", () => {
    expect(EDITABLE_STATUSES).toEqual(["draft", "changes_requested"]);
    expect(isEditableStatus("draft")).toBe(true);
    expect(isEditableStatus("changes_requested")).toBe(true);
  });

  it("is FALSE once AfrikaBurn holds it — submitted, under review, approved, rejected", () => {
    // Editing while the org is reading it would mean the decision is made about
    // text that no longer exists.
    for (const status of [
      "submitted",
      "under_review",
      "approved",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(isEditableStatus(status)).toBe(false);
    }
  });
});

describe("applyCampAction — the decision_reason invariant", () => {
  it("CLEARS decision_reason when a camp moves out of changes_requested", async () => {
    // The reviewer's words belong to the state they were said about. Carried
    // into `submitted`, "your LNT section needs more detail" sat under
    // "Submitted — awaiting review", reading as though AfrikaBurn were still
    // asking — a migration already got this wrong against real data.
    //
    // Proved on the WRITTEN VALUE, not on the source text.
    dbMock.queue(
      [
        registration({
          status: "changes_requested",
          decisionReason: "Your LNT section needs more detail.",
        }),
      ],
      /* the compare-and-set … returning */ [{ id: REGISTRATION }],
    );

    expect(
      await applyCampAction({
        groupId: GROUP,
        editionId: EDITION,
        action: "resubmit",
      }),
    ).toEqual({ ok: true, status: "submitted", registrationId: REGISTRATION });

    const set = dbMock.onlyQuery("update").arg("set") as Record<string, unknown>;
    expect(set.decisionReason).toBeNull();
    expect(set.status).toBe("submitted");
    expect(set.submittedAt).toBeInstanceOf(Date);
  });

  it("clears it on a WITHDRAWAL too, which stamps no submittedAt", async () => {
    dbMock.queue(
      [
        registration({
          status: "submitted",
          decisionReason: "Something the reviewer said.",
        }),
      ],
      [{ id: REGISTRATION }],
    );

    expect(
      await applyCampAction({
        groupId: GROUP,
        editionId: EDITION,
        action: "withdraw",
      }),
    ).toMatchObject({ ok: true, status: "withdrawn" });

    const set = dbMock.onlyQuery("update").arg("set") as Record<string, unknown>;
    expect(set.decisionReason).toBeNull();
    expect(set).not.toHaveProperty("submittedAt");
  });

  it("REFUSES a transition the current status does not permit", async () => {
    dbMock.queue([registration({ status: "approved" })]);

    const result = await applyCampAction({
      groupId: GROUP,
      editionId: EDITION,
      action: "submit",
    });
    expect(result.ok).toBe(false);
    expect(dbMock.queriesOfKind("update")).toHaveLength(0);
  });

  it("REFUSES a submit with sections still incomplete", async () => {
    dbMock.queue([registration({ completedSections: ["identity", "lnt"] })]);

    expect(
      await applyCampAction({
        groupId: GROUP,
        editionId: EDITION,
        action: "submit",
      }),
    ).toEqual({ ok: false, error: "Complete all six sections before submitting." });
    expect(dbMock.queriesOfKind("update")).toHaveLength(0);
  });

  it("REFUSES when there is no registration to update", async () => {
    dbMock.queue([]);

    expect(
      await applyCampAction({
        groupId: GROUP,
        editionId: EDITION,
        action: "submit",
      }),
    ).toEqual({ ok: false, error: "There's no registration to update yet." });
  });

  it("reports the TOCTOU loss rather than accepting it as a success", async () => {
    // The camp's page may have been open for an hour. Without re-checking the
    // status in the WHERE, a lead on a stale page could resubmit a registration
    // AfrikaBurn had meanwhile REJECTED. Zero rows updated is reported back.
    dbMock.queue([registration()], /* nothing matched */ []);

    expect(
      await applyCampAction({
        groupId: GROUP,
        editionId: EDITION,
        action: "submit",
      }),
    ).toEqual({
      ok: false,
      error:
        "This registration changed since you opened it — reload and try again.",
    });
  });
});

describe("saveRegistrationDraft", () => {
  it("REFUSES to write once the status is no longer editable", async () => {
    dbMock.queue([registration({ status: "under_review" })]);

    expect(
      await saveRegistrationDraft({
        group: { id: GROUP, name: "Mad Hatters" },
        editionId: EDITION,
        values: values(),
      }),
    ).toEqual({
      ok: false,
      error: "This registration is locked while AfrikaBurn reviews it.",
    });
    expect(dbMock.transactions).toBe(0);
  });

  it("creates the row on first save, with the description on the GROUP", async () => {
    dbMock.queue(
      /* no registration yet */ [],
      /* the group description write */ [],
      /* the insert … returning */ [{ id: REGISTRATION }],
      /* the declarations delete */ [],
    );

    const result = await saveRegistrationDraft({
      group: { id: GROUP, name: "Mad Hatters" },
      editionId: EDITION,
      values: values(),
    });
    expect(result).toMatchObject({ ok: true, created: true });

    expect(dbMock.writesTo(schema.groups)[0]!.arg("set")).toMatchObject({
      description: "Tea, all night.",
    });
    // The description write, the upsert and the declaration replace commit
    // together — a failure between the delete and the insert would leave the
    // registration with NO supplier declarations at all.
    expect(dbMock.transactions).toBe(1);
    expect(dbMock.writesTo(schema.registrations)[0]!.tx).toBe(true);
  });

  it("recomputes completedSections server-side rather than trusting the client", async () => {
    dbMock.queue([], [], [{ id: REGISTRATION }], []);

    const result = await saveRegistrationDraft({
      group: { id: GROUP, name: "Mad Hatters" },
      editionId: EDITION,
      values: values(),
    });
    if (!result.ok) throw new Error("expected a successful save");

    // Nothing was filled in, so nothing is complete — whatever the wizard
    // believed.
    expect(result.completedSections).not.toContain("lnt");
    const written = dbMock.writesTo(schema.registrations)[0]!.arg("values") as {
      completedSections: string[];
    };
    expect(written.completedSections).toEqual(result.completedSections);
  });

  it("throws rather than half-saving when the insert returns no row", async () => {
    dbMock.queue([], [], /* returning nothing */ []);

    await expect(
      saveRegistrationDraft({
        group: { id: GROUP, name: "Mad Hatters" },
        editionId: EDITION,
        values: values(),
      }),
    ).rejects.toThrow("Could not start the registration.");
  });

  it("DROPS a suspended supplier posted straight at the write boundary", async () => {
    // The picker hides suspended suppliers, but the client is never trusted: a
    // camp admin could POST the id directly.
    dbMock.queue(
      [registration()],
      /* the group description write */ [],
      /* the registration update */ [],
      /* the declarations delete */ [],
      /* standing re-check */ [
        { id: "sup-good", standing: "good" },
        { id: "sup-bad", standing: "suspended" },
      ],
      /* the declarations insert */ [],
    );

    await saveRegistrationDraft({
      group: { id: GROUP, name: "Mad Hatters" },
      editionId: EDITION,
      values: values({ supplierIds: ["sup-good", "sup-bad", "sup-good"] }),
    });

    const insert = dbMock
      .writesTo(schema.supplierDeclarations)
      .find((q) => q.kind === "insert")!;
    // De-duplicated AND filtered.
    expect(insert.arg("values")).toEqual([
      { registrationId: REGISTRATION, supplierId: "sup-good" },
    ]);
  });

  it("issues no declaration insert when every posted supplier is ineligible", async () => {
    dbMock.queue(
      [registration()],
      [],
      [],
      [],
      [{ id: "sup-bad", standing: "suspended" }],
    );

    await saveRegistrationDraft({
      group: { id: GROUP, name: "Mad Hatters" },
      editionId: EDITION,
      values: values({ supplierIds: ["sup-bad"] }),
    });

    expect(
      dbMock
        .writesTo(schema.supplierDeclarations)
        .filter((q) => q.kind === "insert"),
    ).toHaveLength(0);
  });
});

describe("the read helpers", () => {
  it("getRegistration is null when the camp has not started one", async () => {
    dbMock.queue([]);
    expect(await getRegistration(GROUP, EDITION)).toBeNull();
  });

  it("getRegistrationCampContext is null for an unknown slug and for the org group", async () => {
    dbMock.queue([]);
    expect(
      await getRegistrationCampContext("nope", VIEWER, {
        id: EDITION,
        year: 2027,
        name: "AfrikaBurn 2027",
      }),
    ).toBeNull();

    dbMock.reset();
    dbMock.queue([
      {
        id: "org",
        name: "AfrikaBurn",
        slug: "afrikaburn",
        description: null,
        kind: "org",
      },
    ]);
    expect(
      await getRegistrationCampContext("afrikaburn", VIEWER, {
        id: EDITION,
        year: 2027,
        name: "AfrikaBurn 2027",
      }),
    ).toBeNull();
  });

  it("getRegistrationCampContext skips the membership read for a signed-out visitor", async () => {
    dbMock.queue([
      {
        id: GROUP,
        name: "Mad Hatters",
        slug: "mad-hatters",
        description: null,
        kind: "project",
      },
    ]);

    const context = await getRegistrationCampContext("mad-hatters", null, {
      id: EDITION,
      year: 2027,
      name: "AfrikaBurn 2027",
    });
    expect(context?.role).toBeNull();
    expect(dbMock.queries).toHaveLength(1);
  });

  it("getSectionReviews returns an empty list rather than null when there are none", async () => {
    dbMock.queue([]);
    expect(await getSectionReviews(REGISTRATION, EDITION)).toEqual([]);
    // No reply or author lookup was issued for an empty thread list.
    expect(dbMock.queries).toHaveLength(1);
  });

  it("getSectionReviews collapses an ORG author to AfrikaBurn and names a camp member", async () => {
    // The review team speaks as one; a camp member speaks as their handle.
    const createdAt = new Date("2026-08-01");
    dbMock.queue(
      [
        {
          id: "rev-1",
          sectionKey: "s2",
          status: "changes_requested",
          comment: "More LNT detail please.",
          createdAt,
        },
      ],
      [
        {
          id: "rep-1",
          reviewId: "rev-1",
          authorUserId: "org-user",
          body: "Have a look now.",
          createdAt,
        },
        {
          id: "rep-2",
          reviewId: "rev-1",
          authorUserId: VIEWER,
          body: "Updated.",
          createdAt,
        },
        {
          id: "rep-3",
          reviewId: "rev-1",
          authorUserId: null,
          body: "Anonymous.",
          createdAt,
        },
      ],
      /* the author usernames */ [
        { userId: VIEWER, username: "alice", sanitizedAt: null },
        { userId: "org-user", username: "reviewer", sanitizedAt: null },
      ],
      /* the org group */ [{ id: "org" }],
      /* which of them are org staff */ [{ userId: "org-user" }],
    );

    const [review] = await getSectionReviews(REGISTRATION, EDITION);
    expect(review!.replies.map((r) => [r.authorName, r.isOrg])).toEqual([
      ["AfrikaBurn", true],
      ["alice", false],
      ["A camp member", false],
    ]);
  });

  it("listSuppliersForPicker EXCLUDES suspended suppliers", async () => {
    dbMock.queue([
      { id: "s-1", name: "Bakkie Hire", services: "Vehicles", standing: "good", steps: null },
      { id: "s-2", name: "LosKop Catering", services: "Food", standing: "suspended", steps: {} },
      { id: "s-3", name: "Watch Co", services: "Gear", standing: "watch", steps: {} },
    ]);

    const options = await listSuppliersForPicker(EDITION);
    expect(options.map((o) => o.id)).toEqual(["s-1", "s-3"]);
    // `watch` standing renders as a subtle caution rather than being hidden.
    expect(options.find((o) => o.id === "s-3")!.caution).toBe(true);
    expect(options[0]!.onboardingComplete).toBe(false);
  });

  it("getDeclaredSupplierIds and getDeclaredSuppliers agree on an empty declaration", async () => {
    dbMock.queue([]);
    expect(await getDeclaredSupplierIds(REGISTRATION)).toEqual([]);

    dbMock.reset();
    dbMock.queue([]);
    expect(await getDeclaredSuppliers(REGISTRATION)).toEqual([]);
  });

  it("getDeclaredSuppliers still names a supplier that has SINCE been suspended", async () => {
    // The declaration is a record of what the camp submitted. Filtering it
    // through the picker made a declared supplier silently vanish from the
    // camp's own submitted answers the moment AfrikaBurn suspended them.
    dbMock.queue([
      { id: "s-2", name: "LosKop Catering", standing: "suspended" },
    ]);

    expect(await getDeclaredSuppliers(REGISTRATION)).toEqual([
      { id: "s-2", name: "LosKop Catering", standing: "suspended" },
    ]);
  });
});
