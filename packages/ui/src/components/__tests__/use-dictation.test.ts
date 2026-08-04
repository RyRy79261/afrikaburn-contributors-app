import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useDictation } from "../../lib/use-dictation";

// The hook that opens the microphone. Two properties matter more than anything
// else it does:
//
//   1. It must always RELEASE the microphone. The source's own comment names
//      the worst case — unmounting while the permission prompt is open leaves
//      `recorderRef` null, so nothing stops the tracks and the browser's
//      recording indicator stays lit until reload. A live microphone nobody
//      asked for.
//   2. Every failure is a sentence a person can act on, never a browser error
//      string, because typing has to keep working when dictation cannot.
//
// jsdom has neither MediaRecorder nor navigator.mediaDevices, so `unsupported`
// is the honest default here and the fakes below are what buy the other paths.

const { transcribeRecording } = vi.hoisted(() => ({
  transcribeRecording: vi.fn(),
}));
vi.mock("../../lib/report-client", () => ({ transcribeRecording }));

class FakeTrack {
  stop = vi.fn();
}

class FakeStream {
  tracks = [new FakeTrack(), new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeRecorder {
  static last: FakeRecorder | null = null;
  static made = 0;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stopCalls = 0;

  constructor(readonly stream: FakeStream) {
    FakeRecorder.last = this;
    FakeRecorder.made += 1;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.stopCalls += 1;
    this.state = "inactive";
    this.onstop?.();
  }
  /** Feed the recorder a chunk, the way a real one does while recording. */
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
}

/** Install working microphone fakes; returns the stream that will be handed out. */
function withMicrophone(getUserMedia?: () => Promise<FakeStream>) {
  const stream = new FakeStream();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn(getUserMedia ?? (async () => stream)),
    },
  });
  return stream;
}

beforeEach(() => {
  FakeRecorder.last = null;
  FakeRecorder.made = 0;
  transcribeRecording.mockReset();
  transcribeRecording.mockResolvedValue("the transcript");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("an unsupported browser", () => {
  it("reports unsupported without ever asking for the microphone", async () => {
    // No stubs at all: this IS a browser without MediaRecorder.
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation({ onTranscript }));

    expect(result.current.supported).toBe(false);
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe("unsupported");
    // `unsupported` is a state, not an error — the UI hides the control and
    // says nothing alarming.
    expect(result.current.error).toBeNull();
  });
});

describe("permission", () => {
  it("returns to idle with a typeable alternative when the prompt is refused", async () => {
    withMicrophone(async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    });
    const { result } = renderHook(() =>
      useDictation({ onTranscript: vi.fn() }),
    );
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe("idle");
    // Never "NotAllowedError" — refused, dismissed and no-input-device are the
    // same thing to the person, and none of them is worth a browser string.
    expect(result.current.error).toBe(
      "We couldn't use the microphone. You can type instead.",
    );
  });

  it("PRIVACY GUARD: releases the stream when the component goes while the prompt is open", async () => {
    let release: ((s: FakeStream) => void) | undefined;
    const stream = withMicrophone(
      () =>
        new Promise<FakeStream>((resolve) => {
          release = resolve;
        }),
    );
    const { result, unmount } = renderHook(() =>
      useDictation({ onTranscript: vi.fn() }),
    );

    let started: Promise<void>;
    act(() => {
      started = result.current.start();
    });
    // The dialog closes while the browser is still asking.
    unmount();
    await act(async () => {
      release?.(stream);
      await started;
    });

    // No recorder exists, so nothing else in this hook could ever stop these.
    expect(FakeRecorder.made).toBe(0);
    for (const track of stream.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });

  it("releases the microphone when the component unmounts mid-recording", async () => {
    const stream = withMicrophone();
    const { result, unmount } = renderHook(() =>
      useDictation({ onTranscript: vi.fn() }),
    );
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe("recording");

    unmount();
    for (const track of stream.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });
});

describe("finishing a recording", () => {
  it("hands the audio over and reports the transcript once", async () => {
    withMicrophone();
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation({ onTranscript }));
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      FakeRecorder.last!.emit(64);
    });
    await act(async () => {
      result.current.stop();
    });

    await waitFor(() =>
      expect(onTranscript).toHaveBeenCalledWith("the transcript"),
    );
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("says an empty recording was empty and sends nothing anywhere", async () => {
    withMicrophone();
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation({ onTranscript }));
    await act(async () => {
      await result.current.start();
    });
    // No chunks ever arrived — a tap rather than a hold.
    await act(async () => {
      result.current.stop();
    });

    expect(result.current.error).toBe("That recording was empty.");
    expect(result.current.state).toBe("idle");
    // Uploading a zero-byte file to Groq would cost a round trip to be told so.
    expect(transcribeRecording).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("distinguishes silence from success rather than inserting an empty string", async () => {
    transcribeRecording.mockResolvedValue("");
    withMicrophone();
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation({ onTranscript }));
    await act(async () => {
      await result.current.start();
    });
    act(() => FakeRecorder.last!.emit(64));
    await act(async () => {
      result.current.stop();
    });

    await waitFor(() =>
      expect(result.current.error).toBe("We couldn't hear any speech in that."),
    );
    // Calling back with "" would silently wipe a field the UI replaces.
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("surfaces a transcription Error's own message", async () => {
    transcribeRecording.mockRejectedValue(
      new Error("Dictation isn't switched on for this deployment."),
    );
    withMicrophone();
    const { result } = renderHook(() =>
      useDictation({ onTranscript: vi.fn() }),
    );
    await act(async () => {
      await result.current.start();
    });
    act(() => FakeRecorder.last!.emit(64));
    await act(async () => {
      result.current.stop();
    });

    await waitFor(() =>
      expect(result.current.error).toBe(
        "Dictation isn't switched on for this deployment.",
      ),
    );
    expect(result.current.state).toBe("idle");
  });

  it("falls back to a plain sentence when the rejection is not an Error", async () => {
    transcribeRecording.mockRejectedValue("kaput");
    withMicrophone();
    const { result } = renderHook(() =>
      useDictation({ onTranscript: vi.fn() }),
    );
    await act(async () => {
      await result.current.start();
    });
    act(() => FakeRecorder.last!.emit(64));
    await act(async () => {
      result.current.stop();
    });

    await waitFor(() =>
      expect(result.current.error).toBe(
        "Transcription failed. You can type instead.",
      ),
    );
  });

  it("sets no state once the component has gone", async () => {
    let resolve: ((t: string) => void) | undefined;
    transcribeRecording.mockReturnValue(
      new Promise<string>((r) => {
        resolve = r;
      }),
    );
    withMicrophone();
    const onTranscript = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDictation({ onTranscript }),
    );
    await act(async () => {
      await result.current.start();
    });
    act(() => FakeRecorder.last!.emit(64));
    await act(async () => {
      result.current.stop();
    });
    unmount();
    await act(async () => {
      resolve?.("late transcript");
    });

    // A transcript that arrives after the dialog closed must go nowhere.
    expect(onTranscript).not.toHaveBeenCalled();
  });
});

describe("the hard stop", () => {
  it("stops recording on its own at maxDurationMs", async () => {
    vi.useFakeTimers();
    withMicrophone();
    const { result } = renderHook(() =>
      useDictation({ onTranscript: vi.fn(), maxDurationMs: 5_000 }),
    );
    await act(async () => {
      await result.current.start();
    });
    const recorder = FakeRecorder.last!;
    expect(recorder.state).toBe("recording");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    // A forgotten open microphone is both a privacy problem and an upload the
    // transcription endpoint would refuse anyway.
    expect(recorder.stopCalls).toBe(1);
    expect(recorder.state).toBe("inactive");
  });
});

describe("stop()", () => {
  it("does nothing when there is no live recording to stop", async () => {
    withMicrophone();
    const { result } = renderHook(() =>
      useDictation({ onTranscript: vi.fn() }),
    );

    // Idle: a double-tap on the mic button must not fabricate an empty
    // recording error out of nothing.
    act(() => result.current.stop());
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.stop();
    });
    const recorder = FakeRecorder.last!;
    // Already stopped — a second stop must not fire `onstop` twice.
    act(() => result.current.stop());
    expect(recorder.stopCalls).toBe(1);
  });
});
