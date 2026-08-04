import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";
import {
  CAMPS_LEAD,
  GOD,
  PERSONAL_READER,
  READER,
  SUPPLIERS_LEAD,
} from "./support/actors";

/**
 * ACTIVATION RESULTS ARE NAMED PEOPLE'S ANSWERS. The respondent list is a list
 * of email addresses and free-text answers routinely carry whatever the
 * respondent chose to write about themselves; there is no useful redaction of
 * that, because a "who answered what" table with the who removed is not the
 * same screen.
 *
 * `canReadActivationResults` is the only thing standing in front of it, and it
 * is a two-line predicate nobody executed.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
}));

import { BURNER_BIO_ACTION_KEY } from "@quagga/core";
import type { Questionnaire } from "@quagga/types";
import {
  audienceLabel,
  canReadActivationResults,
  getActivationResults,
  getConsoleBlockingQuestionnaire,
  getOrgActivation,
  getOrgDefinition,
  listOrgQuestionnaires,
} from "@/lib/questionnaires/queries";

const ACTIVATION_ID = "13131313-1313-4313-8313-131313131313";

/**
 * A Builder v2 definition with THREE blocks, only two of which take an answer.
 * The info block is the reason `countFields` exists.
 */
const DEFINITION: Questionnaire = {
  version: "1",
  pages: [
    {
      id: "p1",
      kind: "questions",
      title: "Camp check-in",
      subtitle: "Tell us how build week went.",
      questions: [
        {
          id: "q1",
          kind: "short_text",
          prompt: "Camp name",
          maxLength: 120,
          required: true,
        },
        {
          id: "q2",
          kind: "long_text",
          prompt: "Anything else?",
          maxLength: 1000,
          required: false,
        },
        {
          id: "info",
          kind: "info_block",
          body: "This helps us plan next year.",
        },
      ],
    },
    { id: "p0", kind: "intro", heading: "Welcome", body: "Two minutes." },
  ],
};

beforeEach(() => {
  db = fakeDb();
});

describe("audienceLabel", () => {
  it("labels every audience kind, and names the empty one", () => {
    expect(audienceLabel(null)).toBe("No audience");
    expect(audienceLabel({ kind: "org_internal" })).toBe(
      "Org members (internal)",
    );
    expect(audienceLabel({ kind: "org_suppliers" })).toBe("Suppliers");
    expect(
      audienceLabel({
        kind: "project",
        groupId: "g",
        mode: "everyone",
        roleIds: [],
      }),
    ).toBe("Project members");
  });

  it("joins the selector lists, falling back to the raw key for an unknown one", () => {
    // A stored selector this build does not know must not crash the list page —
    // the row still has to render so somebody can close or re-send it.
    expect(
      audienceLabel({
        kind: "org_outbound",
        selectors: [
          "all_current_burners",
          "not_a_selector" as "all_current_burners",
        ],
      }),
    ).toMatch(/not_a_selector/);
    expect(
      audienceLabel({
        kind: "org_officer",
        officerKeys: ["safety_officer", "ghost_officer" as "safety_officer"],
      }),
    ).toMatch(/ghost_officer/);
  });
});

describe("canReadActivationResults asks the QUESTIONNAIRES domain", () => {
  it("admits an org-wide personal-information role and the System manager", () => {
    expect(canReadActivationResults(PERSONAL_READER)).toBe(true);
    expect(canReadActivationResults(GOD)).toBe(true);
  });

  it("refuses a plain reader and a department that does not own questionnaires", () => {
    // A suppliers lead has no business in a theme-camp survey's named answers.
    expect(canReadActivationResults(READER)).toBe(false);
    expect(canReadActivationResults(SUPPLIERS_LEAD)).toBe(false);
    expect(canReadActivationResults(CAMPS_LEAD)).toBe(false);
  });
});

describe("getActivationResults", () => {
  it("FAILS CLOSED — throws before issuing any query", async () => {
    // The refusal is the whole control: a redacted variant of these rows does
    // not exist, so a caller who may not read them must not reach the database.
    await expect(
      getActivationResults(ACTIVATION_ID, "org-check-in", SUPPLIERS_LEAD),
    ).rejects.toThrow("Not authorised to read questionnaire responses.");
    expect(db.calls).toEqual([]);
  });

  it("returns each targeted user with their status and answers", async () => {
    db.seed("questionnaire_activations", [{ editionId: "ed-2027" }]);
    db.seed("required_actions", [
      {
        userId: "user-1",
        email: "alice@example.com",
        status: "completed",
        completedAt: new Date("2026-11-01T00:00:00Z"),
      },
      {
        userId: "user-2",
        email: "ren@example.com",
        status: "pending",
        completedAt: null,
      },
    ]);
    db.seed("questionnaire_responses", [
      {
        userId: "user-1",
        responses: { q1: "Mad Hatters" },
        activationId: ACTIVATION_ID,
      },
    ]);

    const rows = await getActivationResults(
      ACTIVATION_ID,
      "org-check-in",
      PERSONAL_READER,
    );

    expect(rows).toEqual([
      {
        userId: "user-1",
        email: "alice@example.com",
        status: "completed",
        completedAt: new Date("2026-11-01T00:00:00Z"),
        responses: { q1: "Mad Hatters" },
      },
      {
        userId: "user-2",
        email: "ren@example.com",
        status: "pending",
        completedAt: null,
        responses: null,
      },
    ]);
  });

  it("does not go looking for answers when nobody was targeted", async () => {
    db.seed("questionnaire_activations", [{ editionId: "ed-2027" }]);
    db.seed("required_actions", []);

    await expect(
      getActivationResults(ACTIVATION_ID, "org-check-in", GOD),
    ).resolves.toEqual([]);
    expect(db.recorded("select", "questionnaire_responses")).toHaveLength(0);
  });

  it("still reads the answers when the activation carries no edition", async () => {
    // A pre-migration-0020 activation has no edition; dropping the whole read
    // would blank every answer on it.
    db.seed("questionnaire_activations", [{ editionId: null }]);
    db.seed("required_actions", [
      { userId: "user-1", email: null, status: "completed", completedAt: null },
    ]);
    db.seed("questionnaire_responses", [
      { userId: "user-1", responses: { q1: "x" }, activationId: null },
    ]);

    const rows = await getActivationResults(ACTIVATION_ID, "org-check-in", GOD);
    expect(rows[0]?.responses).toEqual({ q1: "x" });
  });
});

describe("listOrgQuestionnaires", () => {
  it("counts only ANSWERABLE questions, so an info block does not inflate it", async () => {
    // Builder v2 info and image blocks live in the same list but take no
    // answer, and the author is told "2 questions" on the card.
    db.seed("questionnaire_definitions", [
      {
        key: "org-check-in",
        title: "Camp check-in",
        status: "published",
        version: "1",
        definition: DEFINITION,
        updatedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);
    db.seed("questionnaire_activations", []);

    const [summary] = await listOrgQuestionnaires();

    expect(summary?.fieldCount).toBe(2);
  });

  it("EXCLUDES the burner-bio questionnaire and project-authored definitions", async () => {
    // Org-internal questionnaires never leak into the participant app and the
    // reverse holds too: a camp's own form is not the console's to list.
    db.seed("questionnaire_definitions", [
      {
        key: BURNER_BIO_ACTION_KEY,
        title: "Burner Bio",
        status: "published",
        version: "1",
        definition: DEFINITION,
        updatedAt: new Date(),
      },
      {
        key: "camp-survey",
        title: "A camp's own survey",
        status: "published",
        version: "1",
        definition: DEFINITION,
        updatedAt: new Date(),
      },
      {
        key: "org-check-in",
        title: "Camp check-in",
        status: "published",
        version: "1",
        definition: DEFINITION,
        updatedAt: new Date(),
      },
    ]);
    db.seed("questionnaire_activations", []);

    const keys = (await listOrgQuestionnaires()).map((q) => q.key);

    expect(keys).toEqual(["org-check-in"]);
  });

  it("INCLUDES a non-org key that the console has activated", async () => {
    // The other half of the scope rule: a definition the console sent is the
    // console's to show, whatever its key looks like.
    db.seed("questionnaire_definitions", [
      {
        key: "camp-survey",
        title: "Survey",
        status: "published",
        version: "1",
        definition: DEFINITION,
        updatedAt: new Date(),
      },
    ]);
    db.seed("questionnaire_activations", [
      {
        id: ACTIVATION_ID,
        questionnaireKey: "camp-survey",
        title: "Survey",
        description: null,
        status: "open",
        blocking: true,
        dueAt: null,
        audience: { kind: "org_internal" },
        openedAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    db.seed("required_actions", [
      { activationId: ACTIVATION_ID, status: "completed" },
      { activationId: ACTIVATION_ID, status: "pending" },
      { activationId: ACTIVATION_ID, status: "pending" },
      // A row with no activation is skipped rather than crashing the page.
      { activationId: null, status: "pending" },
    ]);

    const [summary] = await listOrgQuestionnaires();

    expect(summary?.key).toBe("camp-survey");
    expect(summary?.activations[0]).toMatchObject({
      audienceLabel: "Org members (internal)",
      audienceKind: "org_internal",
      completion: { sent: 3, completed: 1, pending: 2 },
    });
  });
});

describe("getOrgDefinition", () => {
  it("refuses the burner-bio key outright", async () => {
    await expect(getOrgDefinition(BURNER_BIO_ACTION_KEY)).resolves.toBeNull();
    expect(db.calls).toEqual([]);
  });

  it("returns null for a key that does not exist", async () => {
    db.seed("questionnaire_definitions", []);
    await expect(getOrgDefinition("org-check-in")).resolves.toBeNull();
  });

  it("does NOT leak a project's questionnaire into the console", async () => {
    db.seed("questionnaire_definitions", [
      {
        key: "camp-survey",
        title: "Survey",
        status: "published",
        version: "1",
        definition: DEFINITION,
        updatedAt: new Date(),
      },
    ]);
    db.seed("questionnaire_activations", []);

    await expect(getOrgDefinition("camp-survey")).resolves.toBeNull();
  });

  it("reads the description off the first questions page's subtitle", async () => {
    // The builder stores it there so the two representations cannot drift.
    db.seed("questionnaire_definitions", [
      {
        key: "org-check-in",
        title: "Camp check-in",
        status: "published",
        version: "3",
        definition: DEFINITION,
        updatedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);

    const def = await getOrgDefinition("org-check-in");

    expect(def).toMatchObject({
      key: "org-check-in",
      version: "3",
      description: "Tell us how build week went.",
    });
  });
});

describe("getOrgActivation", () => {
  it("returns null for an activation a CAMP authored", async () => {
    db.seed("questionnaire_activations", [{ authoredScope: "group" }]);
    await expect(getOrgActivation(ACTIVATION_ID)).resolves.toBeNull();
    // ...and it did not go on to read the definition.
    expect(db.recorded("select", "questionnaire_definitions")).toHaveLength(0);
  });

  it("falls back to the LIVE definition only for a pre-snapshot row", async () => {
    // Results aggregate against the snapshot — what respondents were actually
    // sent — so an edit made afterwards must not change how old answers read.
    const snapshot: Questionnaire = { ...DEFINITION, version: "snapshot" };
    db.seed("questionnaire_activations", [
      {
        id: ACTIVATION_ID,
        questionnaireKey: "org-check-in",
        title: "Camp check-in",
        description: null,
        version: "1",
        status: "open",
        blocking: true,
        dueAt: null,
        authoredScope: "org",
        groupId: null,
        audience: { kind: "org_internal" },
        definition: snapshot,
        createdAt: new Date(),
      },
    ]);
    db.seed("questionnaire_definitions", [{ definition: DEFINITION }]);

    const activation = await getOrgActivation(ACTIVATION_ID);
    expect(activation?.definition.version).toBe("snapshot");

    db = fakeDb();
    db.seed("questionnaire_activations", [
      {
        id: ACTIVATION_ID,
        questionnaireKey: "org-check-in",
        title: "Camp check-in",
        description: null,
        version: "1",
        status: "open",
        blocking: true,
        dueAt: null,
        authoredScope: "org",
        groupId: null,
        audience: null,
        definition: null,
        createdAt: new Date(),
      },
    ]);
    db.seed("questionnaire_definitions", [{ definition: DEFINITION }]);

    const legacy = await getOrgActivation(ACTIVATION_ID);
    expect(legacy?.definition.version).toBe("1");
    expect(legacy?.audienceLabel).toBe("No audience");
  });
});

describe("getConsoleBlockingQuestionnaire", () => {
  const GATE_ROW = {
    activationId: ACTIVATION_ID,
    title: "Staff safety briefing",
    dueAt: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    questionnaireKey: "org-briefing",
    version: "1",
    description: null,
    authoredScope: "org",
    audience: { kind: "org_internal" },
    snapshotDefinition: DEFINITION,
    editionId: "ed-2027",
  };

  it("returns the outstanding gate with this edition's prefill", async () => {
    db.seed("required_actions", [GATE_ROW]);
    db.seed("questionnaire_definitions", [{ definition: DEFINITION }]);
    db.seed("questionnaire_responses", [{ responses: { q1: "Mad Hatters" } }]);

    const gate = await getConsoleBlockingQuestionnaire("user-1");

    expect(gate).toMatchObject({
      activationId: ACTIVATION_ID,
      definitionKey: "org-briefing",
      title: "Staff safety briefing",
      existingResponses: { q1: "Mad Hatters" },
    });
  });

  it("is null when nothing is outstanding", async () => {
    db.seed("required_actions", []);
    await expect(getConsoleBlockingQuestionnaire("user-1")).resolves.toBeNull();
  });

  it("does NOT gate the console on an OUTBOUND questionnaire", async () => {
    // Outbound sends and Burner-Bio actions target burners; gating staff on one
    // would lock the console over a form that is not theirs to answer.
    db.seed("required_actions", [
      {
        ...GATE_ROW,
        audience: { kind: "org_outbound", selectors: ["all_burners"] },
      },
    ]);
    await expect(getConsoleBlockingQuestionnaire("user-1")).resolves.toBeNull();
  });

  it("is null when the definition behind the gate has vanished", async () => {
    // Better an ungated console than a gate that cannot be rendered or cleared.
    db.seed("required_actions", [GATE_ROW]);
    db.seed("questionnaire_definitions", []);
    await expect(getConsoleBlockingQuestionnaire("user-1")).resolves.toBeNull();
  });

  it("starts with an empty prefill when this edition has no answer yet", async () => {
    db.seed("required_actions", [GATE_ROW]);
    db.seed("questionnaire_definitions", [{ definition: DEFINITION }]);
    db.seed("questionnaire_responses", []);

    const gate = await getConsoleBlockingQuestionnaire("user-1");
    expect(gate?.existingResponses).toEqual({});
  });
});
