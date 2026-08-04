import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ReportLauncher } from "../report-launcher";
import { ReportSettingsCard } from "../report-settings-card";

// The two surfaces that get somebody INTO the reporter. Both exist to say what
// a report sends before one is filed — the launcher states it in the menu, and
// the settings card exists precisely so the disclosure is readable without
// starting a report.
//
// reporter.test.tsx already asserts this class of claim for the dialog itself
// ("what leaves your device before it leaves"). This is the same house pattern
// extended to the two entry points that had none.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReportLauncher", () => {
  it("names itself, because on a phone the label is gone", () => {
    render(<ReportLauncher />);
    // Below the sm breakpoint the word "Report" is sr-only and the control is
    // a bare circle, so the accessible name is the only thing left.
    expect(
      screen.getByRole("button", { name: "Report a bug or request a feature" }),
    ).toBeDefined();
  });

  it("discloses where a report goes BEFORE any dialog exists", async () => {
    render(<ReportLauncher />);
    fireEvent.click(
      screen.getByRole("button", { name: "Report a bug or request a feature" }),
    );

    await waitFor(() => expect(screen.getByText("Report a bug")).toBeDefined());
    expect(screen.getByText("Request a feature")).toBeDefined();
    // Where this goes is the first thing worth knowing about pressing the
    // button — not something to discover after typing a paragraph.
    expect(
      screen.getByText(
        "Opens a public issue. Your name and email are never attached.",
      ),
    ).toBeDefined();
    // Nothing has been STARTED yet — the disclosure precedes the form, it does
    // not accompany it. (The popover surface itself carries role=dialog, so the
    // absence of the reporter is checked by its textarea, not by that role.)
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it.each([
    ["Report a bug", "Report a bug"],
    ["Request a feature", "Request a feature"],
  ])("opens the dialog on the %s choice", async (choice, heading) => {
    render(<ReportLauncher />);
    fireEvent.click(
      screen.getByRole("button", { name: "Report a bug or request a feature" }),
    );
    await waitFor(() => expect(screen.getByText(choice)).toBeDefined());
    fireEvent.click(screen.getByText(choice));

    const dialog = await screen.findByRole("dialog");
    // The chosen type has to survive the menu → dialog handover; landing on
    // the wrong one files a feature request as a bug.
    expect(dialog.textContent).toContain(heading);
  });

  it("threads dictationEnabled through instead of dropping it", async () => {
    render(<ReportLauncher dictationEnabled={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Report a bug or request a feature" }),
    );
    await waitFor(() => expect(screen.getByText("Report a bug")).toBeDefined());
    fireEvent.click(screen.getByText("Report a bug"));

    await screen.findByRole("dialog");
    // With no GROQ_API_KEY the microphone must be hidden, not offered and then
    // refused.
    expect(
      screen.queryByRole("button", { name: /Dictate|microphone/i }),
    ).toBeNull();
  });
});

describe("ReportSettingsCard", () => {
  it("invites reporting from the corner button when filing works", () => {
    render(<ReportSettingsCard />);
    expect(
      screen.getByText(
        /Report from any screen with the button in the bottom-left corner/,
      ),
    ).toBeDefined();
    expect(screen.getByText("Report a bug")).toBeDefined();
    expect(screen.getByText("Request a feature")).toBeDefined();
  });

  it.each([
    ["Report a bug", "Report a bug"],
    ["Request a feature", "Request a feature"],
  ])("starts a %s from the card", async (choice, heading) => {
    render(<ReportSettingsCard />);
    fireEvent.click(screen.getByText(choice));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(heading);
  });

  it("says there is nowhere for a report to go, and keeps the disclosure anyway", () => {
    render(<ReportSettingsCard filingEnabled={false} />);

    // This page is where somebody comes to ask why there is no corner button.
    expect(
      screen.getByText("Reporting isn’t switched on for this deployment."),
    ).toBeDefined();
    // The two choice buttons are display:none'd rather than unmounted, which
    // takes them out of the tab order and the accessibility tree in a real
    // browser. jsdom loads no Tailwind, so the class is what is observable.
    const choices = screen
      .getByText("Report a bug")
      .closest("div") as HTMLElement;
    expect(choices.className).toContain("hidden");
    // The disclosure survives the feature being off — what a report WOULD
    // attach is still the question being answered.
    expect(screen.getByText("What a bug report attaches")).toBeDefined();
  });

  it("states the audit line and that nobody is watching on your behalf", () => {
    render(<ReportSettingsCard />);
    const note = screen.getByText(/Reports are filed as public issues/);

    // Two uncomfortable truths, said plainly rather than omitted: the audit
    // line makes the reporter re-identifiable to a maintainer, and filing is
    // not the same as being helped.
    expect(note.textContent).toContain(
      "audit line pairing the issue number with your account",
    );
    expect(note.textContent).toContain(
      "nobody is watching the issue on your behalf",
    );
    expect(note.textContent?.replace(/\s+/g, " ")).toContain(
      "Your name, email and account ID are never in them.",
    );
  });
});
