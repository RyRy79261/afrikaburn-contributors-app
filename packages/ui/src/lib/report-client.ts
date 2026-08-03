"use client";

// The browser half of the reporter: gather diagnostics, submit, interpret the
// answer. Everything a reporter UI needs that is not a pixel.
//
// The point of this seam is that the component stays presentational. It decides
// how the dialog looks and when it opens; this decides what gets sent, and the
// server decides what gets published.

import {
  type ReportDiagnostics,
  type ReportResponse,
  type ReportType,
} from "@quagga/core";

import { collectEnvironment, recentClientErrors } from "./client-errors";

/** Where each app mounts the handlers. Same path in all three. */
const REPORT_ENDPOINT = "/api/report";
const TRANSCRIBE_ENDPOINT = "/api/report/transcribe";

export interface SubmitReportInput {
  type: ReportType;
  /** What the reporter wrote, dictated, or both. */
  description: string;
  /** True if any of `description` came from the microphone. */
  dictated?: boolean;
  /** Let the server restructure the report with Claude. Default true. */
  useAi?: boolean;
  /**
   * Attach recent client errors and environment info. Default true.
   *
   * A UI that offers this as a toggle should show what would be sent —
   * "diagnostics" is not informed consent when the payload might contain the
   * error that leaked somebody's phone number.
   */
  includeDiagnostics?: boolean;
}

/**
 * Everything the server was told, for a UI that wants to show the reporter
 * exactly what they are about to publish. Building it is cheap; call it to
 * render a preview, then hand the same object nowhere — `submitReport` builds
 * its own.
 */
export function buildDiagnostics(): ReportDiagnostics {
  return { environment: collectEnvironment(), errorLogs: recentClientErrors() };
}

/** A failed submission, in a shape a form can render. */
export class ReportError extends Error {
  constructor(
    message: string,
    /** The server's machine-readable code, when it sent one. */
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
    this.name = "ReportError";
  }
}

async function readError(response: Response): Promise<ReportError> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    code?: unknown;
  } | null;
  const message =
    typeof body?.error === "string"
      ? body.error
      : `That didn't go through (${response.status}).`;
  const code = typeof body?.code === "string" ? body.code : null;
  return new ReportError(message, code, response.status);
}

/**
 * File a report. Resolves with the created issue, or throws a `ReportError`
 * carrying a message written for the person who is looking at the form.
 */
export async function submitReport(
  input: SubmitReportInput,
): Promise<ReportResponse> {
  const response = await fetch(REPORT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: input.type,
      description: input.description,
      dictated: input.dictated ?? false,
      useAi: input.useAi ?? true,
      diagnostics:
        input.includeDiagnostics === false
          ? { environment: [], errorLogs: [] }
          : buildDiagnostics(),
    }),
  });

  if (!response.ok) throw await readError(response);

  // Checked, not cast. The dialog renders these two straight into "Filed as
  // issue #N" and the link beside it, so a malformed 201 becomes "#undefined"
  // and a dead link — which reads like the report went nowhere.
  const body: unknown = await response.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as ReportResponse).url !== "string" ||
    typeof (body as ReportResponse).number !== "number"
  ) {
    throw new ReportError(
      "It may have been filed, but we couldn't read the answer. Check the issues before sending it again.",
      "bad-response",
      response.status,
    );
  }
  return body as ReportResponse;
}

/**
 * Transcribe a recording. Returns the text for the reporter to edit — it is
 * NOT submitted, and nothing is stored server-side.
 */
export async function transcribeRecording(audio: Blob): Promise<string> {
  const form = new FormData();
  // The extension matters: the server passes the filename through so Whisper
  // can identify the container.
  const extension = audio.type.includes("mp4") ? "mp4" : "webm";
  form.append("audio", audio, `dictation.${extension}`);

  const response = await fetch(TRANSCRIBE_ENDPOINT, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw await readError(response);

  const body = (await response.json()) as { text?: unknown };
  return typeof body.text === "string" ? body.text : "";
}
