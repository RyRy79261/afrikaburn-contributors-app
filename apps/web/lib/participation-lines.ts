import type { WapListStatus } from "@quagga/types";
import type { MemberParticipation, OnboardingStatus } from "@quagga/core";

// The participation summary's two worded lines (components/stats/
// participation-summary.tsx), kept here so they are unit-tested: each one has
// a case where the obvious wording would state something false.

function yearsList(years: readonly number[]): string {
  if (years.length <= 1) return years.join("");
  return `${years.slice(0, -1).join(", ")} and ${years[years.length - 1]}`;
}

export function passLine(passes: MemberParticipation["passes"]): string {
  const earlier = passes.earlierYears;
  const thisEdition = passes.thisEdition as WapListStatus | null;
  if (thisEdition) {
    const on =
      thisEdition === "draft"
        ? "On the camp's draft list this edition."
        : "On the camp's list this edition.";
    return earlier.length > 0
      ? `${on} Also held one in ${yearsList(earlier)}.`
      : on;
  }
  // A viewer who is never shown a draft cannot be told "not on the list": the
  // member may be on the lead's working copy. Say only what is known, the way
  // the camp page's own pass line stays silent on a draft.
  if (!passes.draftsVisible) {
    return earlier.length > 0
      ? `Held one in ${yearsList(earlier)}.`
      : "None held with the camp";
  }
  if (earlier.length > 0)
    return `Not on the camp's list this edition. Held one in ${yearsList(earlier)}.`;
  return "None held with the camp";
}

export function onboardingLine(
  onboarding: MemberParticipation["onboarding"],
  self: boolean,
): { badge: OnboardingStatus | "waived" } | { text: string } {
  if (onboarding === null) return { text: "None sent this edition" };
  if (onboarding === "not_targeted")
    return { text: self ? "Not sent to you" : "Not sent to this member" };
  return { badge: onboarding };
}
