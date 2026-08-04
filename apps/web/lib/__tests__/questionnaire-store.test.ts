import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import type { Questionnaire } from "@quagga/types";
import { boundStrings, dbMock } from "@/test/db-mock";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const sendEmail = vi.fn();
vi.mock("../email", () => ({ sendEmail: (a: unknown) => sendEmail(a) }));

const insertNotifications = vi.fn();
vi.mock("../notifications", () => ({
  insertNotifications: (h: unknown, r: unknown) => insertNotifications(h, r),
}));

const getActiveEdition = vi.fn();
vi.mock("../edition", () => ({ getActiveEdition: () => getActiveEdition() }));

const completeRequiredAction = vi.fn();
vi.mock("../required-actions", () => ({
  completeRequiredAction: (...a: unknown[]) => completeRequiredAction(...a),
}));

const {
  isProjectDefinitionKey,
  createAndActivateProjectQuestionnaire,
  listProjectQuestionnaires,
  getActivation,
  getActivationResults,
  getFillView,
  listPendingQuestionnaires,
  submitResponse,
} = await import("../questionnaire-store");

/**
 * THE PROJECT QUESTIONNAIRE ENGINE. A camp writes a questionnaire, sends it to
 * an audience, and reads the answers back. Three properties in here have each
 * already broken in production and are pinned individually below:
 *
 *   - the ON CONFLICT predicate that migration 0028 made mandatory (its absence
 *     took out every questionnaire write, the Burner Bio included);
 *   - the answer read is scoped by EDITION and deliberately NOT by activation
 *     id, because a re-send within one edition revises a living answer;
 *   - org-internal activations must never surface in the participant app.
 *
 * `@quagga/core` and `@quagga/types` stay real throughout — the audience
 * resolver, the validator and the name redactor are the code that ships, and
 * stubbing them would test the stub.
 */

const GROUP = "aaaaaaaa-0000-4000-8000-000000000001";
const EDITION_2026 = "eeeeeeee-2026-4000-8000-000000000000";
const EDITION_2027 = "eeeeeeee-2027-4000-8000-000000000000";
const AUTHOR = "bbbbbbbb-0000-4000-8000-000000000001";
const ACTIVATION = "cccccccc-0000-4000-8000-000000000001";

const FROZEN_NOW = new Date("2026-08-04T09:00:00.000Z").getTime();

/** The project's own members — the default a camp's builder sends to. */
const PROJECT_AUDIENCE = {
  kind: "project" as const,
  groupId: GROUP,
  mode: "everyone" as const,
  roleIds: [],
};

/** A one-question questionnaire — enough for the validator to have an opinion. */
const DEFINITION: Questionnaire = {
  version: "1",
  pages: [
    {
      id: "p1",
      kind: "questions",
      title: "Getting there",
      questions: [
        {
          id: "arrival",
          kind: "short_text",
          prompt: "When do you arrive?",
          maxLength: 120,
          required: true,
        },
      ],
    },
  ],
};

function activationRow(over: Record<string, unknown> = {}) {
  return {
    id: ACTIVATION,
    questionnaireKey: `proj:${GROUP}:abc123`,
    title: "Build week plan",
    description: null,
    blocking: false,
    dueAt: null,
    status: "open",
    authoredScope: "group",
    groupId: GROUP,
    editionId: EDITION_2026,
    audience: PROJECT_AUDIENCE,
    snapshotDefinition: DEFINITION,
    liveDefinition: DEFINITION,
    ...over,
  };
}

beforeEach(() => {
  dbMock.reset();
  sendEmail.mockReset().mockResolvedValue({ ok: true, delivered: true });
  insertNotifications.mockReset().mockResolvedValue(undefined);
  getActiveEdition.mockReset().mockResolvedValue({ id: EDITION_2026 });
  completeRequiredAction.mockReset().mockResolvedValue(undefined);
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isProjectDefinitionKey", () => {
  it("matches only its own project's namespace", () => {
    // The builder lists definitions by this predicate. A loose match would show
    // one camp another camp's questionnaires.
    expect(isProjectDefinitionKey(`proj:${GROUP}:abc123`, GROUP)).toBe(true);
    expect(isProjectDefinitionKey(`proj:other-group:abc123`, GROUP)).toBe(
      false,
    );
    expect(isProjectDefinitionKey("burner-bio", GROUP)).toBe(false);
    // A key that merely CONTAINS the group id is not a key that belongs to it.
    expect(isProjectDefinitionKey(`x:proj:${GROUP}:a`, GROUP)).toBe(false);
  });
});

describe("createAndActivateProjectQuestionnaire", () => {
  function create(over: Record<string, unknown> = {}) {
    return createAndActivateProjectQuestionnaire({
      groupId: GROUP,
      editionId: EDITION_2026,
      createdByUserId: AUTHOR,
      title: "Build week plan",
      description: null,
      definition: DEFINITION,
      audience: PROJECT_AUDIENCE,
      blocking: false,
      dueAt: null,
      ...over,
    } as Parameters<typeof createAndActivateProjectQuestionnaire>[0]);
  }

  /**
   * The audience resolution reads three tables BEFORE the transaction opens:
   * memberships, role assignments, project roles. Then the transaction writes
   * the definition, the activation (returning its id), and the required
   * actions. The harness consumes one queued value per awaited chain.
   */
  function queueCreate(members: { userId: string; role: string }[]) {
    dbMock.queue(
      members.map((m, i) => ({
        membershipId: `m${i}`,
        userId: m.userId,
        groupId: GROUP,
        role: m.role,
      })),
      /* role assignments */ [],
      /* project roles   */ [],
      /* insert definition */ [],
      /* insert activation returning */ [{ id: ACTIVATION }],
    );
  }

  it("writes definition, activation and required actions in ONE transaction", async () => {
    queueCreate([
      { userId: "u1", role: "lead" },
      { userId: "u2", role: "member" },
    ]);
    dbMock.queue(
      /* required actions insert */ [],
      /* group name for the inbox row */ [{ name: "Mad Hatters" }],
      /* users for email */ [{ id: "u1", email: "a@example.test" }],
    );

    const result = await create();

    expect(result.activationId).toBe(ACTIVATION);
    expect(result.sent).toBe(2);
    expect(dbMock.transactions).toBe(1);
    // A failure after the definition leaves an orphan; a failure after the
    // activation leaves a questionnaire nobody is gated to answer — one that
    // silently reaches no one.
    for (const t of [
      "questionnaireDefinitions",
      "questionnaireActivations",
    ] as const) {
      expect(dbMock.writesTo(schema[t])[0]!.tx).toBe(true);
    }
    expect(dbMock.writesTo(schema.requiredActions)[0]!.tx).toBe(true);
  });

  it("snapshots the definition AS SENT onto the activation", async () => {
    queueCreate([{ userId: "u1", role: "lead" }]);

    await create();

    const values = dbMock
      .writesTo(schema.questionnaireActivations)[0]!
      .arg("values") as { definition: unknown; audience: unknown };
    // Later edits to the live definition must never mutate what these
    // respondents were shown — otherwise a question changes under an answer.
    expect(values.definition).toEqual(DEFINITION);
    expect(values.audience).toEqual(PROJECT_AUDIENCE);
  });

  it("keys required actions per EDITION so a later burn can raise them again", async () => {
    queueCreate([{ userId: "u1", role: "lead" }]);

    await create();

    const write = dbMock.writesTo(schema.requiredActions)[0]!;
    const rows = write.arg("values") as { editionId: string }[];
    expect(rows[0]!.editionId).toBe(EDITION_2026);
    // Migration 0024 made the uniqueness key (user, edition, action_key). Without
    // the edition in the conflict target the same action key would be
    // permanently spent after one burn.
    const conflict = write.arg("onConflictDoNothing") as { target: unknown[] };
    expect(conflict.target).toHaveLength(3);
  });

  it("writes no required-action row when the audience resolves to nobody", async () => {
    queueCreate([]);

    const result = await create();

    expect(result.sent).toBe(0);
    expect(dbMock.writesTo(schema.requiredActions)).toHaveLength(0);
    // Nothing to deliver, so nothing is claimed as delivered.
    expect(result.emailDelivered).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("writes the inbox row even when email cannot be delivered", async () => {
    queueCreate([{ userId: "u1", role: "lead" }]);
    dbMock.queue(
      [],
      [{ name: "Mad Hatters" }],
      /* users */ [{ id: "u1", email: null }],
    );

    const result = await create();

    // Activation used to write required_actions plus an email and nothing else,
    // so with no Resend key a targeted member got no signal at all beyond a gate
    // that silently appeared in front of them. The inbox row always works.
    expect(insertNotifications).toHaveBeenCalledTimes(1);
    const [, rows] = insertNotifications.mock.calls[0]!;
    expect(rows).toHaveLength(1);
    // A CAMP sent this, not AfrikaBurn — that distinction is what `origin` is for.
    expect(rows[0]).toMatchObject({
      userId: "u1",
      origin: "camp",
      linkApp: "web",
    });
    expect(result.emailDelivered).toBe(false);
  });

  it("still reports success when the inbox write throws", async () => {
    queueCreate([{ userId: "u1", role: "lead" }]);
    dbMock.queue(
      [],
      [{ name: "Mad Hatters" }],
      [{ id: "u1", email: "a@example.test" }],
    );
    insertNotifications.mockRejectedValue(
      new Error("notifications table gone"),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await create();

    // The activation already committed. Failing here would report a send that
    // did happen as a failure, and the author would send it twice.
    expect(result.activationId).toBe(ACTIVATION);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("sends the email OUTSIDE the transaction, to the targets' addresses", async () => {
    queueCreate([{ userId: "u1", role: "lead" }]);
    dbMock.queue(
      [],
      [{ name: "Mad Hatters" }],
      [
        { id: "u1", email: "a@example.test" },
        { id: "u2", email: null },
      ],
    );

    const result = await create({ blocking: true });

    expect(result.emailDelivered).toBe(true);
    const [payload] = sendEmail.mock.calls[0]!;
    // A null address is dropped rather than sent to.
    expect(payload.to).toEqual(["a@example.test"]);
    expect(payload.subject).toBe("Please complete: Build week plan");
    // Blocking changes what the mail says it will do to them.
    expect(payload.text).toContain("blocks the app");
  });

  it("says it is optional when the questionnaire does not block", async () => {
    queueCreate([{ userId: "u1", role: "lead" }]);
    dbMock.queue(
      [],
      [{ name: "Mad Hatters" }],
      [{ id: "u1", email: "a@example.test" }],
    );

    await create({ blocking: false });

    expect(sendEmail.mock.calls[0]![0].text).toContain("optional");
  });
});

describe("getActivation", () => {
  it("is null for an unknown id", async () => {
    dbMock.queue([]);
    expect(await getActivation("nope")).toBeNull();
  });

  it("prefers the snapshot definition over the live one", async () => {
    const live: Questionnaire = {
      ...DEFINITION,
      pages: [
        { id: "p1", kind: "questions", title: "Later edit", questions: [] },
      ],
    };
    dbMock.queue([activationRow({ liveDefinition: live })]);

    const row = await getActivation(ACTIVATION);

    // Render, validate and aggregate all resolve through here, so pinning the
    // snapshot once fixes all three: a respondent is never shown a question
    // that was edited after they were sent the form.
    expect(row!.definition).toEqual(DEFINITION);
    // The raw snapshot/live pair does not leak into the returned row.
    expect(row).not.toHaveProperty("snapshotDefinition");
    expect(row).not.toHaveProperty("liveDefinition");
  });

  it("falls back to the live definition for a pre-snapshot row", async () => {
    const live: Questionnaire = {
      ...DEFINITION,
      pages: [{ id: "p1", kind: "questions", title: "Live", questions: [] }],
    };
    dbMock.queue([
      activationRow({ snapshotDefinition: null, liveDefinition: live }),
    ]);

    expect((await getActivation(ACTIVATION))!.definition).toEqual(live);
  });
});

describe("listProjectQuestionnaires", () => {
  it("tallies sent and completed per activation, and counts the snapshot's questions", async () => {
    dbMock.queue(
      [
        {
          activationId: ACTIVATION,
          key: `proj:${GROUP}:abc`,
          title: "Build week plan",
          description: null,
          blocking: false,
          dueAt: null,
          status: "open",
          createdAt: new Date(FROZEN_NOW),
          snapshotDefinition: DEFINITION,
          liveDefinition: DEFINITION,
        },
      ],
      [{ status: "completed" }, { status: "pending" }, { status: "pending" }],
    );

    const [item] = await listProjectQuestionnaires(GROUP);

    expect(item).toMatchObject({
      activationId: ACTIVATION,
      sent: 3,
      completed: 1,
      questionCount: 1,
    });
  });

  it("returns an empty list rather than throwing when a project has none", async () => {
    dbMock.queue([]);
    expect(await listProjectQuestionnaires(GROUP)).toEqual([]);
  });
});

describe("getActivationResults", () => {
  it("is null when the activation is gone", async () => {
    dbMock.queue([]);
    expect(await getActivationResults("nope", EDITION_2026)).toBeNull();
  });

  it("pairs each targeted person with their answers, sorted by display name", async () => {
    dbMock.queue(
      [activationRow()],
      [
        {
          userId: "u2",
          status: "pending",
          completedAt: null,
          username: "zeta",
          sanitizedAt: null,
        },
        {
          userId: "u1",
          status: "completed",
          completedAt: new Date(FROZEN_NOW),
          username: "alpha",
          sanitizedAt: null,
        },
      ],
      [
        {
          userId: "u1",
          responses: { arrival: "Tuesday" },
          activationId: ACTIVATION,
        },
      ],
    );

    const results = await getActivationResults(ACTIVATION, EDITION_2026);

    expect(results!.respondents.map((r) => r.displayName)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(results!.respondents[0]!.responses).toEqual({ arrival: "Tuesday" });
    // Targeted but unanswered is null, not an empty object — the results view
    // distinguishes "said nothing" from "said {}".
    expect(results!.respondents[1]!.responses).toBeNull();
  });

  it("redacts a sanitized respondent's name through the real core helper", async () => {
    dbMock.queue(
      [activationRow()],
      [
        {
          userId: "u1",
          status: "completed",
          completedAt: new Date(FROZEN_NOW),
          username: "alpha",
          sanitizedAt: new Date(FROZEN_NOW),
        },
      ],
      [],
    );

    const results = await getActivationResults(ACTIVATION, EDITION_2026);

    // A deleted account's handle must not resurface in a camp's results table.
    expect(results!.respondents[0]!.displayName).not.toBe("alpha");
  });

  it("skips the answer read entirely when nobody was targeted", async () => {
    dbMock.queue([activationRow()], []);

    const results = await getActivationResults(ACTIVATION, EDITION_2026);

    expect(results!.respondents).toEqual([]);
    // `inArray(..., [])` is invalid SQL in Postgres, so the guard is load-bearing.
    expect(dbMock.queries).toHaveLength(2);
  });

  it("binds the ACTIVATION'S edition, not the caller's", async () => {
    dbMock.queue(
      [activationRow({ editionId: EDITION_2026 })],
      [
        {
          userId: "u1",
          status: "completed",
          completedAt: null,
          username: "a",
          sanitizedAt: null,
        },
      ],
      [],
    );

    // The caller passes the CURRENT edition; the activation belongs to a past
    // one. Using the caller's would blank every answer on that page.
    await getActivationResults(ACTIVATION, EDITION_2027);

    const bound = boundStrings(dbMock.queriesOfKind("select")[2]!);
    expect(bound).toContain(EDITION_2026);
    expect(bound).not.toContain(EDITION_2027);
  });

  it("does NOT filter answers by activation id", async () => {
    dbMock.queue(
      [activationRow()],
      [
        {
          userId: "u1",
          status: "completed",
          completedAt: null,
          username: "a",
          sanitizedAt: null,
        },
      ],
      [
        {
          userId: "u1",
          responses: { arrival: "Wed" },
          activationId: "a-later-send",
        },
      ],
    );

    const results = await getActivationResults(ACTIVATION, EDITION_2026);

    // Within one edition a re-send is the same living answer, and the row points
    // at whichever send was answered LAST. Filtering on it made the earlier
    // send's results render blank the moment anyone answered the later one.
    expect(results!.respondents[0]!.responses).toEqual({ arrival: "Wed" });

    // Asserted on the QUERY, not just the result. The harness answers from a
    // queue and never evaluates a predicate, so returning a row proves nothing
    // about what was filtered — adding the activation-id filter back left the
    // assertion above green. The absence has to be checked where it lives.
    expect(boundStrings(dbMock.queriesOfKind("select")[2]!)).not.toContain(
      ACTIVATION,
    );
  });
});

describe("getFillView", () => {
  it("is null for an unknown activation", async () => {
    dbMock.queue([]);
    expect(await getFillView("nope", "u1")).toBeNull();
  });

  it("withholds an org-internal questionnaire from the participant app", async () => {
    // The targeted row is queued DELIBERATELY: without it this returns null for
    // the ordinary not-targeted reason and would pass with the audience guard
    // deleted. Here the person IS targeted, so only the guard can refuse them.
    dbMock.queue(
      [activationRow({ audience: { kind: "org_internal" } })],
      [{ status: "pending" }],
      [{ responses: { arrival: "Tuesday" } }],
    );

    // An org member who is also a burner must not reach the console's own
    // questionnaire through the participant fill page.
    expect(await getFillView(ACTIVATION, "u1")).toBeNull();
  });

  it("is null for a user who was never targeted", async () => {
    dbMock.queue([activationRow()], []);
    expect(await getFillView(ACTIVATION, "stranger")).toBeNull();
  });

  it("prefills from the activation's edition", async () => {
    dbMock.queue(
      [activationRow()],
      [{ status: "pending" }],
      [{ responses: { arrival: "Tuesday" } }],
    );

    const view = await getFillView(ACTIVATION, "u1");

    expect(view).toMatchObject({ actionStatus: "pending" });
    // Deliberately not filtered by activation id: within one edition the person
    // sees what they said last time rather than a blank form.
    expect(view!.initialResponses).toEqual({ arrival: "Tuesday" });
    expect(boundStrings(dbMock.queriesOfKind("select")[2]!)).toContain(
      EDITION_2026,
    );
  });

  it("falls back to the active edition for a pre-feature activation", async () => {
    dbMock.queue(
      [activationRow({ editionId: null })],
      [{ status: "pending" }],
      [],
    );

    const view = await getFillView(ACTIVATION, "u1");

    expect(getActiveEdition).toHaveBeenCalled();
    expect(view!.initialResponses).toEqual({});
  });

  it("returns an empty form rather than failing when no edition exists at all", async () => {
    getActiveEdition.mockResolvedValue(null);
    dbMock.queue([activationRow({ editionId: null })], [{ status: "pending" }]);

    const view = await getFillView(ACTIVATION, "u1");

    expect(view!.initialResponses).toEqual({});
  });
});

describe("listPendingQuestionnaires", () => {
  const action = (over: Record<string, unknown> = {}) => ({
    actionKey: `questionnaire:${ACTIVATION}`,
    title: "Build week plan",
    blocking: false,
    dueAt: null,
    createdAt: new Date(FROZEN_NOW),
    audience: PROJECT_AUDIENCE,
    ...over,
  });

  it("lists a participant-facing pending action", async () => {
    dbMock.queue([action()]);
    expect(await listPendingQuestionnaires("u1")).toEqual([
      {
        activationId: ACTIVATION,
        title: "Build week plan",
        blocking: false,
        dueAt: null,
      },
    ]);
  });

  it("drops org-internal sends from a participant's list", async () => {
    dbMock.queue([action({ audience: { kind: "org_internal" } })]);
    expect(await listPendingQuestionnaires("u1")).toEqual([]);
  });

  it("skips the code-side Burner Bio action, which has no activation", async () => {
    // Its key does not parse to an activation id. Emitting it would put a
    // dashboard link on a page that cannot exist.
    dbMock.queue([action({ actionKey: "burner-bio", audience: null })]);
    expect(await listPendingQuestionnaires("u1")).toEqual([]);
  });
});

describe("submitResponse", () => {
  const submit = (over: Record<string, unknown> = {}) =>
    submitResponse({
      userId: "u1",
      activationId: ACTIVATION,
      rawResponses: { arrival: "Tuesday" },
      ...over,
    });

  it("refuses when the activation no longer exists", async () => {
    dbMock.queue([]);
    expect(await submit()).toEqual({
      ok: false,
      errors: { _form: "This questionnaire no longer exists." },
    });
  });

  it("refuses an org-internal questionnaire defensively", async () => {
    dbMock.queue([activationRow({ audience: { kind: "org_internal" } })]);

    // getFillView already withholds the page; this is the second door, because
    // a server action is reachable without it.
    expect(await submit()).toEqual({
      ok: false,
      errors: { _form: "This questionnaire isn't available here." },
    });
  });

  it("refuses a user who was never sent it, and writes nothing", async () => {
    dbMock.queue([activationRow()], []);

    expect(await submit()).toEqual({
      ok: false,
      errors: { _form: "This questionnaire wasn't sent to you." },
    });
    expect(dbMock.writesTo(schema.questionnaireResponses)).toHaveLength(0);
    expect(completeRequiredAction).not.toHaveBeenCalled();
  });

  it("returns the validator's own errors and does not complete the action", async () => {
    dbMock.queue([activationRow()], [{ id: "ra-1" }]);

    const result = await submit({ rawResponses: {} });

    // `arrival` is required, and this runs the REAL validateSubmission.
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.questionnaireResponses)).toHaveLength(0);
    // A failed submission that still clears the gate is the worst outcome here.
    expect(completeRequiredAction).not.toHaveBeenCalled();
  });

  it("persists the answer and clears the required action", async () => {
    dbMock.queue([activationRow()], [{ id: "ra-1" }]);

    expect(await submit()).toEqual({ ok: true });

    const write = dbMock.writesTo(schema.questionnaireResponses)[0]!;
    const values = write.arg("values") as {
      editionId: string;
      responses: Record<string, unknown>;
      completedAt: Date;
    };
    expect(values.editionId).toBe(EDITION_2026);
    expect(values.responses).toEqual({ arrival: "Tuesday" });
    expect(values.completedAt.getTime()).toBe(FROZEN_NOW);
    expect(completeRequiredAction).toHaveBeenCalledWith(
      "u1",
      EDITION_2026,
      `questionnaire:${ACTIVATION}`,
    );
  });

  it("repeats the partial index's predicate on the upsert", async () => {
    dbMock.queue([activationRow()], [{ id: "ra-1" }]);

    await submit();

    const conflict = dbMock
      .writesTo(schema.questionnaireResponses)[0]!
      .arg("onConflictDoUpdate") as {
      targetWhere?: unknown;
      target: unknown[];
    };

    // Postgres will not use a PARTIAL index to resolve ON CONFLICT unless the
    // statement repeats its predicate. Without this the insert fails outright —
    // which is what happened to every questionnaire write, the Burner Bio
    // included, until an e2e run caught it.
    expect(conflict.targetWhere).toBeDefined();
    expect(conflict.target).toHaveLength(3);
  });

  it("falls back to the active edition for a pre-feature activation", async () => {
    dbMock.queue([activationRow({ editionId: null })], [{ id: "ra-1" }]);

    expect(await submit()).toEqual({ ok: true });
    expect(
      (
        dbMock.writesTo(schema.questionnaireResponses)[0]!.arg("values") as {
          editionId: string;
        }
      ).editionId,
    ).toBe(EDITION_2026);
  });

  it("refuses rather than writing an edition-less answer when none is set up", async () => {
    getActiveEdition.mockResolvedValue(null);
    dbMock.queue([activationRow({ editionId: null })], [{ id: "ra-1" }]);

    expect(await submit()).toEqual({
      ok: false,
      errors: { _form: "No AfrikaBurn edition is set up yet." },
    });
    expect(dbMock.writesTo(schema.questionnaireResponses)).toHaveLength(0);
  });
});
