"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  History,
  Loader2,
  NotebookPen,
  Pencil,
  RefreshCw,
  Save,
} from "lucide-react";
import { z } from "zod";
import { MEETING_NOTES_MAX } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { MarkdownEditor } from "@quagga/ui/components/markdown-editor/markdown-editor";
import { MarkdownView } from "@quagga/ui/components/markdown-editor/markdown-view";
import { toast } from "@quagga/ui/components/toast";
import { saveMeetingNotesAction } from "@/app/(app)/camps/[slug]/meetings/actions";
import {
  DraftRestoredNote,
  useDraftAutosave,
  useEditorDraft,
  type EditorDraft,
} from "@/components/editor-draft";
import {
  browserDraftStore,
  readDraft,
  type DraftTarget,
} from "@/lib/editor-draft";
import {
  currentMeetingNotes,
  type VersionedNotes,
} from "@/lib/meeting-notes-state";
import { useMeetingVersion } from "./meeting-version";

// The meeting notes (frame G2): read by everyone the meeting is for, written
// by its note-takers in the shared markdown editor. Like Camp 404's minutes
// editor (Ryan, 15 Oct 2026), the notes save with ONE explicit "Save notes",
// a compare-and-set on the version the editor opened; a stale version shows
// "someone else saved first" and keeps the text in the editor. While typing,
// the text is kept as a local draft in this browser (lib/editor-draft.ts) and
// offered back on reopening with "Draft restored" and Discard. Nothing
// reaches the server before Save. Saving the notes notifies nobody.

/** Which editor's drafts these are (lib/editor-draft.ts key). */
const NOTES_EDITOR = "meeting-notes";

/** A notes draft read back: just the text (the key names meeting, writer and
 * version). Bounded at twice the store's limit, so notes typed past it are
 * still kept, and the save says they are too long instead of losing them. */
const NotesDraft = z.object({
  notesMd: z.string().max(MEETING_NOTES_MAX * 2),
});
type NotesDraft = z.infer<typeof NotesDraft>;

/** A draft read back, or null to throw it away. */
function parseNotesDraft(raw: unknown): NotesDraft | null {
  const parsed = NotesDraft.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether this browser holds a notes draft for this meeting at `version`,
 * other than the saved text. Reading also removes this writer's drafts typed
 * over any older version: the notes moved on under them.
 */
function hasNotesDraft(
  target: DraftTarget,
  version: number,
  saved: string,
): boolean {
  const store = browserDraftStore();
  if (!store) return false;
  return (
    readDraft(store, target, version, parseNotesDraft, { notesMd: saved }) !==
    null
  );
}

const DISCARD_QUESTION =
  "Throw away your unsaved changes to the notes? This can't be undone.";

type EditorProps = {
  slug: string;
  meetingId: string;
  target: DraftTarget;
  /** The saved notes the editor opens over. */
  initial: string;
  onSaved: (saved: VersionedNotes) => void;
  onClose: () => void;
};

/** The notes editor, mounted only while editing. The wrapper keys the form by
 * the draft's generation, so a restore or a Discard starts it again. */
function NotesEditor(props: EditorProps) {
  const { version, onWrite } = useMeetingVersion();
  // The version and text the editor OPENED at, held until it closes: a fresh
  // render that brings someone else's newer save (a tick re-renders the page)
  // must not move them, or Save would pass the compare-and-set over notes
  // the writer never saw. Only a write on this page that did not touch the
  // notes (a cancel) moves the version, and only from the one held.
  const [held, setHeld] = React.useState(version);
  const [initial] = React.useState(props.initial);
  React.useEffect(
    () => onWrite((from, to) => setHeld((v) => (v === from ? to : v))),
    [onWrite],
  );
  const draft = useEditorDraft<NotesDraft>({
    target: props.target,
    version: held,
    baseline: { notesMd: initial },
    parse: parseNotesDraft,
  });
  return <NotesForm key={draft.generation} {...props} draft={draft} />;
}

function NotesForm({
  slug,
  meetingId,
  onSaved,
  onClose,
  draft,
}: EditorProps & { draft: EditorDraft<NotesDraft> }) {
  const { setVersion } = useMeetingVersion();
  const [notes, setNotes] = React.useState(draft.start.notesMd);
  const [pending, startTransition] = React.useTransition();
  const [conflict, setConflict] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { dirty, saved } = useDraftAutosave(draft, { notesMd: notes });
  // The writer chose to reload after a conflict: no second question.
  const reloading = React.useRef(false);

  // A reload or a closed tab asks first while something is unsaved (the
  // draft is kept either way; App Router navigation fires no beforeunload).
  React.useEffect(() => {
    if (!dirty) return;
    /** Asks before unloading while the notes differ from what is saved. */
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!reloading.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  /** "Save notes": one compare-and-set write at the version opened. */
  function save() {
    setError(null);
    const notesMd = notes;
    const expectedVersion = draft.version;
    startTransition(async () => {
      const r = await saveMeetingNotesAction({
        slug,
        id: meetingId,
        expectedVersion,
        notesMd,
      }).catch(() => ({
        ok: false as const,
        error: "Couldn't save the notes. Check your connection and try again.",
        conflict: false,
      }));
      if (!r.ok) {
        // The text stays in the editor, and in the draft, either way.
        if (r.conflict) setConflict(true);
        else setError(r.error);
        return;
      }
      saved();
      setVersion(r.version);
      onSaved({ notesMd, version: r.version });
      toast.success("Notes saved");
      onClose();
    });
  }

  /** "Cancel": throws away what is unsaved, the draft too, and closes —
   * asking first when there is something to lose. */
  function cancel() {
    if (dirty && !window.confirm(DISCARD_QUESTION)) return;
    draft.discard();
    onClose();
  }

  return (
    <div className="flex flex-col gap-3">
      <DraftRestoredNote draft={draft} disabled={pending} />
      {conflict && (
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
              onClick={() => {
                reloading.current = true;
                window.location.reload();
              }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Reload notes
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <MarkdownEditor
        value={notes}
        onChange={setNotes}
        ariaLabel="Meeting notes"
      />
      {/* Kept at the bottom of the window while the notes scroll, so Save is
          in reach on a phone without scrolling to the end. */}
      <div
        data-testid="notes-save-bar"
        className="sticky bottom-0 z-10 -mx-5 flex flex-col gap-2 border-t border-border bg-card px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-xs text-muted-foreground">
          Markdown. Kept as a draft in this browser until you save. Saving
          doesn&apos;t notify anyone.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={cancel}
            disabled={pending}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={pending || conflict}
            className="flex-1 sm:flex-none"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            {pending ? "Saving…" : "Save notes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The Notes card: the rendered notes, "last edited by", and — for
 * note-takers — "Edit notes" opening the editor. A draft this browser holds
 * for this meeting at the current version opens the editor by itself. */
export function MeetingNotes({
  slug,
  meetingId,
  userId,
  notesMd: renderedNotes,
  version: renderedVersion,
  lastEdited,
  canEdit,
}: {
  slug: string;
  meetingId: string;
  /** The signed-in user: drafts are kept per writer. */
  userId: string;
  notesMd: string;
  /** The meeting version the server rendered `notesMd` at. */
  version: number;
  /** "Last edited by Ren Notfound · 21 Mar 2027, 20:14", or null. */
  lastEdited: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  // The last notes saved here, until a render at least that new lands.
  const [lastSaved, setLastSaved] = React.useState<VersionedNotes | null>(null);
  const notesMd = currentMeetingNotes(
    { notesMd: renderedNotes, version: renderedVersion },
    lastSaved,
  );
  const { version } = useMeetingVersion();
  const target = React.useMemo<DraftTarget>(
    () => ({ editor: NOTES_EDITOR, userId, subject: meetingId }),
    [userId, meetingId],
  );

  // Once mounted (storage is the browser's, never the server render's): a
  // draft left here reopens the editor, so a reload mid-notes lands back in
  // them with "Draft restored".
  const checkedDraft = React.useRef(false);
  React.useEffect(() => {
    if (checkedDraft.current || !canEdit) return;
    checkedDraft.current = true;
    if (hasNotesDraft(target, version, notesMd)) setEditing(true);
  }, [canEdit, target, version, notesMd]);

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
          target={target}
          initial={notesMd}
          onSaved={setLastSaved}
          onClose={() => {
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
