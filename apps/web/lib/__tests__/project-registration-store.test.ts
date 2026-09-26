import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { MAX_SAFETY_DOCUMENTS } from "@quagga/core";
import { boundStrings, dbMock, uniqueViolation } from "@/test/db-mock";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

// `createProjectRegistration` delegates name validation and the group/membership
// writes to the camp path, deliberately, so name dedupe and the
// creator-becomes-lead rule are shared rather than re-implemented. Those are
// `groups-store`'s to prove; what this file is about starts after them.
const prepareCampCreate = vi.fn();
const createCampWrites = vi.fn();
vi.mock("../groups-store", () => ({
  prepareCampCreate: (input: unknown) => prepareCampCreate(input),
  createCampWrites: (tx: unknown, prepared: unknown) =>
    createCampWrites(tx, prepared),
}));

const {
  projectRegistrationAnswerKey,
  createProjectRegistration,
  getProjectRegistrationForEdit,
  updateProjectRegistration,
  getProjectRegistrationAnswers,
  carryForwardProjectRegistration,
  PROJECT_REGISTRATION_VERSION,
} = await import("../project-registration-store");

/**
 * MUTANT VEHICLES AND ARTWORKS. A project "is" three rows written together — a
 * group, a `registrations` row carrying its status, and a namespaced answer
 * payload in the questionnaire spine. This file covers the decisions that layer
 * makes: which rows a submit writes, which statuses may still be edited, which
 * transition a resubmit resolves to, and — the one with a scar on it — which
 * EDITION's answers get overwritten.
 *
 * What it cannot prove is that any WHERE clause is right; the harness answers
 * from a queue and never sees a predicate. That is `pnpm e2e:local`'s job, and
 * the source comments in the store say so too.
 */

const GROUP = "aaaaaaaa-0000-4000-8000-000000000001";
const EDITION_2026 = "eeeeeeee-2026-4000-8000-000000000000";
const EDITION_2027 = "eeeeeeee-2027-4000-8000-000000000000";
const USER = "bbbbbbbb-0000-4000-8000-000000000001";

const FROZEN_NOW = new Date("2026-08-04T09:00:00.000Z").getTime();

const COLUMNS = {
  imageUrls: ["https://blob.example/1.jpg"],
  soundLevel: "amplified_small",
  areaDimensions: "4 m W × 4 m D × 12 m H",
  placementNotes: "Away from the binnekring, please",
  lntPlan: "Everything that arrives, leaves.",
  grantsInterest: true,
};

const ANSWERS = { baseVehicle: "1974 Land Rover", flameEffects: "none" };

function input(over: Record<string, unknown> = {}) {
  return {
    creatorId: USER,
    creatorEmail: "hatter@example.test",
    editionId: EDITION_2026,
    kind: "mutant_vehicle" as const,
    name: "The Teapot",
    description: "A driveable teapot.",
    submit: false,
    columns: COLUMNS,
    answers: ANSWERS,
    ...over,
  };
}

beforeEach(() => {
  dbMock.reset();
  prepareCampCreate.mockReset();
  createCampWrites.mockReset();
  prepareCampCreate.mockResolvedValue({
    ok: true,
    prepared: { name: "The Teapot", slug: "the-teapot" },
  });
  createCampWrites.mockResolvedValue({ groupId: GROUP, slug: "the-teapot" });
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("projectRegistrationAnswerKey", () => {
  it("namespaces by group AND kind, so one burner can register many", () => {
    // The `unique(user, definition_key)` index is why this matters: a key that
    // did not carry the group id would let a second vehicle overwrite the first.
    expect(projectRegistrationAnswerKey(GROUP, "mutant_vehicle")).toBe(
      `proj:${GROUP}:mv-registration`,
    );
    expect(projectRegistrationAnswerKey(GROUP, "artwork")).toBe(
      `proj:${GROUP}:art-registration`,
    );
    expect(projectRegistrationAnswerKey("other-group", "artwork")).not.toBe(
      projectRegistrationAnswerKey(GROUP, "artwork"),
    );
  });
});

describe("createProjectRegistration", () => {
  it("refuses without writing anything when the camp path rejects the name", async () => {
    prepareCampCreate.mockResolvedValue({
      ok: false,
      error: "Give your camp a name.",
    });

    const result = await createProjectRegistration(input({ name: " " }));

    expect(result).toEqual({ ok: false, error: "Give your camp a name." });
    // Validation happens BEFORE the transaction opens — a rejected name must
    // not leave a group behind.
    expect(dbMock.transactions).toBe(0);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("writes group, registration and answers in ONE transaction", async () => {
    const result = await createProjectRegistration(input());

    expect(result).toEqual({ ok: true, slug: "the-teapot" });
    expect(dbMock.transactions).toBe(1);
    // A half-registered project — a group with no registration, or a
    // registration with no answers — shows on the org status board as broken.
    // Every write this makes must be inside the one transaction.
    for (const q of dbMock.queries) expect(q.tx).toBe(true);
    expect(dbMock.writesTo(schema.registrations)).toHaveLength(1);
    expect(dbMock.writesTo(schema.questionnaireResponses)).toHaveLength(1);
  });

  it("mirrors only the columns whose camp meaning survives, and leaves sections empty", async () => {
    await createProjectRegistration(input());

    const values = dbMock
      .writesTo(schema.registrations)[0]!
      .arg("values") as Record<string, unknown>;

    expect(values).toMatchObject({
      groupId: GROUP,
      editionId: EDITION_2026,
      s1ContactEmail: "hatter@example.test",
      s2LntPlan: COLUMNS.lntPlan,
      s4AreaDimensions: COLUMNS.areaDimensions,
      s4LayoutUploadUrls: COLUMNS.imageUrls,
      s5AmplifiedMusic: COLUMNS.soundLevel,
      s5PlacementFirstChoice: COLUMNS.placementNotes,
      grantsInterest: true,
    });
    // `completed_sections` marks progress through the six-section CAMP wizard.
    // A vehicle never walks it, so an empty array is the truthful value and any
    // number here would be a lie the org console renders as progress.
    expect(values.completedSections).toEqual([]);
  });

  it("stores a declined grant interest as false, not as unanswered", async () => {
    // `grantsInterest ?? null` and `grantsInterest || null` look
    // interchangeable and are not: the column is `boolean | null`, so `false`
    // survives `??` and becomes NULL under `||`. That is the difference between
    // a project that said "no thanks" to a grant and one that was never asked —
    // and the org console reads those two states differently.
    await createProjectRegistration(
      input({ columns: { ...COLUMNS, grantsInterest: false } }),
    );

    const values = dbMock
      .writesTo(schema.registrations)[0]!
      .arg("values") as Record<string, unknown>;
    expect(values.grantsInterest).toBe(false);
    expect(values.grantsInterest).not.toBeNull();
  });

  it("saves a draft as draft, with no submittedAt and no completedAt", async () => {
    await createProjectRegistration(input({ submit: false }));

    const reg = dbMock.writesTo(schema.registrations)[0]!.arg("values") as {
      status: string;
      submittedAt: Date | null;
    };
    const ans = dbMock
      .writesTo(schema.questionnaireResponses)[0]!
      .arg("values") as { completedAt: Date | null };

    expect(reg.status).toBe("draft");
    expect(reg.submittedAt).toBeNull();
    expect(ans.completedAt).toBeNull();
  });

  it("stamps both rows at the same instant on submit", async () => {
    await createProjectRegistration(input({ submit: true }));

    const reg = dbMock.writesTo(schema.registrations)[0]!.arg("values") as {
      status: string;
      submittedAt: Date;
    };
    const ans = dbMock
      .writesTo(schema.questionnaireResponses)[0]!
      .arg("values") as { completedAt: Date; definitionVersion: string };

    expect(reg.status).toBe("submitted");
    expect(reg.submittedAt.getTime()).toBe(FROZEN_NOW);
    // Two different clocks would put a submission's answers a few ms before or
    // after its registration, which reads as tampering in the audit trail.
    expect(ans.completedAt.getTime()).toBe(FROZEN_NOW);
    expect(ans.definitionVersion).toBe(PROJECT_REGISTRATION_VERSION);
  });

  it("repeats the partial index's predicate on the answer upsert", async () => {
    await createProjectRegistration(input());

    const upsert = dbMock.writesTo(schema.questionnaireResponses)[0]!;
    const conflict = upsert.arg("onConflictDoUpdate") as {
      targetWhere?: unknown;
      target: unknown[];
    };

    // Migration 0028 split the uniqueness rule in two, and Postgres will not
    // use a PARTIAL index to resolve ON CONFLICT unless the statement repeats
    // its predicate. Without `targetWhere` the insert fails outright — which is
    // exactly what happened to every questionnaire write, the Burner Bio
    // included, until an e2e run caught it.
    expect(conflict.targetWhere).toBeDefined();
    expect(conflict.target).toHaveLength(3);
  });

  it("turns a lost name race into the same message the camp path gives", async () => {
    createCampWrites.mockRejectedValue(uniqueViolation("groups_name_uniq"));

    const result = await createProjectRegistration(input());

    // A 500 on a name collision is a dead end; this is recoverable advice.
    expect(result).toEqual({
      ok: false,
      error: "A project of this kind already uses that name. Pick another.",
    });
  });

  it("rethrows anything that is not a unique violation", async () => {
    // Swallowing an unknown failure here would report a project as created
    // when nothing was written.
    createCampWrites.mockRejectedValue(new Error("connection terminated"));

    await expect(createProjectRegistration(input())).rejects.toThrow(
      "connection terminated",
    );
  });
});

describe("getProjectRegistrationForEdit", () => {
  const groupRow = {
    id: GROUP,
    name: "The Teapot",
    slug: "the-teapot",
    description: "A driveable teapot.",
    kind: "mutant_vehicle",
  };

  it("is null when the slug belongs to a group of a DIFFERENT kind", async () => {
    // `/art/the-teapot` must not render a vehicle's registration. Returning it
    // would show one project's answers under another's form.
    dbMock.queue([{ ...groupRow, kind: "camp" }]);

    expect(
      await getProjectRegistrationForEdit(
        "the-teapot",
        "artwork",
        USER,
        EDITION_2026,
      ),
    ).toBeNull();
    // Nothing further was read — no membership, no registration, no answers.
    expect(dbMock.queries).toHaveLength(1);
  });

  it("is null for an unknown slug", async () => {
    dbMock.queue([]);
    expect(
      await getProjectRegistrationForEdit(
        "no-such-thing",
        "artwork",
        USER,
        EDITION_2026,
      ),
    ).toBeNull();
  });

  it("reports draft-and-editable when no registration row exists yet", async () => {
    dbMock.queue([groupRow], [{ role: "lead" }], [], []);

    const ctx = await getProjectRegistrationForEdit(
      "the-teapot",
      "mutant_vehicle",
      USER,
      EDITION_2026,
    );

    // An unstarted project is a draft, not an error — the edit page opens on an
    // empty form rather than a 404.
    expect(ctx).toMatchObject({
      status: "draft",
      editable: true,
      role: "lead",
    });
    expect(ctx!.answers).toBeNull();
    expect(ctx!.group).toEqual({
      id: GROUP,
      name: "The Teapot",
      slug: "the-teapot",
      description: "A driveable teapot.",
    });
  });

  it("returns a null role for a signed-in stranger rather than inventing one", async () => {
    dbMock.queue([groupRow], [], [{ status: "draft" }], []);

    const ctx = await getProjectRegistrationForEdit(
      "the-teapot",
      "mutant_vehicle",
      "someone-else",
      EDITION_2026,
    );

    // The page decides what a null role may do. Defaulting to any membership
    // role here would hand that decision to the wrong layer.
    expect(ctx!.role).toBeNull();
  });

  it.each([
    ["draft", true],
    ["changes_requested", true],
    ["submitted", false],
    ["approved", false],
    ["rejected", false],
    ["withdrawn", false],
  ])("marks %s as editable=%s", async (status, editable) => {
    dbMock.queue([groupRow], [{ role: "lead" }], [{ status }], []);

    const ctx = await getProjectRegistrationForEdit(
      "the-teapot",
      "mutant_vehicle",
      USER,
      EDITION_2026,
    );

    expect(ctx).toMatchObject({ status, editable });
  });

  it("prefills the prior answers", async () => {
    dbMock.queue(
      [groupRow],
      [{ role: "lead" }],
      [{ status: "changes_requested" }],
      [{ responses: ANSWERS }],
    );

    const ctx = await getProjectRegistrationForEdit(
      "the-teapot",
      "mutant_vehicle",
      USER,
      EDITION_2026,
    );

    expect(ctx!.answers).toEqual(ANSWERS);
  });
});

describe("updateProjectRegistration", () => {
  function updateInput(over: Record<string, unknown> = {}) {
    return {
      groupId: GROUP,
      editionId: EDITION_2026,
      kind: "mutant_vehicle" as const,
      editorUserId: USER,
      editorEmail: "hatter@example.test",
      description: "Now with a spout.",
      submit: false,
      columns: COLUMNS,
      answers: ANSWERS,
      ...over,
    };
  }

  /**
   * A RETURNING PROJECT'S NEW YEAR. The create path writes the first edition's
   * row with the group, so this used to refuse an absent row — which meant no
   * project could ever register a second edition: the edit page opened on an
   * editable draft and every save answered "hasn't been started yet". Queue:
   * status probe (none), then in the transaction the group read, the groups
   * update, the registration insert, the answer insert, the documents read.
   */
  it("opens this edition's registration for a returning project", async () => {
    dbMock.queue([], [{ slug: "the-teapot" }], [], [{ id: "reg-2027" }]);

    const result = await updateProjectRegistration(
      updateInput({ editionId: EDITION_2027 }),
    );

    expect(result).toEqual({ ok: true, slug: "the-teapot" });
    expect(dbMock.transactions).toBe(1);
    const reg = dbMock.writesTo(schema.registrations)[0]!;
    expect(reg.kind).toBe("insert");
    expect(reg.arg("values")).toMatchObject({
      groupId: GROUP,
      editionId: EDITION_2027,
      status: "draft",
      s1ContactEmail: "hatter@example.test",
      completedSections: [],
      submittedAt: null,
    });
    const ans = dbMock.writesTo(schema.questionnaireResponses)[0]!;
    expect(ans.arg("values")).toMatchObject({
      editionId: EDITION_2027,
      definitionKey: `proj:${GROUP}:mv-registration`,
      completedAt: null,
    });
  });

  it("submits a returning project's first save through the state machine", async () => {
    dbMock.queue([], [{ slug: "the-teapot" }], [], [{ id: "reg-2027" }]);

    await updateProjectRegistration(
      updateInput({ editionId: EDITION_2027, submit: true }),
    );

    const values = dbMock.writesTo(schema.registrations)[0]!.arg("values") as {
      status: string;
      submittedAt: Date;
    };
    expect(values.status).toBe("submitted");
    expect(values.submittedAt.getTime()).toBe(FROZEN_NOW);
  });

  it("tells a co-lead who lost the new-year race to reload", async () => {
    // The insert's ON CONFLICT DO NOTHING returned no row: someone else opened
    // this edition first. Writing answers against nothing would orphan them.
    dbMock.queue([], [{ slug: "the-teapot" }], [], []);

    const result = await updateProjectRegistration(
      updateInput({ editionId: EDITION_2027 }),
    );

    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.questionnaireResponses)).toHaveLength(0);
  });

  it("refuses a locked registration, and writes nothing", async () => {
    dbMock.queue([{ status: "approved", slug: "the-teapot" }]);

    const result = await updateProjectRegistration(updateInput());

    // An approved project whose answers can still be edited is an approval that
    // means nothing.
    expect(result).toEqual({
      ok: false,
      error:
        "This registration is locked — it can't be edited in its current state.",
    });
    expect(dbMock.transactions).toBe(0);
    expect(dbMock.writesTo(schema.registrations)).toHaveLength(0);
  });

  /**
   * The harness consumes one queued value per AWAITED chain, writes included,
   * so an update's reads have to be queued around its writes. In order:
   * the status probe, the `groups` update, the `registrations` update, then the
   * existing-answer probe.
   */
  function queueUpdate(
    current: unknown,
    existingAnswers: unknown[],
    existingDocuments: unknown[] = [],
  ) {
    dbMock.queue([current], [], [], existingAnswers, [], existingDocuments);
  }

  it("saves an editable draft without changing its status", async () => {
    queueUpdate({ id: "reg-1", status: "draft", slug: "the-teapot" }, [
      { id: "resp-1" },
    ]);

    const result = await updateProjectRegistration(updateInput());

    expect(result).toEqual({ ok: true, slug: "the-teapot" });
    const set = dbMock.writesTo(schema.registrations)[0]!.arg("set") as {
      status: string;
      submittedAt?: Date;
    };
    expect(set.status).toBe("draft");
    // Not submitted, so no submission timestamp is invented.
    expect(set.submittedAt).toBeUndefined();
  });

  it.each(["draft", "changes_requested"])(
    "sends %s to submitted through the shared state machine",
    async (from) => {
      queueUpdate({ id: "reg-1", status: from, slug: "the-teapot" }, [
        { id: "resp-1" },
      ]);

      await updateProjectRegistration(updateInput({ submit: true }));

      // Both actions land on `submitted` — there is no separate "resubmitted"
      // status. The point is that the move goes through `resolveCampAction`,
      // which THROWS on an illegal transition, rather than through a local
      // string assignment that would happily write any status it was handed.
      const set = dbMock.writesTo(schema.registrations)[0]!.arg("set") as {
        status: string;
        submittedAt: Date;
      };
      expect(set.status).toBe("submitted");
      expect(set.submittedAt.getTime()).toBe(FROZEN_NOW);
    },
  );

  it("updates the EXISTING answer row rather than forking a second", async () => {
    queueUpdate({ id: "reg-1", status: "draft", slug: "the-teapot" }, [
      { id: "resp-existing" },
    ]);

    await updateProjectRegistration(updateInput({ editorUserId: "co-lead" }));

    const writes = dbMock.writesTo(schema.questionnaireResponses);
    expect(writes).toHaveLength(1);
    // A co-lead editing a lead's registration must update the one record. Two
    // rows for one project means the read picks whichever the planner returns.
    expect(writes[0]!.kind).toBe("update");
    expect(writes[0]!.arg("set")).toMatchObject({ responses: ANSWERS });
  });

  it("inserts an answer row keyed to the editor when none exists", async () => {
    queueUpdate({ id: "reg-1", status: "draft", slug: "the-teapot" }, []);

    await updateProjectRegistration(updateInput({ editorUserId: "co-lead" }));

    const write = dbMock.writesTo(schema.questionnaireResponses)[0]!;
    expect(write.kind).toBe("insert");
    expect(write.arg("values")).toMatchObject({
      userId: "co-lead",
      definitionKey: `proj:${GROUP}:mv-registration`,
      editionId: EDITION_2026,
    });
  });

  it("binds the edition into the existing-answer probe", async () => {
    queueUpdate({ id: "reg-1", status: "draft", slug: "the-teapot" }, [
      { id: "resp-2027" },
    ]);

    await updateProjectRegistration(updateInput({ editionId: EDITION_2027 }));

    // A project's answer key is DETERMINISTIC (`proj:<groupId>:mv-registration`),
    // so a probe matching on the key alone found and overwrote the PREVIOUS
    // year's answers the moment the same vehicle registered twice. Both the key
    // and the edition have to be bound.
    const probe = dbMock.queriesOfKind("select")[1]!;
    const bound = boundStrings(probe);
    expect(bound).toContain(EDITION_2027);
    expect(bound).toContain(`proj:${GROUP}:mv-registration`);
    // ...and ordered, so a duplicate cannot make which row wins depend on the
    // planner.
    expect(probe.called("orderBy")).toBe(true);
  });

  it("commits group, registration and answers together", async () => {
    queueUpdate({ id: "reg-1", status: "draft", slug: "the-teapot" }, [
      { id: "r" },
    ]);

    await updateProjectRegistration(updateInput());

    expect(dbMock.transactions).toBe(1);
    for (const q of dbMock.queries.filter((q) => q.kind !== "select")) {
      expect(q.tx).toBe(true);
    }
    expect(dbMock.writesTo(schema.groups)[0]!.arg("set")).toMatchObject({
      description: "Now with a spout.",
    });
  });
});

describe("work access passes", () => {
  it("writes the WAP request to the camp column on create", async () => {
    await createProjectRegistration(
      input({ columns: { ...COLUMNS, workAccessPasses: 5 } }),
    );
    const values = dbMock
      .writesTo(schema.registrations)[0]!
      .arg("values") as Record<string, unknown>;
    // The SAME column a camp's Form 2 writes, so WAP allocation reads one
    // column whatever kind of group asked.
    expect(values.s4WorkAccessPasses).toBe(5);
  });

  it("writes the WAP request on update, and clears it when withdrawn", async () => {
    dbMock.queue(
      [{ id: "reg-1", status: "draft", slug: "the-teapot" }],
      [],
      [],
      [{ id: "r" }],
    );
    await updateProjectRegistration({
      groupId: GROUP,
      editionId: EDITION_2026,
      kind: "artwork",
      editorUserId: USER,
      editorEmail: null,
      description: null,
      submit: false,
      columns: { ...COLUMNS, workAccessPasses: null },
      answers: ANSWERS,
    });
    const set = dbMock.writesTo(schema.registrations)[0]!.arg("set") as Record<
      string,
      unknown
    >;
    expect(set).toHaveProperty("s4WorkAccessPasses", null);
  });
});

describe("safety documents", () => {
  const DOC = {
    title: "Roadworthy certificate",
    url: "https://blob.example/roadworthy.pdf",
    expiresOn: "2027-06-30",
  };

  it("attaches documents to the new registration row on create", async () => {
    // Queue: registration insert (returning its id), the documents read.
    dbMock.queue([{ id: "reg-1" }], []);

    await createProjectRegistration(input({ safetyDocuments: [DOC] }));

    const docs = dbMock.writesTo(schema.registrationSafetyDocuments);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.tx).toBe(true);
    expect(docs[0]!.arg("values")).toEqual([
      { registrationId: "reg-1", ...DOC, uploadedByUserId: USER },
    ]);
  });

  it("keeps an unchanged document's row, deletes a removed one, inserts a new one", async () => {
    const kept = { id: "doc-kept", ...DOC };
    const removed = {
      id: "doc-gone",
      title: "Old fire cert",
      url: "https://blob.example/old.pdf",
      expiresOn: "2026-01-01",
    };
    const added = {
      title: "Fire safety certificate",
      url: "https://blob.example/fire.pdf",
      expiresOn: "2027-12-31",
    };
    dbMock.queue(
      [{ id: "reg-1", status: "draft", slug: "the-teapot" }],
      [],
      [],
      [{ id: "resp-1" }],
      [],
      [kept, removed],
    );

    await updateProjectRegistration({
      groupId: GROUP,
      editionId: EDITION_2026,
      kind: "mutant_vehicle",
      editorUserId: "co-lead",
      editorEmail: null,
      description: null,
      submit: false,
      columns: COLUMNS,
      answers: ANSWERS,
      safetyDocuments: [DOC, added],
    });

    const writes = dbMock.writesTo(schema.registrationSafetyDocuments);
    const deletes = writes.filter((w) => w.kind === "delete");
    const inserts = writes.filter((w) => w.kind === "insert");
    expect(deletes).toHaveLength(1);
    const bound = boundStrings(deletes[0]!);
    expect(bound).toContain("doc-gone");
    // The unchanged document is NOT re-inserted under whoever saved last.
    expect(bound).not.toContain("doc-kept");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.arg("values")).toEqual([
      { registrationId: "reg-1", ...added, uploadedByUserId: "co-lead" },
    ]);
  });

  const groupRow = {
    id: GROUP,
    name: "The Teapot",
    slug: "the-teapot",
    description: null,
    kind: "mutant_vehicle",
  };
  const regRow = {
    id: "reg-1",
    status: "draft",
    workAccessPasses: 4,
    carriedForwardAt: null,
  };

  it.each(["member", "god", "org_staff", "engineer"])(
    "never reads them for a %s",
    async (role) => {
      dbMock.queue([groupRow], [{ role }], [regRow], []);

      const ctx = await getProjectRegistrationForEdit(
        "the-teapot",
        "mutant_vehicle",
        USER,
        EDITION_2026,
      );

      expect(ctx!.safetyDocuments).toEqual([]);
      // Refused BEFORE the read, not filtered after it.
      expect(
        dbMock.queriesTouching(schema.registrationSafetyDocuments),
      ).toHaveLength(0);
    },
  );

  it.each(["lead", "admin"])("reads them for the %s", async (role) => {
    dbMock.queue([groupRow], [{ role }], [regRow], [], [{ id: "d", ...DOC }]);

    const ctx = await getProjectRegistrationForEdit(
      "the-teapot",
      "mutant_vehicle",
      USER,
      EDITION_2026,
    );

    expect(ctx!.safetyDocuments).toEqual([{ id: "d", ...DOC }]);
    expect(ctx!.workAccessPasses).toBe(4);
  });
});

describe("carryForwardProjectRegistration", () => {
  const SOURCE = {
    registrationId: "reg-2026",
    editionId: EDITION_2026,
    editionYear: 2026,
    editionName: "AfrikaBurn 2026",
    status: "approved",
  };
  const PRIOR = {
    base_vehicle: "1974 Land Rover",
    mutation_description: "A driveable teapot.",
    photos: ["https://blob.example/teapot.jpg"],
    soop_level: "amplified_small",
    flame_effects: false,
    night_driving: true,
    acknowledgements: ["speed_limit", "testing_station", "driver_indemnity"],
    work_access_passes: 3,
  };
  const STILL_VALID = {
    title: "Roadworthy",
    url: "https://blob.example/rw.pdf",
    expiresOn: "2027-12-31",
    uploadedByUserId: "original-uploader",
  };
  const LAPSES = {
    title: "Fire cert",
    url: "https://blob.example/fire.pdf",
    expiresOn: "2027-04-28",
    uploadedByUserId: "original-uploader",
  };

  function carry() {
    return carryForwardProjectRegistration({
      groupId: GROUP,
      kind: "mutant_vehicle",
      editionId: EDITION_2027,
      editionYear: 2027,
      editionEndDate: "2027-05-02",
      editorUserId: USER,
      editorEmail: "hatter@example.test",
    });
  }

  it("refuses a first-timer", async () => {
    dbMock.queue([]);
    expect((await carry()).ok).toBe(false);
    expect(dbMock.transactions).toBe(0);
  });

  it("seeds a DRAFT with only the carried answers, never complete", async () => {
    // source · prior answers · prior docs · [tx] existing reg · current answers
    // · registration insert (returning) · answer insert · docs insert
    dbMock.queue(
      [SOURCE],
      [{ responses: PRIOR }],
      [STILL_VALID, LAPSES],
      [],
      [],
      [{ id: "reg-2027" }],
    );

    const result = await carry();

    expect(result).toMatchObject({ ok: true, filled: 3, documents: 1 });
    const reg = dbMock.writesTo(schema.registrations)[0]!;
    expect(reg.arg("values")).toMatchObject({
      status: "draft",
      editionId: EDITION_2027,
      carriedForwardFromId: "reg-2026",
      s4LayoutUploadUrls: PRIOR.photos,
      completedSections: [],
    });
    expect(reg.arg("values")).not.toHaveProperty("submittedAt");

    const ans = dbMock.writesTo(schema.questionnaireResponses)[0]!;
    const values = ans.arg("values") as {
      responses: Record<string, unknown>;
      completedAt: Date | null;
    };
    // PRE-FILLED IS NOT COMPLETE.
    expect(values.completedAt).toBeNull();
    expect(values.responses).toEqual({
      base_vehicle: PRIOR.base_vehicle,
      mutation_description: PRIOR.mutation_description,
      photos: PRIOR.photos,
    });
    // The DMV acknowledgements are a person committing THIS year.
    expect(values.responses).not.toHaveProperty("acknowledgements");

    // Only the document still in force on the event's last day comes across,
    // as a NEW row, under its original uploader.
    const docs = dbMock.writesTo(schema.registrationSafetyDocuments);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.arg("values")).toEqual([
      {
        registrationId: "reg-2027",
        title: STILL_VALID.title,
        url: STILL_VALID.url,
        expiresOn: STILL_VALID.expiresOn,
        uploadedByUserId: "original-uploader",
      },
    ]);
  });

  it("fills only what this year's draft left empty", async () => {
    dbMock.queue(
      [SOURCE],
      [{ responses: PRIOR }],
      [],
      [{ id: "reg-2027", status: "draft", carriedForwardAt: null }],
      [{ id: "resp-2027", responses: { base_vehicle: "Typed this year" } }],
      [], // documents the draft already holds
      [{ id: "reg-2027" }],
    );

    const result = await carry();

    expect(result).toMatchObject({ ok: true, filled: 2 });
    const ans = dbMock.writesTo(schema.questionnaireResponses)[0]!;
    expect(ans.kind).toBe("update");
    expect(ans.arg("set")).toMatchObject({
      responses: { base_vehicle: "Typed this year" },
      completedAt: null,
    });
  });

  it.each(["submitted", "under_review", "approved"])(
    "refuses a %s registration and writes nothing",
    async (status) => {
      dbMock.queue(
        [SOURCE],
        [{ responses: PRIOR }],
        [],
        [{ id: "reg-2027", status, carriedForwardAt: null }],
      );

      expect((await carry()).ok).toBe(false);
      expect(dbMock.queries.filter((q) => q.kind !== "select")).toHaveLength(0);
    },
  );

  it("refuses a second carry", async () => {
    dbMock.queue(
      [SOURCE],
      [{ responses: PRIOR }],
      [],
      [{ id: "reg-2027", status: "draft", carriedForwardAt: new Date() }],
    );
    expect(await carry()).toEqual({
      ok: false,
      error: "Last year's answers have already been brought across.",
    });
  });

  it("loses a race honestly instead of overwriting", async () => {
    // The compare-and-set UPDATE matched no row: an autosave or another carry
    // moved the registration between the read and the write.
    dbMock.queue(
      [SOURCE],
      [{ responses: PRIOR }],
      [],
      [{ id: "reg-2027", status: "draft", carriedForwardAt: null }],
      [],
      [],
      [],
    );
    const result = await carry();
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.questionnaireResponses)).toHaveLength(0);
  });
});

describe("carryForwardProjectRegistration — an existing draft", () => {
  // Regression: a carry used to insert every still-valid prior document on top
  // of whatever this year's draft already held — no cap, no de-dupe — so the
  // draft could end with 7+ rows, and the next save was refused by
  // SafetyDocumentList.max(MAX_SAFETY_DOCUMENTS) until the lead deleted one.
  const SOURCE = {
    registrationId: "reg-2026",
    editionId: EDITION_2026,
    editionYear: 2026,
    editionName: "AfrikaBurn 2026",
    status: "approved",
  };
  const doc = (n: number) => ({
    title: `Certificate ${n}`,
    url: `https://blob.example/cert-${n}.pdf`,
    expiresOn: "2027-12-31",
    uploadedByUserId: "original-uploader",
  });

  function carry() {
    return carryForwardProjectRegistration({
      groupId: GROUP,
      kind: "mutant_vehicle",
      editionId: EDITION_2027,
      editionYear: 2027,
      editionEndDate: "2027-05-02",
      editorUserId: USER,
      editorEmail: "hatter@example.test",
    });
  }

  function queueCarry(held: { url: string }[], carried: object[]) {
    // source · prior answers · prior docs · [tx] existing reg (locked) ·
    // current answers (locked) · held docs · registration CAS · answer update
    dbMock.queue(
      [SOURCE],
      [{ responses: { base_vehicle: "1974 Land Rover" } }],
      carried,
      [{ id: "reg-2027", status: "draft", carriedForwardAt: null }],
      [{ id: "resp-2027", responses: {} }],
      held,
      [{ id: "reg-2027" }],
    );
  }

  it("never leaves the draft with more than MAX_SAFETY_DOCUMENTS", async () => {
    const held = [1, 2, 3, 4, 5].map(doc);
    queueCarry(held, [6, 7, 8].map(doc));

    const result = await carry();

    expect(result).toMatchObject({
      ok: true,
      documents: 1,
      documentsSkipped: 2,
    });
    const inserted = dbMock
      .writesTo(schema.registrationSafetyDocuments)[0]!
      .arg("values") as { url: string }[];
    expect(held.length + inserted.length).toBeLessThanOrEqual(
      MAX_SAFETY_DOCUMENTS,
    );
    expect(inserted.map((d) => d.url)).toEqual([doc(6).url]);
  });

  it("does not duplicate a file this year's draft already holds", async () => {
    queueCarry([doc(1)], [doc(1), doc(2)]);

    const result = await carry();

    expect(result).toMatchObject({
      ok: true,
      documents: 1,
      documentsSkipped: 1,
    });
    const inserted = dbMock
      .writesTo(schema.registrationSafetyDocuments)[0]!
      .arg("values") as { url: string }[];
    expect(inserted.map((d) => d.url)).toEqual([doc(2).url]);
  });

  it("locks the registration and the answer row before merging", async () => {
    // The merge replaces the whole answer payload; without these row locks a
    // co-lead's save committing between the read and the write was lost.
    queueCarry([], []);

    expect((await carry()).ok).toBe(true);

    const txReads = dbMock.queriesOfKind("select").filter((q) => q.tx);
    const regRead = txReads.find((q) =>
      q.calls.some((c) => c.args.includes(schema.registrations)),
    )!;
    const answerRead = txReads.find((q) =>
      q.calls.some((c) => c.args.includes(schema.questionnaireResponses)),
    )!;
    expect(regRead.arg("for")).toBe("update");
    expect(answerRead.arg("for")).toBe("update");
    // Registration first — the order a save writes them in, so no deadlock.
    expect(txReads.indexOf(regRead)).toBeLessThan(txReads.indexOf(answerRead));
  });
});

describe("getProjectRegistrationAnswers", () => {
  it("returns the stored payload", async () => {
    dbMock.queue([{ responses: ANSWERS }]);
    expect(
      await getProjectRegistrationAnswers(
        GROUP,
        "mutant_vehicle",
        EDITION_2026,
      ),
    ).toEqual(ANSWERS);
  });

  it("is null when the project never submitted this form", async () => {
    dbMock.queue([]);
    expect(
      await getProjectRegistrationAnswers(GROUP, "artwork", EDITION_2026),
    ).toBeNull();
  });

  it("orders the read so a duplicate cannot make it non-deterministic", async () => {
    dbMock.queue([{ responses: ANSWERS }]);
    await getProjectRegistrationAnswers(GROUP, "artwork", EDITION_2026);
    // Without ORDER BY, two rows for one key return whichever the planner felt
    // like — so the same page could show different answers on refresh.
    expect(dbMock.onlyQuery("select").called("orderBy")).toBe(true);
  });
});
