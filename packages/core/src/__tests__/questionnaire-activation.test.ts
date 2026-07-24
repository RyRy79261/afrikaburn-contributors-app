import { describe, it, expect } from "vitest";
import {
  activationRequiredActionKey,
  parseActivationActionKey,
  buildActivationRequiredActions,
  completeRequiredAction,
  isActivationResponseComplete,
  tallyActivationCompletion,
  type ActivationLike,
} from "../questionnaire-activation";

const activation: ActivationLike = {
  id: "act-1",
  title: "MOOP plan check-in",
  blocking: true,
  dueAt: new Date("2027-04-01T00:00:00.000Z"),
};

describe("action key convention", () => {
  it("formats and round-trips questionnaire:<id>", () => {
    expect(activationRequiredActionKey("act-1")).toBe("questionnaire:act-1");
    expect(parseActivationActionKey("questionnaire:act-1")).toBe("act-1");
  });

  it("returns null for non-questionnaire keys", () => {
    expect(parseActivationActionKey("burner_bio")).toBeNull();
    expect(parseActivationActionKey("questionnaire:")).toBeNull();
  });
});

describe("buildActivationRequiredActions", () => {
  it("builds one pending row per user carrying activation options", () => {
    const rows = buildActivationRequiredActions(activation, ["u1", "u2"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      userId: "u1",
      type: "questionnaire",
      actionKey: "questionnaire:act-1",
      activationId: "act-1",
      title: "MOOP plan check-in",
      blocking: true,
      status: "pending",
      dueAt: activation.dueAt,
    });
  });

  it("dedupes repeated user ids", () => {
    const rows = buildActivationRequiredActions(activation, ["u1", "u1", "u2"]);
    expect(rows.map((r) => r.userId)).toEqual(["u1", "u2"]);
  });

  it("produces no rows for an empty audience", () => {
    expect(buildActivationRequiredActions(activation, [])).toEqual([]);
  });

  it("carries a non-blocking / no-due activation through", () => {
    const rows = buildActivationRequiredActions(
      { id: "a2", title: "Survey", blocking: false, dueAt: null },
      ["u1"],
    );
    expect(rows[0]?.blocking).toBe(false);
    expect(rows[0]?.dueAt).toBeNull();
  });
});

describe("completion", () => {
  it("completeRequiredAction stamps status + time", () => {
    const now = new Date("2027-03-01T12:00:00.000Z");
    expect(completeRequiredAction(now)).toEqual({
      status: "completed",
      completedAt: now,
    });
  });

  it("isActivationResponseComplete requires matching activation + completedAt", () => {
    const done = { activationId: "act-1", completedAt: new Date() };
    expect(isActivationResponseComplete("act-1", done)).toBe(true);
    // wrong activation
    expect(isActivationResponseComplete("other", done)).toBe(false);
    // not yet completed
    expect(
      isActivationResponseComplete("act-1", {
        activationId: "act-1",
        completedAt: null,
      }),
    ).toBe(false);
    // no response
    expect(isActivationResponseComplete("act-1", null)).toBe(false);
  });
});

describe("tallyActivationCompletion", () => {
  it("counts completed vs outstanding", () => {
    expect(
      tallyActivationCompletion([
        { status: "completed" },
        { status: "completed" },
        { status: "pending" },
        { status: "expired" },
      ]),
    ).toEqual({ sent: 4, completed: 2, pending: 2 });
  });

  it("handles an empty activation", () => {
    expect(tallyActivationCompletion([])).toEqual({
      sent: 0,
      completed: 0,
      pending: 0,
    });
  });
});
