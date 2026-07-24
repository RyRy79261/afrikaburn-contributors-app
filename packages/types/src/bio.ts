import { z } from "zod";

// Burner Bio v3 additions (build-spec §"Burner Bio v3 additions"). Corpus-
// grounded, self-promotional data: none of it is hard-locked. Zod schemas live
// here (the validation authority); @quagga/core layers the field registry,
// privacy defaults, and public projection on top.

// --- Volunteering portfolios --------------------------------------------
// The 15 real Quaggapedia volunteer portfolios. `key` is the stable internal
// identifier (used by the `volunteers_interested:<portfolio>` org audience);
// `label` is the corpus-accurate display name.
export const VOLUNTEER_PORTFOLIOS = [
  { key: "arteria", label: "ARTeria" },
  { key: "box_office", label: "Box Office" },
  { key: "chillaz", label: "Chillaz" },
  { key: "dmv", label: "DMV" },
  { key: "die_hek", label: "Die Hek (Gate)" },
  { key: "die_yskas", label: "Die Yskas (Ice)" },
  { key: "greeters", label: "Greeters" },
  { key: "kitchen", label: "Kitchen" },
  { key: "lost_and_found", label: "Lost & Found" },
  { key: "moop", label: "MOOP/Leave No Trace" },
  { key: "recycling", label: "Recycling" },
  { key: "rangers", label: "Rangers" },
  { key: "sanctuary", label: "Sanctuary" },
  { key: "throne_crew", label: "Throne Crew" },
  { key: "volunteer_info_booth", label: "Volunteer & Info Booth" },
] as const;

export type VolunteerPortfolioKey = (typeof VOLUNTEER_PORTFOLIOS)[number]["key"];

const PORTFOLIO_KEY_SET: ReadonlySet<string> = new Set(
  VOLUNTEER_PORTFOLIOS.map((p) => p.key),
);

/** True when `key` is one of the 15 known volunteer portfolio keys. */
export function isVolunteerPortfolioKey(key: string): boolean {
  return PORTFOLIO_KEY_SET.has(key);
}

/** The display label for a portfolio key (falls back to the key itself). */
export function volunteerPortfolioLabel(key: string): string {
  return VOLUNTEER_PORTFOLIOS.find((p) => p.key === key)?.label ?? key;
}

// --- Camp history -------------------------------------------------------
// A repeatable list of camps the burner has been part of. Each entry is either
// `linked` (a reference to a platform group — `groupId` set) or `freetext`
// (unlisted free camps, or camps at other burns worldwide — no groupId). The
// store layer additionally validates that a linked `groupId` references an
// existing group at write time; a stale link degrades to freetext.
export const CampHistoryEntry = z
  .object({
    kind: z.enum(["linked", "freetext"]),
    /** Present ONLY on `linked` entries — the referenced group's id. */
    groupId: z.string().uuid().optional(),
    /** Display label — the camp name (snapshot for linked entries). */
    label: z.string().trim().min(1).max(120),
    /** Event/burn this camp belongs to; defaults to AfrikaBurn in the UI. */
    event: z.string().trim().max(120).optional(),
    /** Free-form years text (e.g. "2018, 2019") — heavy free-text expected. */
    years: z.string().trim().max(60).optional(),
  })
  .refine((e) => (e.kind === "linked" ? Boolean(e.groupId) : !e.groupId), {
    message:
      "Linked entries must reference a group; free-text entries must not.",
  });
export type CampHistoryEntry = z.infer<typeof CampHistoryEntry>;

// --- Bio extras payload -------------------------------------------------
// The v3 fields as they cross the client→server boundary (all optional so a
// partial save leaves untouched fields alone). Validated at the server action.
export const BioExtrasInput = z.object({
  about: z.string().max(5000).nullable().optional(),
  campHistory: z.array(CampHistoryEntry).max(50).optional(),
  volunteeringInterests: z.array(z.string().max(120)).max(30).optional(),
  volunteeringOther: z.string().max(200).nullable().optional(),
  rangerTraining: z.boolean().optional(),
  rangerCurious: z.boolean().optional(),
  greenDotTraining: z.boolean().optional(),
});
export type BioExtrasInput = z.infer<typeof BioExtrasInput>;
