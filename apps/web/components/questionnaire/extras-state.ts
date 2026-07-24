import type { BioExtras } from "@quagga/core";
import type { BioExtrasState } from "./burns-step";

/**
 * Convert the server-side `BioExtras` (nullable fields) into the client
 * `BioExtrasState` (strings, never null) the burns step renders. A missing bio
 * yields an empty, ready-to-edit state.
 */
export function toBioExtrasState(
  extras: BioExtras | null | undefined,
): BioExtrasState {
  return {
    about: extras?.about ?? "",
    campHistory: extras?.campHistory ?? [],
    volunteeringInterests: extras?.volunteeringInterests ?? [],
    volunteeringOther: extras?.volunteeringOther ?? "",
    rangerTraining: extras?.rangerTraining ?? false,
    rangerCurious: extras?.rangerCurious ?? false,
    greenDotTraining: extras?.greenDotTraining ?? false,
  };
}
