import { projectQuestionnairesPath } from "@quagga/core";

// Which route a group's questionnaires live on (CREATIVE-007).
//
// The questionnaire spine is kind-agnostic — an activation belongs to a
// `group_id`, whatever the group is — so the SAME pages serve theme camps
// (/camps/<slug>/questionnaires), artworks (/artworks/<slug>/questionnaires)
// and mutant vehicles (/vehicles/<slug>/questionnaires). What the route adds is
// one rule: a group is reached on the route of ITS kind.
//
//   · a camp route asked for a project slug REDIRECTS to the project's route —
//     /camps/<slug> is every group's dashboard, and links and bookmarks from
//     before the project routes existed must keep working;
//   · a project route asked for a slug of any other kind is NOT FOUND — an
//     artwork URL must never render a camp's (or a vehicle's) questionnaires.
//
// Pure, so the decision has a test; the pages turn it into redirect/notFound.

export type QuestionnaireRouteKind =
  "theme_camp" | "artwork" | "mutant_vehicle";

export type QuestionnaireRouteDecision =
  | { action: "render"; base: string }
  | { action: "redirect"; to: string }
  | { action: "not_found" };

export function decideQuestionnaireRoute(
  groupKind: string,
  routeKind: QuestionnaireRouteKind,
  slug: string,
  /** The part of the path after `/questionnaires`, e.g. "/new". */
  suffix: string,
): QuestionnaireRouteDecision {
  if (groupKind === routeKind) {
    return {
      action: "render",
      base: projectQuestionnairesPath(groupKind, slug),
    };
  }
  if (
    routeKind === "theme_camp" &&
    (groupKind === "artwork" || groupKind === "mutant_vehicle")
  ) {
    return {
      action: "redirect",
      to: `${projectQuestionnairesPath(groupKind, slug)}${suffix}`,
    };
  }
  return { action: "not_found" };
}
