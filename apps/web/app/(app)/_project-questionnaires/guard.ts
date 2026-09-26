import "server-only";

import { notFound, redirect } from "next/navigation";
import {
  decideQuestionnaireRoute,
  type QuestionnaireRouteKind,
} from "@/lib/questionnaire-route";

export type { QuestionnaireRouteKind };

/**
 * Apply `decideQuestionnaireRoute` for a page: returns the base path to link
 * under, or ends the render with a redirect / 404.
 */
export function resolveQuestionnaireRoute(
  groupKind: string,
  routeKind: QuestionnaireRouteKind,
  slug: string,
  suffix: string,
): string {
  const decision = decideQuestionnaireRoute(groupKind, routeKind, slug, suffix);
  if (decision.action === "redirect") redirect(decision.to);
  if (decision.action === "not_found") notFound();
  return decision.base;
}
