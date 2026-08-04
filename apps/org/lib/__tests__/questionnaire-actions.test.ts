import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * BLOCKING QUESTIONNAIRES GATE HARD — fill page plus sign-out, nothing else.
 *
 * So the two ways this file can fail are both lockouts, and neither is visible
 * to static analysis: an activation written WITHOUT its `required_actions`
 * targets nobody while claiming to gate everybody, and a blocking questionnaire
 * a staffer cannot SUBMIT locks them out of the tool they were told to use.
 * `submitConsoleQuestionnaire` therefore requires only a gated session and no
 * capability at all — answering your own gate is not an authoring act.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
  createPooledDb: () => ({ db, pool: { end: async () => {} } }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireOrgSession = vi.fn();
vi.mock("@/lib/session", () => ({
  requireOrgSession: (options?: unknown) => requireOrgSession(options),
}));

import type { Questionnaire } from "@quagga/types";
import {
  activateQuestionnaire,
  closeActivation,
  previewAudienceCount,
  saveQuestionnaireDefinition,
  submitConsoleQuestionnaire,
} from "@/lib/questionnaires/actions";

const ACTIVATION_ID = "14141414-1414-4414-8414-141414141414";
const EDITION_ID = "15151515-1515-4515-8515-151515151515";

const DEFINITION: Questionnaire = {
  version: "1",
  pages: [
    {
      id: "p1",
      kind: "questions",
      title: "Staff briefing",
      questions: [
        {
          id: "q1",
          kind: "short_text",
          prompt: "Your role",
          maxLength: 120,
          required: true,
        },
      ],
    },
  ],
};

/** A god session: the authoring predicates admit org authors, never engineers. */
function orgSession(role: "god" | "org_staff" | "engineer" = "god") {
  return { dbUserId: "user-1", orgGroupId: "org-1", role };
}

/** The seven row sets `buildAudienceContext` reads, all empty but one member. */
function seedAudienceContext() {
  db.seed("memberships", [
    {
      membershipId: "mem-1",
      userId: "staff-1",
      groupId: "org-1",
      role: "org_staff",
    },
  ]);
  db.seed("groups", [{ id: "org-1", kind: "org" }]);
  db.seed("registrations", []);
  db.seed("burner_bios", []);
  db.seed("member_role_assignments", []);
  db.seed("project_roles", []);
  db.seed("suppliers", []);
}

beforeEach(() => {
  db = fakeDb();
  requireOrgSession.mockReset();
  requireOrgSession.mockResolvedValue(orgSession());
});

describe("saveQuestionnaireDefinition", () => {
  it("asks for `create` when authoring and `update` when editing", async () => {
    // Both used to ask for `update`, so a role given "may amend our
    // questionnaires, may not write new ones" could author one from scratch.
    db.seed("questionnaire_definitions", [[], []]);
    await saveQuestionnaireDefinition({
      title: "Staff briefing",
      definition: DEFINITION,
    });
    expect(requireOrgSession).toHaveBeenLastCalledWith({
      capability: "create",
      domain: "questionnaires",
    });

    db = fakeDb();
    db.seed("questionnaire_definitions", [[{ version: "2" }]]);
    await saveQuestionnaireDefinition({
      key: "org-staff-briefing",
      title: "Staff briefing",
      definition: DEFINITION,
    });
    expect(requireOrgSession).toHaveBeenLastCalledWith({
      capability: "update",
      domain: "questionnaires",
    });
  });

  it("refuses an ENGINEER with a refusal that names the reason", async () => {
    // The rank holds `write` for console operations, but sending a form whose
    // replies you are not allowed to open is not a permission worth having.
    requireOrgSession.mockResolvedValue(orgSession("engineer"));

    const result = await saveQuestionnaireDefinition({
      title: "Staff briefing",
      definition: DEFINITION,
    });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(
      /answers are personal information/,
    );
    expect(db.recorded("insert", "questionnaire_definitions")).toHaveLength(0);
  });

  it("refuses editing a questionnaire the console does not own", async () => {
    const result = await saveQuestionnaireDefinition({
      key: "camp-survey",
      title: "Survey",
      definition: DEFINITION,
    });
    expect(result).toEqual({
      ok: false,
      error: "That questionnaire is not editable in the console.",
    });
  });

  it("refuses editing one that no longer exists", async () => {
    db.seed("questionnaire_definitions", [[]]);
    await expect(
      saveQuestionnaireDefinition({
        key: "org-staff-briefing",
        title: "Survey",
        definition: DEFINITION,
      }),
    ).resolves.toEqual({
      ok: false,
      error: "That questionnaire no longer exists.",
    });
  });

  it("allocates an org-namespaced key and syncs the first page's title", async () => {
    // The builder's title and the definition's first page are two
    // representations of one thing; `normalizeDefinition` is what stops them
    // drifting.
    db.seed("questionnaire_definitions", [[], []]);

    const result = await saveQuestionnaireDefinition({
      title: "Staff Briefing 2027!",
      description: "Two minutes.",
      definition: DEFINITION,
    });

    expect(result).toEqual({ ok: true, key: "org-staff-briefing-2027" });
    const values = db.inserted("questionnaire_definitions") as {
      key: string;
      version: string;
      definition: Questionnaire;
    };
    expect(values.version).toBe("1");
    expect(values.definition.pages[0]).toMatchObject({
      title: "Staff Briefing 2027!",
      subtitle: "Two minutes.",
    });
  });

  it("BUMPS the version on an edit, so a snapshot can be told apart", async () => {
    db.seed("questionnaire_definitions", [[{ version: "3" }]]);

    const result = await saveQuestionnaireDefinition({
      key: "org-staff-briefing",
      title: "Staff briefing",
      definition: DEFINITION,
    });

    expect(result).toEqual({ ok: true, key: "org-staff-briefing" });
    expect(
      db.recorded("update", "questionnaire_definitions")[0]?.values,
    ).toMatchObject({ version: "4" });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "questionnaire.definition.update",
      subject: "org-staff-briefing",
      meta: { version: "4" },
    });
  });
});

describe("previewAudienceCount", () => {
  it("refuses a caller the send check rejects", async () => {
    requireOrgSession.mockResolvedValue(orgSession("engineer"));
    const result = await previewAudienceCount({
      audience: { kind: "org_internal" },
      editionId: EDITION_ID,
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/don't send/);
  });

  it("refuses a PROJECT audience — those are authored from the camp dashboard", async () => {
    const result = await previewAudienceCount({
      audience: { kind: "project", groupId: "g", mode: "everyone", roleIds: [] },
      editionId: EDITION_ID,
    });
    expect(result).toEqual({
      ok: false,
      error: "Project audiences are authored from the camp dashboard.",
    });
    expect(db.calls).toEqual([]);
  });

  it("counts the users the audience resolves to right now", async () => {
    seedAudienceContext();
    await expect(
      previewAudienceCount({
        audience: { kind: "org_internal" },
        editionId: EDITION_ID,
      }),
    ).resolves.toEqual({ ok: true, count: 1 });
  });
});

describe("activateQuestionnaire", () => {
  const INPUT = {
    questionnaireKey: "org-staff-briefing",
    version: "1",
    title: "Staff briefing",
    editionId: EDITION_ID,
    audience: { kind: "org_internal" as const },
    blocking: true,
    dueAt: null,
  };

  function seedPublishedDefinition(status = "published") {
    db.seed("questionnaire_definitions", [
      {
        key: "org-staff-briefing",
        version: "1",
        status,
        definition: DEFINITION,
      },
    ]);
  }

  it("refuses a caller without send rights", async () => {
    requireOrgSession.mockResolvedValue(orgSession("engineer"));
    const result = await activateQuestionnaire(INPUT);
    expect(result).toMatchObject({ ok: false });
    expect(db.recorded("insert", "questionnaire_activations")).toHaveLength(0);
  });

  it("refuses a definition that cannot be sent from the console", async () => {
    db.seed("questionnaire_definitions", [
      { key: "camp-survey", version: "1", status: "published", definition: DEFINITION },
    ]);
    await expect(
      activateQuestionnaire({ ...INPUT, questionnaireKey: "camp-survey" }),
    ).resolves.toEqual({
      ok: false,
      error: "That questionnaire cannot be sent from the console.",
    });
  });

  it("REFUSES A DRAFT, and names which state stopped it", async () => {
    // The builder's two buttons mean something: "Save draft" is explicitly
    // "I am not finished". Sending one snapshots a half-written definition and,
    // when it is blocking, hard-gates everyone it resolves to behind questions
    // the author had not finished writing.
    seedPublishedDefinition("draft");
    const draft = await activateQuestionnaire(INPUT);
    expect((draft as { error: string }).error).toMatch(/still a draft/);

    seedPublishedDefinition("unpublished");
    const unpublished = await activateQuestionnaire(INPUT);
    expect((unpublished as { error: string }).error).toMatch(
      /has been unpublished/,
    );
  });

  it("refuses an unparseable due date rather than storing an Invalid Date", async () => {
    seedPublishedDefinition();
    const result = await activateQuestionnaire({
      ...INPUT,
      dueAt: "next Tuesday-ish",
    });
    expect(result).toEqual({
      ok: false,
      error: "The due date is not a valid date.",
    });
    expect(db.recorded("insert", "questionnaire_activations")).toHaveLength(0);
  });

  it("WRITES THE ACTIVATION AND ITS REQUIRED ACTIONS TOGETHER", async () => {
    // An activation without its required actions targets nobody while claiming
    // to gate everybody — the exact partial state the transaction exists for.
    seedPublishedDefinition();
    seedAudienceContext();
    db.seed("questionnaire_activations", [{ id: ACTIVATION_ID }]);

    const result = await activateQuestionnaire(INPUT);

    expect(result).toEqual({ ok: true });
    expect(db.inserted("questionnaire_activations")).toMatchObject({
      questionnaireKey: "org-staff-briefing",
      status: "open",
      blocking: true,
      editionId: EDITION_ID,
      // Snapshotted AS SENT, so later edits cannot change what a respondent
      // was asked.
      definition: DEFINITION,
    });
    const actions = db.inserted("required_actions") as {
      userId: string;
      activationId: string;
      editionId: string;
    }[];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      userId: "staff-1",
      activationId: ACTIVATION_ID,
      editionId: EDITION_ID,
    });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "questionnaire.activate",
      subject: ACTIVATION_ID,
      meta: { recipients: 1, blocking: true },
    });
  });

  it("points an ORG-INTERNAL send at the console, not the participant app", async () => {
    // `/questionnaires/<id>` is a participant route and apps/web refuses to
    // serve it for an org-internal activation, so every internal send used to
    // dead-end in a 404 — with a blocking one also emailing "open the
    // Contributors app to complete it", where there was nothing to complete.
    seedPublishedDefinition();
    seedAudienceContext();
    db.seed("questionnaire_activations", [{ id: ACTIVATION_ID }]);

    await activateQuestionnaire(INPUT);

    const [notification] = db.inserted("notifications") as {
      link: string;
      linkApp: string;
    }[];
    expect(notification).toMatchObject({ link: "/", linkApp: "org" });
  });

  it("writes nothing to required_actions when the audience resolves to nobody", async () => {
    seedPublishedDefinition();
    db.seed("memberships", []);
    db.seed("groups", []);
    db.seed("registrations", []);
    db.seed("burner_bios", []);
    db.seed("member_role_assignments", []);
    db.seed("project_roles", []);
    db.seed("suppliers", []);
    db.seed("questionnaire_activations", [{ id: ACTIVATION_ID }]);

    const result = await activateQuestionnaire(INPUT);

    expect(result).toEqual({ ok: true });
    expect(db.recorded("insert", "required_actions")).toHaveLength(0);
    expect(db.recorded("insert", "notifications")).toHaveLength(0);
    expect(db.inserted("audit_events")).toMatchObject({
      meta: { recipients: 0 },
    });
  });

  it("commits the send even when the notification hook fails", async () => {
    seedPublishedDefinition();
    seedAudienceContext();
    db.seed("questionnaire_activations", [{ id: ACTIVATION_ID }]);
    db.fail("notifications");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(activateQuestionnaire(INPUT)).resolves.toEqual({ ok: true });
    expect(db.recorded("insert", "required_actions")).toHaveLength(1);
    error.mockRestore();
  });
});

describe("closeActivation", () => {
  it("refuses an activation the console does not manage", async () => {
    db.seed("questionnaire_activations", [{ authoredScope: "group" }]);
    await expect(
      closeActivation({ activationId: ACTIVATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: "That activation is not managed by the console.",
    });
    expect(db.recorded("update", "questionnaire_activations")).toHaveLength(0);
  });

  it("refuses one that is already gone", async () => {
    db.seed("questionnaire_activations", []);
    const result = await closeActivation({ activationId: ACTIVATION_ID });
    expect(result).toMatchObject({ ok: false });
  });

  it("closes an org activation and audits it", async () => {
    db.seed("questionnaire_activations", [{ authoredScope: "org" }]);

    await expect(
      closeActivation({ activationId: ACTIVATION_ID }),
    ).resolves.toEqual({ ok: true });
    expect(
      db.recorded("update", "questionnaire_activations")[0]?.values,
    ).toMatchObject({ status: "closed" });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "questionnaire.close",
      subject: ACTIVATION_ID,
    });
  });
});

describe("submitConsoleQuestionnaire", () => {
  function seedGate(audience: unknown = { kind: "org_internal" }) {
    db.seed("questionnaire_activations", [
      {
        id: ACTIVATION_ID,
        key: "org-staff-briefing",
        version: "1",
        audience,
        definition: DEFINITION,
        editionId: EDITION_ID,
      },
    ]);
    db.seed("questionnaire_definitions", [{ definition: DEFINITION }]);
  }

  it("REQUIRES NO CAPABILITY — every rank must be able to clear its own gate", async () => {
    // A blocking questionnaire replaces the whole console shell. If answering
    // it needed a capability, the gate would be a lockout for anyone who did
    // not hold that capability.
    seedGate();

    const result = await submitConsoleQuestionnaire(ACTIVATION_ID, {
      q1: "Safety",
    });

    expect(result).toEqual({ ok: true });
    expect(requireOrgSession).toHaveBeenCalledWith(undefined);
  });

  it("rejects a malformed activation id without touching the database", async () => {
    const result = await submitConsoleQuestionnaire("not-a-uuid", {});
    expect(result).toEqual({
      ok: false,
      errors: { _form: "Unknown questionnaire." },
    });
    expect(db.calls).toEqual([]);
  });

  it("refuses an activation that has ended", async () => {
    db.seed("questionnaire_activations", []);
    await expect(
      submitConsoleQuestionnaire(ACTIVATION_ID, {}),
    ).resolves.toEqual({
      ok: false,
      errors: { _form: "This questionnaire has ended." },
    });
  });

  it("refuses a questionnaire that is not answered HERE", async () => {
    // An outbound send is answered in the participant app; accepting it here
    // would write an answer under the wrong surface's rules.
    seedGate({ kind: "org_outbound", selectors: ["all_burners"] });
    await expect(
      submitConsoleQuestionnaire(ACTIVATION_ID, { q1: "x" }),
    ).resolves.toEqual({
      ok: false,
      errors: { _form: "This questionnaire can't be answered here." },
    });
  });

  it("returns the per-question errors rather than saving a partial answer", async () => {
    seedGate();
    const result = await submitConsoleQuestionnaire(ACTIVATION_ID, {});
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(Object.keys(result.errors)).toContain("q1");
    expect(db.recorded("insert", "questionnaire_responses")).toHaveLength(0);
  });

  it("saves the response AND flips the gate — both, or neither", async () => {
    // A saved response that failed to flip the gate would lock the staff member
    // out of the console; a flipped gate with no stored response would lose
    // their answers.
    seedGate();

    await submitConsoleQuestionnaire(ACTIVATION_ID, { q1: "Safety" });

    expect(db.inserted("questionnaire_responses")).toMatchObject({
      userId: "user-1",
      definitionKey: "org-staff-briefing",
      editionId: EDITION_ID,
      responses: { q1: "Safety" },
      activationId: ACTIVATION_ID,
    });
    expect(db.recorded("update", "required_actions")[0]?.values).toMatchObject({
      status: "completed",
    });
  });

  it("refuses when there is no edition to scope the answer to", async () => {
    // A pre-feature activation has no edition and falls back to the active one;
    // on a database with neither, saving would produce an unscoped answer.
    seedGate();
    db.seed("questionnaire_activations", [
      {
        id: ACTIVATION_ID,
        key: "org-staff-briefing",
        version: "1",
        audience: { kind: "org_internal" },
        definition: DEFINITION,
        editionId: null,
      },
    ]);
    db.seed("editions", []);

    await expect(
      submitConsoleQuestionnaire(ACTIVATION_ID, { q1: "Safety" }),
    ).resolves.toEqual({
      ok: false,
      errors: { _form: "No AfrikaBurn edition is set up yet." },
    });
  });

  it("reports a failure rather than throwing at the gate screen", async () => {
    // The gate is the only screen these users can see; an unhandled throw there
    // is an unrecoverable console.
    requireOrgSession.mockRejectedValue(new Error("session gone"));
    await expect(
      submitConsoleQuestionnaire(ACTIVATION_ID, {}),
    ).resolves.toEqual({
      ok: false,
      errors: { _form: "We couldn't save your answers. Try again." },
    });
  });
});
