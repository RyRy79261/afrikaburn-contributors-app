import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AudienceSelect } from "../audience-select";

// AudienceSelect resolves nothing — the parent runs @quagga/core's
// resolveAudience and feeds the count down, so there is one resolver and one
// display. What this component owns is the SENTENCE, and one distinction in it
// matters more than the rest: a resolved count of ZERO is not the same as "we
// have not resolved yet". Hiding the line when an audience resolves to nobody
// is exactly the moment an author most needs to know before pressing send.

const OPTIONS = [
  { value: "all", label: "Everyone" },
  { value: "leads", label: "Camp leads" },
  { value: "rangers", label: "Rangers" },
] as const;

describe("the count line", () => {
  it.each([
    [0, "Resolves to no burners yet"],
    [1, "Resolves to ~1 burner"],
    [7, "Resolves to ~7 burners"],
  ])("renders %i as %s", (resolvedCount, expected) => {
    render(<AudienceSelect options={OPTIONS} resolvedCount={resolvedCount} />);
    // The singular strips the trailing "s" off the noun — "~1 burners" reads
    // like a bug in a message whose whole job is to be trusted.
    expect(screen.getByText(expected)).toBeDefined();
  });

  it.each([
    [0, "Resolves to no camps yet"],
    [1, "Resolves to ~1 camp"],
    [4, "Resolves to ~4 camps"],
  ])("uses a custom noun for %i", (resolvedCount, expected) => {
    render(
      <AudienceSelect
        options={OPTIONS}
        resolvedCount={resolvedCount}
        countNoun="camps"
      />,
    );
    expect(screen.getByText(expected)).toBeDefined();
  });

  it("hides the line before a resolution, but SHOWS it for zero", () => {
    const { rerender } = render(<AudienceSelect options={OPTIONS} />);
    expect(screen.queryByText(/Resolves to/)).toBeNull();

    rerender(<AudienceSelect options={OPTIONS} resolvedCount={null} />);
    expect(screen.queryByText(/Resolves to/)).toBeNull();

    // Conflating null with 0 is the easy mistake, and it silences the warning
    // precisely when it is needed.
    rerender(<AudienceSelect options={OPTIONS} resolvedCount={0} />);
    expect(screen.getByText("Resolves to no burners yet")).toBeDefined();
  });
});

describe("the picker", () => {
  it("shows the placeholder before a choice and the label after", () => {
    const { rerender } = render(
      <AudienceSelect options={OPTIONS} placeholder="Pick who gets this" />,
    );
    expect(screen.getByText("Pick who gets this")).toBeDefined();

    rerender(<AudienceSelect options={OPTIONS} value="leads" />);
    expect(screen.getByText("Camp leads")).toBeDefined();
  });

  it("lists every option and reports the chosen value", async () => {
    const onValueChange = vi.fn();
    render(
      <AudienceSelect options={OPTIONS} onValueChange={onValueChange} />,
    );
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("Rangers")).toBeDefined());
    for (const option of OPTIONS) {
      expect(screen.getByText(option.label)).toBeDefined();
    }

    fireEvent.click(screen.getByText("Rangers"));
    // The parent stores the VALUE and re-resolves from it; handing back the
    // label would break the resolver.
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("rangers"));
  });

  it("threads disabled down to the trigger", () => {
    render(<AudienceSelect options={OPTIONS} disabled id="audience" />);
    const trigger = screen.getByRole("combobox") as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    // The id is what a <Field label htmlFor> binds to.
    expect(trigger.id).toBe("audience");
  });
});
