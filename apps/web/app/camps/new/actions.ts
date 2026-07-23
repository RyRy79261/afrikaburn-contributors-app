"use server";

import { z } from "zod";
import { CAMP_DESCRIPTION_WORD_LIMIT, countWords } from "@quagga/core";
import { GroupKind, Joinability } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { checkCampName, createCamp } from "@/lib/groups-store";

const CreateCampInput = z.object({
  name: z.string().trim().min(2, "Give your camp a name.").max(120),
  kind: GroupKind.exclude(["org"]),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .refine(
      (d) => !d || countWords(d) <= CAMP_DESCRIPTION_WORD_LIMIT,
      `Description must be ${CAMP_DESCRIPTION_WORD_LIMIT} words or fewer.`,
    ),
  joinability: Joinability,
  confirmWarnings: z.boolean().default(false),
});

export type CreateCampActionResult =
  | { status: "created"; slug: string }
  | { status: "error"; message: string }
  | { status: "warn"; warnings: string[] };

/** Create a free camp (build-spec §`/camps/new`). Rejects an exact normalized
 * name collision; warns (and requires confirmation) on a near-duplicate. */
export async function createCampAction(
  raw: unknown,
): Promise<CreateCampActionResult> {
  const parsed = CreateCampInput.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid camp details.",
    };
  }
  const input = parsed.data;
  const user = await requireCampUser();

  const check = await checkCampName(input.name, input.kind);
  if (!check.ok) {
    return {
      status: "error",
      message: "A camp of this kind already uses that name. Pick another.",
    };
  }
  if (check.warnings.length > 0 && !input.confirmWarnings) {
    return { status: "warn", warnings: check.warnings };
  }

  const result = await createCamp({
    creatorId: user.id,
    name: input.name,
    kind: input.kind,
    description: input.description ?? null,
    joinability: input.joinability,
  });
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "created", slug: result.slug };
}
