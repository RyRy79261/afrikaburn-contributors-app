import { describe, expect, it } from "vitest";
import type { AudienceSpec } from "@quagga/types";
import { isParticipantFacingActivation } from "../questionnaire-engine";

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
