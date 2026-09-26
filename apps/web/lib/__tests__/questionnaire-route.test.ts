import { describe, it, expect } from "vitest";
import { decideQuestionnaireRoute } from "../questionnaire-route";

// A group's questionnaires render only on the route of its own kind. Seeded
// from the real `group_kind` values (org | theme_camp | artwork | mutant_vehicle).

describe("decideQuestionnaireRoute", () => {
  it.each([
    ["theme_camp", "/camps/mad-hatters/questionnaires"],
    ["artwork", "/artworks/mad-hatters/questionnaires"],
    ["mutant_vehicle", "/vehicles/mad-hatters/questionnaires"],
  ] as const)("renders a %s on its own route", (kind, base) => {
    expect(decideQuestionnaireRoute(kind, kind, "mad-hatters", "")).toEqual({
      action: "render",
      base,
    });
  });

  it("redirects a project reached through /camps to its own route, keeping the rest of the path", () => {
    expect(
      decideQuestionnaireRoute("artwork", "theme_camp", "baobab", "/new"),
    ).toEqual({
      action: "redirect",
      to: "/artworks/baobab/questionnaires/new",
    });
    expect(
      decideQuestionnaireRoute("mutant_vehicle", "theme_camp", "teapot", "/a1"),
    ).toEqual({ action: "redirect", to: "/vehicles/teapot/questionnaires/a1" });
  });

  it.each([
    ["theme_camp", "artwork"],
    ["mutant_vehicle", "artwork"],
    ["theme_camp", "mutant_vehicle"],
    ["artwork", "mutant_vehicle"],
  ] as const)(
    "refuses a %s on the %s route rather than rendering it",
    (groupKind, routeKind) => {
      expect(decideQuestionnaireRoute(groupKind, routeKind, "x", "")).toEqual({
        action: "not_found",
      });
    },
  );

  it.each(["theme_camp", "artwork", "mutant_vehicle"] as const)(
    "never renders the org group on the %s route",
    (routeKind) => {
      expect(
        decideQuestionnaireRoute("org", routeKind, "afrikaburn", ""),
      ).toEqual({ action: "not_found" });
    },
  );
});
