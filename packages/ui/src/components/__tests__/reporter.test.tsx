import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ReportDialog } from "../report-dialog";
import { ReportDiagnosticsPanel } from "../report-diagnostics";

// What is tested here is the DISCLOSURE, not the layout. The dialog's job is
// to tell somebody what leaves their device before it leaves, and every case
// below is one of those sentences being wrong in a way nobody would notice by
// looking at it.

function mockFetch(
  response: Partial<Response> & { json: () => Promise<unknown> },
) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 201, ...response });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The body the component POSTed, parsed. */
function submittedBody(fetchMock: ReturnType<typeof vi.fn>): {
  type: string;
  description: string;
  dictated: boolean;
  useAi: boolean;
  diagnostics: { environment: unknown[]; errorLogs: unknown[] };
} {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  // jsdom has no MediaRecorder, so `useDictation` reports unsupported — which
  // is the state the tests below want anyway: typing has to work on its own.
  vi.stubGlobal("open", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReportDiagnosticsPanel", () => {
  it("names the fields it would send, and does not send them", async () => {
    const fetchMock = mockFetch({ json: async () => ({}) });
    render(<ReportDiagnosticsPanel defaultOpen />);

    // The real environment, read from this browser — not a fixed blurb.
    await waitFor(() => expect(screen.getByText("User agent")).toBeDefined());
    expect(screen.getByText("Viewport")).toBeDefined();
    expect(screen.getByText("Path")).toBeDefined();
    // Rendering the panel must never be a transmission.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("states that redaction is not a guarantee", () => {
    render(<ReportDiagnosticsPanel defaultOpen />);
    expect(
      screen.getByText(/pattern matching, not a guarantee/i),
    ).toBeDefined();
  });

  it("keeps the body collapsed until asked", () => {
    render(<ReportDiagnosticsPanel />);
    const toggle = screen.getByRole("button", { name: /what this attaches/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("ReportDialog", () => {
  it("shows the bug disclosure expanded, before anything is typed", async () => {
    render(<ReportDialog open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("User agent")).toBeDefined());
    expect(
      screen
        .getByRole("button", { name: /what this attaches/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("replaces the disclosure with a plain statement on a feature request", async () => {
    render(<ReportDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /request a feature/i }));

    expect(
      screen.getByText("Nothing about your device is attached"),
    ).toBeDefined();
    expect(screen.queryByText("User agent")).toBeNull();
    // And the toggle that could contradict it is gone too.
    expect(
      screen.queryByRole("switch", { name: /attach the diagnostics/i }),
    ).toBeNull();
  });

  it("sends no diagnostics with a feature request, whatever the toggle said", async () => {
    const fetchMock = mockFetch({
      json: async () => ({ url: "https://github.com/x/y/issues/7", number: 7 }),
    });
    render(<ReportDialog open onOpenChange={() => {}} />);

    // Leave the bug toggle ON, then switch type. The type has to win.
    fireEvent.change(screen.getByLabelText(/what happened/i), {
      target: { value: "The roster page loops forever." },
    });
    fireEvent.click(screen.getByRole("radio", { name: /request a feature/i }));
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = submittedBody(fetchMock);
    expect(body.type).toBe("feature");
    expect(body.diagnostics.environment).toEqual([]);
    expect(body.diagnostics.errorLogs).toEqual([]);
  });

  it("drops the diagnostics when the toggle is turned off", async () => {
    const fetchMock = mockFetch({
      json: async () => ({ url: "https://github.com/x/y/issues/8", number: 8 }),
    });
    render(<ReportDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/what happened/i), {
      target: { value: "Save fails on the vehicles section." },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: /attach the diagnostics/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submittedBody(fetchMock).diagnostics.environment).toEqual([]);
  });

  it("attaches the environment on a bug by default", async () => {
    const fetchMock = mockFetch({
      json: async () => ({ url: "https://github.com/x/y/issues/9", number: 9 }),
    });
    render(<ReportDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/what happened/i), {
      target: { value: "Save fails on the vehicles section." },
    });
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = submittedBody(fetchMock);
    expect(body.diagnostics.environment.length).toBeGreaterThan(0);
    // Not dictated unless the microphone actually produced words.
    expect(body.dictated).toBe(false);
  });

  it("refuses to file an empty report", () => {
    render(<ReportDialog open onOpenChange={() => {}} />);
    expect(
      screen
        .getByRole("button", { name: /send report/i })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows the issue number and a link once filed", async () => {
    mockFetch({
      json: async () => ({
        url: "https://github.com/x/y/issues/128",
        number: 128,
      }),
    });
    render(<ReportDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/what happened/i), {
      target: { value: "It loops." },
    });
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() =>
      expect(screen.getByText("Filed as issue #128")).toBeDefined(),
    );
    const link = screen.getByRole("link", { name: /view it on github/i });
    expect(link.getAttribute("href")).toBe("https://github.com/x/y/issues/128");
  });

  it("keeps the words when filing fails", async () => {
    mockFetch({
      ok: false,
      status: 429,
      json: async () => ({
        error:
          "That's 5 reports this hour. Please add to an existing one instead.",
        code: "rate-limited",
      }),
    });
    render(<ReportDialog open onOpenChange={() => {}} />);

    const field = screen.getByLabelText(
      /what happened/i,
    ) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Third one this morning." } });
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.getByRole("alert").textContent).toContain("5 reports");
    // The failure must not eat the report.
    expect(field.value).toBe("Third one this morning.");
  });

  it("says typing is the same job when the browser cannot record", () => {
    render(<ReportDialog open onOpenChange={() => {}} />);
    // jsdom has no MediaRecorder: `unsupported` is a state, not an error.
    expect(screen.queryByRole("button", { name: /dictate/i })).toBeNull();
    expect(screen.getByText(/typing does exactly the same job/i)).toBeDefined();
    expect(screen.getByLabelText(/what happened/i)).toBeDefined();
  });
});
