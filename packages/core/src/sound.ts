// The AfrikaBurn sound scale (the "SOOP" amplified-sound levels camps declare in
// Section 5 of registration). Anchored to AfrikaBurn's real guidance
// (docs/sources/quaggapedia/sound-quiet.md): the site is small (1.6 km at its
// longest), sound camps are grouped into the Loud Zone on the northwest
// binnekring, and a daily Quiet Period silences amplification 7–11am Mon–Thu.
//
// Level 1 is a normal car stereo — audible only inside your own camp. Each step
// up carries further and pulls placement toward the Loud Zone. This list is the
// single source of truth for the wizard's select and the org console's labels.

export interface SoundLevelOption {
  /** Stored verbatim in `registrations.s5AmplifiedMusic` (human-readable). */
  readonly value: string;
  /** Short label for the select trigger + read views. */
  readonly label: string;
  /** One-line guidance shown under the option. */
  readonly blurb: string;
}

export const SOUND_SCALE: readonly SoundLevelOption[] = [
  {
    value: "No amplified sound",
    label: "No amplified sound",
    blurb: "Acoustic only — no speakers, no rig. Welcome anywhere in the city.",
  },
  {
    value: "Level 1 — Car stereo",
    label: "Level 1 — Car stereo",
    blurb:
      "Normal car-stereo volume. Audible only within your own camp; fine in general camping.",
  },
  {
    value: "Level 2 — Party speakers",
    label: "Level 2 — Party speakers",
    blurb:
      "A social gathering with proper speakers. Carries to immediate neighbours — mind the quiet hours.",
  },
  {
    value: "Level 3 — Small rig / dancefloor",
    label: "Level 3 — Small rig / dancefloor",
    blurb:
      "A dancefloor sound system. Register as a sound camp so you're placed in a sound zone.",
  },
  {
    value: "Level 4 — Large rig",
    label: "Level 4 — Large rig",
    blurb:
      "Major output. Placed in the Loud Zone on the northwest binnekring; bass bins raised, speakers aimed away from camping.",
  },
] as const;

/** The stored values, in order — handy for validation. */
export const SOUND_SCALE_VALUES: readonly string[] = SOUND_SCALE.map(
  (o) => o.value,
);

/**
 * Whether a stored amplified-music value represents "no amplification". Used to
 * decide when a sound plan is required (a rig needs a plan; acoustic doesn't).
 */
export function isNoAmplifiedSound(value: string | null | undefined): boolean {
  if (!value) return true;
  const text = value.toLowerCase();
  if (/\d/.test(text)) return false;
  return (
    /\b(no|none|acoustic|silent|zero)\b/.test(text) ||
    text.includes("no amplif")
  );
}
