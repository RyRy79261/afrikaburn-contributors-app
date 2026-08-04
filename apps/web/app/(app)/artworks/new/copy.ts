// Shared constants + copy for the Art Project registration page. Plain module
// (not "use server", not "use client") so both the server action and the client
// form import ONE definition of the power-need keys.
//
// Grounded in the AfrikaBurn corpora:
//   docs/sources/afrikaburn-org/event-participation-artworks-performances.md
//   docs/sources/afrikaburn-org/fire-art-safety.md
//   docs/sources/quaggapedia/fire-fire-safety.md
//   docs/sources/quaggapedia/generator-policy.md · sound-quiet.md

/** Power options — solar first, per "You should really rather be using solar.
 * If you must use a generator, it must be insulated to keep noise down." */
export const ARTWORK_POWER_OPTIONS = [
  { value: "solar_battery", label: "Solar / battery (preferred)" },
  { value: "generator", label: "Insulated generator" },
] as const;

export type ArtworkPowerKey = (typeof ARTWORK_POWER_OPTIONS)[number]["value"];

export const ARTWORK_POWER_KEYS = ARTWORK_POWER_OPTIONS.map((o) => o.value) as [
  ArtworkPowerKey,
  ...ArtworkPowerKey[],
];

/** Burn-intent callout (fire-art-safety.md: perimeter "3 times the height of
 * the structure"; fire-fire-safety.md: no open fires on the ground, P.A.S.S.). */
export const BURN_INTENT_NOTE =
  "Burning needs a fire plan approved via the Arteria: adequate extinguishers on hand (know your P.A.S.S.), no fires on the ground, and a safety perimeter of at least three times the sculpture's height, marked and monitored. Pieces intended to burn must be registered by the end of February for assessment by ArtCom and the Pyro Team.";

/** Art-grant callout. The grant process is real but the in-app flow is not
 * confirmed with AfrikaBurn yet — this is an interest flag, nothing more. */
export const ART_GRANT_NOTE =
  "Art grants help fund ambitious projects — materials, lighting and transport, never labour or artists' fees. The application and allocation process is still being confirmed with AfrikaBurn (process TBC); ticking this flags your interest so the Art crew can reach out.";

/** Physical-specs helper (artworks-structural-safety.md bands by height). */
export const PHYSICAL_NOTE =
  "All dimensions in metres. Anything over 3 m tall needs construction drawings and a 3D model, and over 6 m adds architectural drawings — the Art crew will ask for these once you're registered.";

/** Lighting is mandatory for safety — surfaced on the infrastructure section. */
export const INFRASTRUCTURE_NOTE =
  "Lighting your artwork is mandatory for safety — plan how the piece stays lit all event. Registration doesn't entitle you to power, fuel, tools or machines; bring your own.";
