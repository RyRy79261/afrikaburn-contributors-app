import { describe, expect, it } from "vitest";
import type { AudienceSpec } from "@quagga/types";
import {
  firstBlockingAction,
  isParticipantFacingActivation,
  type RequiredActionLike,
} from "../questionnaire-engine";

// `firstBlockingAction` is the routing spine — apps/web/lib/session.ts maps its
// return value to the page a blocked user is sent to. It had no unit test here
// (only indirect e2e coverage through the onboarding gate), which is thin for a
// function whose two failure modes are both silent: return null when something
// SHOULD block and the gate opens to someone who has not completed their bio;
// return a non-blocking or already-completed row and the user is trapped on a
// page they cannot clear.
describe("firstBlockingAction", () => {
  const action = (
    actionKey: string,
    blocking: boolean,
    status: RequiredActionLike["status"],
  ): RequiredActionLike => ({ actionKey, blocking, status });

  it("returns null when nothing blocks", () => {
    expect(firstBlockingAction([])).toBeNull();
    expect(
      firstBlockingAction([action("burner_bio", true, "completed")]),
    ).toBeNull();
  });

  it("ignores pending rows that are not blocking", () => {
    expect(firstBlockingAction([action("survey", false, "pending")])).toBeNull();
  });

  it("ignores blocking rows that are waived or expired", () => {
    expect(
      firstBlockingAction([
        action("a", true, "waived"),
        action("b", true, "expired"),
      ]),
    ).toBeNull();
  });

  it("takes the FIRST pending blocker — input order is priority", () => {
    const first = action("burner_bio", true, "pending");
    const second = action("camp_form", true, "pending");
    expect(firstBlockingAction([first, second])).toBe(first);
  });

  it("skips past non-blockers to reach a later blocker", () => {
    const blocker = action("burner_bio", true, "pending");
    expect(
      firstBlockingAction([
        action("done", true, "completed"),
        action("optional", false, "pending"),
        blocker,
      ]),
    ).toBe(blocker);
  });
});

// Regression guard for the org-internal leak (review finding: org-internal
// blocking questionnaires must NOT gate/serve in the participant app). The pure
// predicate is the single decision point the participant gate spine
// (listRequiredActions), the fill loader (getFillView), the submit action, and
// the pending list all filter on. See spec §"Authoring levels".
describe("isParticipantFacingActivation", () => {
  it("EXCLUDES org-internal activations from the participant app", () => {
    const orgInternal: AudienceSpec = { kind: "org_internal" };
    expect(isParticipantFacingActivation(orgInternal)).toBe(false);
  });

  it("includes org-outbound activations (they gate the participant app)", () => {
    const orgOutbound: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["all_current_burners"],
    };
    expect(isParticipantFacingActivation(orgOutbound)).toBe(true);
  });

  it("includes project activations", () => {
    const project: AudienceSpec = {
      kind: "project",
      groupId: "group-1",
      mode: "everyone",
      roleIds: [],
    };
    expect(isParticipantFacingActivation(project)).toBe(true);
  });

  it("treats a null/undefined audience (the Burner Bio spine) as participant-facing", () => {
    expect(isParticipantFacingActivation(null)).toBe(true);
    expect(isParticipantFacingActivation(undefined)).toBe(true);
  });
});
