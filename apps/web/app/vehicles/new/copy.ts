// Shared constants + copy for the Mutant Vehicle registration page. Plain
// module (not "use server", not "use client") so both the server action and the
// client form import ONE definition of the acknowledgement keys.
//
// Every line here is grounded in the Quaggapedia DMV corpus:
//   docs/sources/quaggapedia/dmv-department-of-mutant-vehicles.md
//   docs/sources/quaggapedia/dmv-commandments.md
//   docs/sources/quaggapedia/mutant-vehicles.md

/** The three DMV acknowledgements, in canvas order (frame S8ZcWf §6). */
export const VEHICLE_ACKS = [
  {
    key: "speed_limit",
    text: "I understand the 10 km/h speed limit applies everywhere on site, and pedestrians and bicyclists have right of way.",
  },
  {
    key: "testing_station",
    text: "I'll bring my mutant to the DMV Testing Station at 6ish & Binnekring for on-site licensing — no license, no cruising.",
  },
  {
    key: "driver_indemnity",
    text: "Every driver will sign the DMV driver indemnity form on site and carry it from the moment they step through the gate.",
  },
] as const;

export type VehicleAckKey = (typeof VEHICLE_ACKS)[number]["key"];

export const VEHICLE_ACK_KEYS = VEHICLE_ACKS.map((a) => a.key) as [
  VehicleAckKey,
  ...VehicleAckKey[],
];

/** SOOP explainer under the sound scale (corpus: "consult the SOOP map which
 * will be explained to you when you do your final licensing at DMV"). */
export const SOOP_FOOTNOTE =
  "Amplified levels can only be played in designated zones with speakers pointed away from the Binnekring — the DMV will explain the SOOP map at final licensing.";

export const FLAME_EFFECTS_NOTE =
  "Flame effects require prior DMV contact and a live on-site test. Make them fire vertically — horizontal flame effects are dangerous and not allowed.";

export const NIGHT_DRIVING_NOTE =
  "Your brakes and lights must work and the mutant must be lit up at night. Night driving needs a separate DMV night-driving license — get it after dark, and complete daytime licensing before Thursday.";

export const EBIKE_NOTE =
  "Any electric vehicle over 400W must be mutated and registered. Rule of thumb: if you can't lift it with one hand, it needs to be registered. No quads or motorbikes unless fully mutated and licensed.";
