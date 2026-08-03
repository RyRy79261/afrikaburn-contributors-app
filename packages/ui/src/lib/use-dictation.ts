"use client";

// The recording half of dictation, with no opinion about how it looks.
//
// A transcription endpoint on its own is not dictation — something has to ask
// for the microphone, capture audio, and hand it over. That is this. What it
// deliberately does NOT do is decide what a microphone button looks like, where
// it sits, or how recording is signalled; that is the design, and it is Ryan's.
//
// ## Two things a UI built on this must do
//
// 1. **Say where the audio goes before recording starts.** It leaves the device
//    for Groq. Somebody dictating "Nikki's emergency contact is wrong" is
//    sending a recording of themselves saying a third party's name to a company
//    they have never heard of.
// 2. **Never make dictation the only route.** Permission can be refused, the
//    browser may not support it, and `GROQ_API_KEY` may be unset. Typing has to
//    work on its own — `unsupported` is a state, not an error.

import { useCallback, useEffect, useRef, useState } from "react";

import { transcribeRecording } from "./report-client";

export type DictationState =
  "idle" | "requesting" | "recording" | "transcribing" | "unsupported";

export interface UseDictationOptions {
  /** Called with the transcript. Append or replace — the UI decides. */
  onTranscript: (text: string) => void;
  /**
   * Hard stop, in milliseconds. A forgotten open microphone is both a privacy
   * problem and a 10 MB upload that gets refused.
   */
  maxDurationMs?: number;
}

export interface UseDictation {
  state: DictationState;
  /** A message for the person, or null. Never a raw browser error. */
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /** False when this browser cannot record at all — hide the control. */
  supported: boolean;
}

const DEFAULT_MAX_DURATION_MS = 90_000;

export function useDictation(options: UseDictationOptions): UseDictation {
  const { onTranscript, maxDurationMs = DEFAULT_MAX_DURATION_MS } = options;

  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a transcript arriving after the component has gone.
  const mountedRef = useRef(true);

  const supported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  /** Stop the tracks. Without this the browser's recording indicator stays on. */
  const releaseMicrophone = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Unmounting mid-recording must not leave the microphone live.
      releaseMicrophone();
    };
  }, [releaseMicrophone]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const start = useCallback(async () => {
    if (!supported) {
      setState("unsupported");
      return;
    }
    setError(null);
    setState("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Refused, dismissed, or no input device — all the same to the person,
      // and none of them worth a browser error string.
      if (mountedRef.current) {
        setState("idle");
        setError("We couldn't use the microphone. You can type instead.");
      }
      return;
    }

    // The permission prompt is open across that await, and the dialog can be
    // closed while it is. The unmount effect has already run by then and found
    // `recorderRef.current` null, so nothing would ever release these tracks:
    // no recorder means no `stop()`, no `onstop`, and the browser's recording
    // indicator stays lit until the page is reloaded. A live microphone nobody
    // asked for is the worst failure this hook has.
    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const audio = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      releaseMicrophone();

      if (audio.size === 0) {
        if (mountedRef.current) {
          setState("idle");
          setError("That recording was empty.");
        }
        return;
      }

      if (mountedRef.current) setState("transcribing");
      void transcribeRecording(audio)
        .then((text) => {
          if (!mountedRef.current) return;
          setState("idle");
          if (text) onTranscript(text);
          else setError("We couldn't hear any speech in that.");
        })
        .catch((cause: unknown) => {
          if (!mountedRef.current) return;
          setState("idle");
          setError(
            cause instanceof Error
              ? cause.message
              : "Transcription failed. You can type instead.",
          );
        });
    };

    recorder.start();
    setState("recording");
    stopTimerRef.current = setTimeout(stop, maxDurationMs);
  }, [supported, maxDurationMs, onTranscript, releaseMicrophone, stop]);

  return { state, error, start, stop, supported };
}
