"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  validateQuestionnaireDefinition,
  type DefinitionIssue,
} from "@quagga/core";

import { getDb, schema } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { saveQuestionnaireDefinition } from "@/lib/questionnaires/actions";

// Builder v2 save boundary. The ONE rule this file exists to enforce:
// a definition that fails `validateQuestionnaireDefinition` is never written.
// The builder runs the same validator client-side to place issues inline, but
// the UI is not the boundary — this re-runs it server-side and returns the
// typed issues (dotted paths intact) so the client can address them.
//
// The actual write delegates to the existing `saveQuestionnaireDefinition`
// (org authz, key allocation, version bump, audit event) — we only add the
// validation gate in front and the draft/published status behind it, so the
// activation write path is untouched.

const SaveInput = z.object({
  key: z.string().min(1).optional(),
  title: z.string().min(1, "Give the questionnaire a title."),
  description: z.string().optional(),
  /** Unknown on purpose: the validator is the shape authority here. */
  definition: z.unknown(),
  /** true = "Publish" (sendable), false = "Save draft". */
  publish: z.boolean(),
});

export type SaveDefinitionV2Result =
  | { ok: true; key: string; issues: readonly [] }
  | { ok: false; error: string; issues: DefinitionIssue[] };

/**
 * Validate + save an org questionnaire definition (Builder v2).
 *
 * Returns the structural issues instead of saving when the definition does not
 * hold together — duplicate ids, backward branches, unreachable sections,
 * inconsistent min/max rules. Each issue carries the dotted path the builder
 * uses to render it against the offending section / question / option.
 */
export async function saveDefinitionV2(
  raw: z.input<typeof SaveInput>,
): Promise<SaveDefinitionV2Result> {
  let input: z.infer<typeof SaveInput>;
  try {
    await requireOrgSession();
    input = SaveInput.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof z.ZodError
          ? (err.issues[0]?.message ?? "Check the questionnaire.")
          : "You are not allowed to author org questionnaires.",
      issues: [],
    };
  }

  // THE GATE. Never save a definition that fails structural validation.
  const validation = validateQuestionnaireDefinition(input.definition);
  if (!validation.ok) {
    return {
      ok: false,
      error:
        validation.issues.length === 1
          ? "One problem is blocking this save."
          : `${validation.issues.length} problems are blocking this save.`,
      issues: validation.issues,
    };
  }

  const saved = await saveQuestionnaireDefinition({
    key: input.key,
    title: input.title,
    description: input.description,
    // The PARSED definition (Zod defaults applied) — never the raw input.
    definition: validation.definition,
  });
  if (!saved.ok) return { ok: false, error: saved.error, issues: [] };

  // Draft vs published. `saveQuestionnaireDefinition` publishes on create and
  // leaves status alone on edit; the builder's two buttons set it explicitly.
  try {
    const db = getDb();
    await db
      .update(schema.questionnaireDefinitions)
      .set({
        status: input.publish ? "published" : "draft",
        updatedAt: new Date(),
      })
      .where(eq(schema.questionnaireDefinitions.key, saved.key));
  } catch {
    // The definition is saved either way; the status flag is not worth failing
    // the whole save over.
  }

  revalidatePath("/questionnaires");
  revalidatePath(`/questionnaires/${saved.key}/edit`);
  return { ok: true, key: saved.key, issues: [] };
}
