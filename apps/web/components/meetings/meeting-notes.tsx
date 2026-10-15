"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CloudOff,
  History,
  Loader2,
  NotebookPen,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { MarkdownEditor } from "@quagga/ui/components/markdown-editor/markdown-editor";
import { MarkdownView } from "@quagga/ui/components/markdown-editor/markdown-view";
import {
  createLayoutAutosave,
  type AutosaveState,
} from "@/lib/layout-autosave";
import { saveMeetingNotesAction } from "@/app/(app)/camps/[slug]/meetings/actions";
import { useMeetingVersion } from "./meeting-version";

// The meeting notes (frame G2): read by everyone the meeting is for, written
// by its note-takers in the shared markdown editor. Saving is the camp
// layout's autosave controller (lib/layout-autosave.ts), unchanged: one
// compare-and-set save in flight, debounced, retried while offline, sent on
// leaving instead of dropped, and stopped by a conflict — "someone else saved
// first" — until the writer reloads. Saving the notes notifies nobody.

const AUTOSAVE_MS = 1500;
const RETRY_MS = 5000;

/** The save chip's words for each autosave state. */
function SaveStatus({ state }: { state: AutosaveState }) {
  const base = "inline-flex items-center gap-1.5 text-xs text-muted-foreground";
  switch (state.kind) {
    case "saved":
      return (
        <span className={base} role="status">
          <Check className="h-3.5 w-3.5" aria-hidden />
          Saved
        </span>
      );
    case "pending":
      return (
        <span className={base} role="status">
          Unsaved changes
        </span>
      );
    case "saving":
      return (
        <span className={base} role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Saving…
        </span>
      );
    case "offline":
      return (
        <span className={base} role="status">
          <CloudOff className="h-3.5 w-3.5" aria-hidden />
          Offline — retrying
        </span>
      );
    default:
      return null;
  }
}

/** The notes editor, mounted only while editing so its timers live with it. */
function NotesEditor({
  slug,
  meetingId,
  initial,
  onDone,
}: {
  slug: string;
  meetingId: string;
  initial: string;
  onDone: () => void;
}) {
  const { version, setVersion } = useMeetingVersion();
  const [notes, setNotes] = React.useState(initial);
  const [state, setState] = React.useState<AutosaveState>({ kind: "saved" });
  const [autosave] = React.useState(() =>
    createLayoutAutosave<string>({
      initial,
      version,
      send: (notesMd, expectedVersion) =>
        saveMeetingNotesAction({
          slug,
          id: meetingId,
          expectedVersion,
          notesMd,
        }),
      onState: setState,
      onSaved: setVersion,
      debounceMs: AUTOSAVE_MS,
      retryMs: RETRY_MS,
    }),
  );

  React.useEffect(() => {
    autosave.change(notes);
  }, [autosave, notes]);

  // Leaving sends what is unsaved instead of dropping it (App Router
  // navigation fires no beforeunload); a full unload asks first.
  React.useEffect(() => {
    /** Asks before unloading while a change worth keeping is unsaved. */
    const onLeave = (e: BeforeUnloadEvent) => {
      if (autosave.shouldWarnOnLeave()) e.preventDefault();
    };
    /** Sends what is unsaved as the page goes away. */
    const onPageHide = () => autosave.leave();
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("pagehide", onPageHide);
      autosave.leave();
    };
  }, [autosave]);

  /** "Done": send what is left now, then close the editor. */
  async function done() {
    await autosave.flush();
    if (!autosave.hasUnsaved()) onDone();
  }

  return (
    <div className="flex flex-col gap-3">
      {state.kind === "conflict" && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            aria-hidden
          />
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              Someone else saved this meeting while you were editing. Your
              version is still in the editor: copy what you need, reload to see
              theirs, then add yours back.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Reload notes
            </Button>
          </div>
        </div>
      )}
      {state.kind === "refused" && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
            aria-hidden
          />
          <div className="flex flex-col gap-2">
            <p className="text-sm">{state.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => autosave.retry()}
            >
              Try again
            </Button>
          </div>
        </div>
      )}
      <MarkdownEditor
        value={notes}
        onChange={setNotes}
        ariaLabel="Meeting notes"
      />
      <p className="text-xs text-muted-foreground">
        Markdown. Saves as you type. Saving the notes doesn&apos;t notify
        anyone.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void done()}
          disabled={state.kind === "saving"}
        >
          Done
        </Button>
        <SaveStatus state={state} />
      </div>
    </div>
  );
}

/** The Notes card: the rendered notes, "last edited by", and — for
 * note-takers — "Edit notes" opening the autosaving editor. */
export function MeetingNotes({
  slug,
  meetingId,
  notesMd,
  lastEdited,
  canEdit,
}: {
  slug: string;
  meetingId: string;
  notesMd: string;
  /** "Last edited by Ren Notfound · 21 Mar 2027, 20:14", or null. */
  lastEdited: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);

  return (
    <section
      aria-labelledby="notes-heading"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="notes-heading"
          className="flex items-center gap-2 font-semibold"
        >
          <NotebookPen className="h-4 w-4 text-primary" aria-hidden />
          Notes
        </h2>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit notes
          </Button>
        )}
      </div>
      {editing ? (
        <NotesEditor
          slug={slug}
          meetingId={meetingId}
          initial={notesMd}
          onDone={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      ) : notesMd.trim() ? (
        <MarkdownView value={notesMd} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? "No notes yet. Write them during or after the meeting — everyone it's for can read them."
            : "No notes yet."}
        </p>
      )}
      {!editing && lastEdited && (
        <p className="flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          <History className="h-3.5 w-3.5" aria-hidden />
          {lastEdited}
        </p>
      )}
    </section>
  );
}
