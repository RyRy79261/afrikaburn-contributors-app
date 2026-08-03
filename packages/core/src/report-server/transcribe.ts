// Dictation, via Groq's hosted Whisper.
//
// Speaking a bug report is often the only practical way to file one: the person
// noticing the problem is frequently on a phone, mid-task, and about to move on.
// A dictation button is the difference between a report and a shrug.
//
// ## The key is the server's, not the user's
//
// Ported from RyRy79261/intake-tracker, where each person brings their own Groq
// key from a settings page. That model does not transfer: a burner filling in a
// camp registration will not go and create a Groq account, so a BYO key means
// dictation that nobody can use. One server-side `GROQ_API_KEY` covers everyone,
// which is why this endpoint is gated on a session and rate limited per account
// — without those two it is an open transcription service on someone else's bill.
//
// ## What leaves the device
//
// The audio goes to Groq. That is a third party receiving a recording of
// somebody's voice describing, quite possibly, another person's problem. The
// transcript comes back to the browser and is NOT filed anywhere by this route
// — the reporter edits it and decides whether to submit, and only then does the
// redaction pass in `report-sanitize.ts` apply. Any UI that offers dictation has
// to say where the audio goes before it starts recording.

import type { RateLimitVerdict, ReportViewer } from "./handler";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";

/**
 * Whisper's `prompt` biases recognition toward expected vocabulary. This is a
 * product almost entirely used by South Africans talking about a specific
 * event, and without the hint "Tankwa" and "binnekring" come back as noise.
 */
const DOMAIN_PROMPT =
  "AfrikaBurn Contributors App bug report. Theme camp, mutant vehicle, artwork, " +
  "burner, binnekring, Tankwa Town, Quagga, registration wizard, placement, " +
  "bulletin, questionnaire, supplier, organiser console, invite code.";

/** 10 MB. A dictated bug report is seconds long; anything larger is not one. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ["audio/", "video/webm", "video/mp4"];

/** Transcriptions one account may request per hour. */
export const TRANSCRIPTIONS_PER_HOUR = 30;
const RATE_WINDOW_SECONDS = 60 * 60;

export interface TranscribeHandlerOptions {
  identify: () => Promise<ReportViewer | null>;
  consumeRateLimit: (input: {
    key: string;
    max: number;
    windowSeconds: number;
  }) => Promise<RateLimitVerdict>;
}

export interface TranscribeResponse {
  text: string;
}

function json(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function transcriptionConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export function createTranscribeHandler(
  options: TranscribeHandlerOptions,
): (request: Request) => Promise<Response> {
  const { identify, consumeRateLimit } = options;

  return async function POST(request: Request): Promise<Response> {
    const viewer = await identify();
    if (!viewer) {
      return json({ error: "Sign in to use dictation." }, 401);
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      // Not an error the user can act on. The UI should hide the microphone
      // when this is the case rather than offering a button that 503s.
      return json(
        {
          error: "Dictation isn't switched on for this deployment.",
          code: "not-configured",
        },
        503,
      );
    }

    const verdict = await consumeRateLimit({
      key: `transcribe:${viewer.id}`,
      max: TRANSCRIPTIONS_PER_HOUR,
      windowSeconds: RATE_WINDOW_SECONDS,
    });
    if (!verdict.allowed) {
      return json(
        {
          error: "Too many recordings this hour. Please type instead.",
          code: "rate-limited",
        },
        429,
        { "Retry-After": String(verdict.retryAfterSeconds) },
      );
    }

    // Refuse an oversized body BEFORE parsing it. `formData()` materialises the
    // whole upload in memory, so the size check below — which is the authority,
    // and still runs — was happening after the cost it exists to avoid. A
    // signed-in caller could make the server buffer far more than the cap,
    // thirty times an hour. `Content-Length` is a hint (absent on a chunked
    // request), which is why this is an extra guard and not a replacement.
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
      return json(
        {
          error: "That recording is too long. Keep it under a minute or two.",
          code: "too-large",
        },
        413,
      );
    }

    const form = await request.formData().catch(() => null);
    const entry = form?.get("audio");
    // Narrowed by shape rather than `instanceof File`: this package compiles
    // against `lib: ES2022` with no DOM, so `File` is not a type the compiler
    // can narrow a `FormDataEntryValue` union with. A string entry is a
    // hand-rolled request, not a recording.
    if (!entry || typeof entry === "string") {
      return json({ error: "No audio was received." }, 400);
    }
    const file = entry;
    if (file.size === 0) {
      return json({ error: "That recording was empty." }, 400);
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return json(
        {
          error: "That recording is too long. Keep it under a minute or two.",
          code: "too-large",
        },
        413,
      );
    }
    // A part declaring no type FAILS the check rather than skipping it —
    // matching the blob upload route, and for the same reason: the allowlist is
    // the only thing standing between this endpoint and an arbitrary upload.
    if (!ALLOWED_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix))) {
      return json(
        {
          error: `That isn't an audio recording (${file.type || "no type"}).`,
          code: "bad-type",
        },
        415,
      );
    }

    const upstream = new FormData();
    // Groq's OpenAI-compatible endpoint takes the file under `file`; the
    // filename is kept so it can sniff the container.
    upstream.append("file", file, file.name || "clip.webm");
    upstream.append("model", GROQ_MODEL);
    upstream.append("prompt", DOMAIN_PROMPT);
    upstream.append("response_format", "json");
    upstream.append("temperature", "0");
    // `language` is deliberately UNSET. Plenty of this product's users will
    // report a bug in Afrikaans, and pinning English would transcribe them into
    // nonsense rather than letting Whisper detect what it heard.

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upstream,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return json(
          {
            error: "Transcription timed out. Please type instead.",
            code: "timeout",
          },
          504,
        );
      }
      console.error("[transcribe] request failed:", error);
      return json({ error: "Transcription failed. Please type instead." }, 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // The status only — an upstream error body can quote the request, and the
      // request is somebody's voice.
      console.error(`[transcribe] Groq ${response.status}`);
      return json(
        {
          error: "Transcription failed. Please type instead.",
          code: "upstream",
        },
        502,
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      text?: unknown;
    } | null;
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!text) {
      return json(
        { error: "We couldn't hear any speech in that.", code: "empty" },
        422,
      );
    }

    console.log(
      `[AUDIT] transcription for user ${viewer.id} (${file.size} bytes)`,
    );

    const body: TranscribeResponse = { text };
    return json(body, 200);
  };
}
