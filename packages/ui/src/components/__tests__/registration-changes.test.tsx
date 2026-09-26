import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { changedFields } from "@quagga/core";
import { RegistrationChanges } from "../registration-changes";

// The shared year-on-year diff (epic #50). Fixtures go through the REAL
// `changedFields`, so the component is tested against the shape core actually
// produces rather than a hand-built FieldChange that could drift from it.

afterEach(cleanup);

const prior = {
  s2LntPlan: "Sweep the grid daily.",
  s4ExpectedPopulation: 42,
  s6PlugAndPlayAck: true,
};
const current = {
  s2LntPlan: "Sweep the grid twice daily.",
  s4ExpectedPopulation: 42,
  s6PlugAndPlayAck: false,
};

describe("RegistrationChanges", () => {
  it("lists what moved, with both years' answers", () => {
    render(
      <RegistrationChanges
        priorYear={2026}
        currentYear={2027}
        changes={changedFields(prior, current)}
        basis="carried_forward"
        audience="camp"
      />,
    );
    expect(screen.getByText("Leave No Trace plan")).toBeDefined();
    expect(screen.getByText("Sweep the grid twice daily.")).toBeDefined();
    // Unchanged population is not listed.
    expect(screen.queryByText("Expected population")).toBeNull();
    expect(
      screen.getByText(/the 2026 answers you brought across/),
    ).toBeDefined();
  });

  it("marks never-carried fields only when something WAS carried", () => {
    const changes = changedFields(prior, current);
    const { unmount } = render(
      <RegistrationChanges
        priorYear={2026}
        currentYear={2027}
        changes={changes}
        basis="carried_forward"
        audience="reviewer"
      />,
    );
    expect(screen.getByText("Plug & Play acknowledgement")).toBeDefined();
    expect(screen.getByText(/never carried over/)).toBeDefined();
    unmount();

    // A camp that typed 2027 fresh carried nothing; "never carried over" would
    // imply the rest was.
    render(
      <RegistrationChanges
        priorYear={2026}
        currentYear={2027}
        changes={changes}
        basis="previous_edition"
        audience="reviewer"
      />,
    );
    expect(screen.getByText("Plug & Play acknowledgement")).toBeDefined();
    expect(screen.queryByText(/never carried over/)).toBeNull();
    expect(
      screen.getByText(/this camp's 2026 registration and this camp's 2027/),
    ).toBeDefined();
  });

  it("says so when nothing moved", () => {
    render(
      <RegistrationChanges
        priorYear={2026}
        currentYear={2027}
        changes={changedFields(prior, prior)}
        basis="previous_edition"
        audience="camp"
      />,
    );
    expect(screen.getByText("Changes since 2026")).toBeDefined();
    expect(
      screen.getByText("Nothing differs from your 2026 registration."),
    ).toBeDefined();
  });
});
