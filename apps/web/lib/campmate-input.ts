import { z } from "zod";
import { CONTACTABILITY_LEVELS, FIELD_VISIBILITY_LEVELS } from "@quagga/core";

// Zod boundaries for epic #68's inputs, shared by every server action that
// takes them. Parsing only establishes SHAPE: what may actually be stored is
// still decided in @quagga/core (`enforcePrivacyFlags` forces every
// always-private field private whatever arrives here).

/** One stored privacy value: the legacy boolean, or a named level. */
export const PrivacyFlagValueInput = z.union([
  z.boolean(),
  z.enum(FIELD_VISIBILITY_LEVELS),
]);

/** A whole per-field flags map. Keys are bounded so a hostile map cannot
 * balloon the jsonb column. */
export const PrivacyFlagsInput = z
  .record(z.string().max(64), PrivacyFlagValueInput)
  .refine((m) => Object.keys(m).length <= 64, "Too many privacy settings.");

export const CampmateSettingsInput = z.object({
  contactable: z.enum(CONTACTABILITY_LEVELS),
  listedInCampPeople: z.boolean(),
});

/** The profile card's partial update (every field optional). */
export const CampmateSettingsPatchInput = z
  .object({
    contactable: z.enum(CONTACTABILITY_LEVELS).optional(),
    listedInCampPeople: z.boolean().optional(),
    avatarVisibility: z.enum(FIELD_VISIBILITY_LEVELS).optional(),
  })
  .strict();
