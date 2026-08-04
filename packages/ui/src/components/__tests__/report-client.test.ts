import { describe, it, expect, vi, afterEach } from "vitest";

import {
  ReportError,
  buildDiagnostics,
  submitReport,
  transcribeRecording,
} from "../../lib/report-client";

// The browser half of the reporter. What is tested here is what the server is
// TOLD and how the answer is read — not what the dialog looks like.
//
// The malformed-201 guard exists for a specific published failure: an unchecked
// body renders "Filed as issue #undefined" beside a dead link, which reads to
// the reporter as if the report went nowhere. Resolving with a half-built
// response is worse than throwing, because a throw at least says so.

function stubFetch(
  response: Partial<Response> & { json?: () => Promise<unknown> },
) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({}),
    ...response,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The JSON body of the first POST, parsed. */
function postedBody(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as {
    type: string;
    description: string;
    dictated: boolean;
    useAi: boolean;
    diagnostics: { environment: unknown[]; errorLogs: unknown[] };
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("submitReport", () => {
  it("returns the created issue when the server answers properly", async () => {
    stubFetch({
      json: async () => ({ url: "https://github.com/x/y/issues/7", number: 7 }),
    });
    await expect(
      submitReport({ type: "bug", description: "The map is blank." }),
    ).resolves.toEqual({ url: "https://github.com/x/y/issues/7", number: 7 });
  });

  it.each([
    ["no number", { url: "https://example.com/1" }],
    ["no url", { number: 7 }],
    ["a number sent as a string", { url: "https://example.com/1", number: "7" }],
    ["a url sent as a number", { url: 1, number: 7 }],
    ["a null body", null],
  ])("refuses a malformed 201 (%s) rather than half-building a response", async (
    _label,
    body,
  ) => {
    stubFetch({ json: async () => body });
    // The alternative is "#undefined" and a dead link, which the reporter reads
    // as "nothing happened" and then files again.
    await expect(
      submitReport({ type: "bug", description: "x" }),
    ).rejects.toMatchObject({ name: "ReportError", code: "bad-response" });
  });

  it("prefers the server's own error string and code", async () => {
    stubFetch({
      ok: false,
      status: 429,
      json: async () => ({ error: "You've filed a few already today.", code: "rate-limited" }),
    });
    const failure = await submitReport({ type: "bug", description: "x" }).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(ReportError);
    const err = failure as ReportError;
    expect(err.message).toBe("You've filed a few already today.");
    expect(err.code).toBe("rate-limited");
    expect(err.status).toBe(429);
  });

  it("falls back to the status when the body is not JSON at all", async () => {
    stubFetch({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    const err = (await submitReport({ type: "bug", description: "x" }).catch(
      (e: unknown) => e,
    )) as ReportError;

    // A proxy's HTML error page is the common shape of this.
    expect(err.message).toBe("That didn't go through (502).");
    expect(err.code).toBeNull();
  });

  it("falls back when the body is JSON but says nothing usable", async () => {
    stubFetch({ ok: false, status: 500, json: async () => ({ error: 42, code: 9 }) });
    const err = (await submitReport({ type: "bug", description: "x" }).catch(
      (e: unknown) => e,
    )) as ReportError;
    expect(err.message).toBe("That didn't go through (500).");
    expect(err.code).toBeNull();
  });

  it("sends empty diagnostics arrays rather than omitting the key", async () => {
    const fetchMock = stubFetch({
      json: async () => ({ url: "https://example.com/1", number: 1 }),
    });
    await submitReport({
      type: "feature",
      description: "A dark mode",
      includeDiagnostics: false,
    });

    // Declining diagnostics has to be legible to the server as a DECISION, not
    // as a missing field it might fill in itself.
    expect(postedBody(fetchMock).diagnostics).toEqual({
      environment: [],
      errorLogs: [],
    });
  });

  it("attaches real diagnostics by default", async () => {
    const fetchMock = stubFetch({
      json: async () => ({ url: "https://example.com/1", number: 1 }),
    });
    await submitReport({ type: "bug", description: "x" });

    const body = postedBody(fetchMock);
    expect(body.diagnostics.environment.length).toBeGreaterThan(0);
    expect(body.diagnostics.environment).toEqual(
      buildDiagnostics().environment,
    );
  });

  it("defaults dictated to false and useAi to true", async () => {
    const fetchMock = stubFetch({
      json: async () => ({ url: "https://example.com/1", number: 1 }),
    });
    await submitReport({ type: "bug", description: "x" });

    const body = postedBody(fetchMock);
    expect(body.dictated).toBe(false);
    // Restructuring with Claude is the default because a raw report is usually
    // one sentence with no steps; opting out has to be explicit.
    expect(body.useAi).toBe(true);
  });

  it("carries explicit dictated and useAi through unchanged", async () => {
    const fetchMock = stubFetch({
      json: async () => ({ url: "https://example.com/1", number: 1 }),
    });
    await submitReport({
      type: "bug",
      description: "x",
      dictated: true,
      useAi: false,
    });

    const body = postedBody(fetchMock);
    expect(body.dictated).toBe(true);
    expect(body.useAi).toBe(false);
  });
});

describe("transcribeRecording", () => {
  it.each([
    ["audio/mp4", "dictation.mp4"],
    ["audio/mp4;codecs=mp4a.40.2", "dictation.mp4"],
    ["audio/webm;codecs=opus", "dictation.webm"],
    ["", "dictation.webm"],
  ])("names an %s part %s so Whisper can identify the container", async (
    type,
    expected,
  ) => {
    const fetchMock = stubFetch({ json: async () => ({ text: "hello" }) });
    await transcribeRecording(new Blob([new Uint8Array(8)], { type }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    const part = form.get("audio") as File;
    // Safari records mp4, everything else webm. Getting this wrong silently
    // degrades every dictation on one platform.
    expect(part.name).toBe(expected);
  });

  it("returns the transcript the server sent", async () => {
    stubFetch({ json: async () => ({ text: "the map is blank" }) });
    await expect(
      transcribeRecording(new Blob(["x"], { type: "audio/webm" })),
    ).resolves.toBe("the map is blank");
  });

  it.each([
    ["missing", {}],
    ["not a string", { text: 42 }],
  ])("resolves to an empty string when text is %s", async (_label, body) => {
    stubFetch({ json: async () => body });
    // "undefined" pasted into the description box would be worse than nothing.
    await expect(
      transcribeRecording(new Blob(["x"], { type: "audio/webm" })),
    ).resolves.toBe("");
  });

  it("throws the same ReportError shape as submitReport on a refusal", async () => {
    stubFetch({
      ok: false,
      status: 503,
      json: async () => ({ error: "Dictation isn't switched on.", code: "no-key" }),
    });
    const err = (await transcribeRecording(
      new Blob(["x"], { type: "audio/webm" }),
    ).catch((e: unknown) => e)) as ReportError;

    // useDictation reads `cause.message` straight onto the screen, so this
    // shape is load-bearing for the person holding the microphone.
    expect(err).toBeInstanceOf(ReportError);
    expect(err.message).toBe("Dictation isn't switched on.");
    expect(err.code).toBe("no-key");
    expect(err.status).toBe(503);
  });
});
