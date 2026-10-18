"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Lock, NotebookPen, Pencil, Trash2 } from "lucide-react";
import { initialsFromName, MEMBER_NOTES_AUDIENCE_NOTE } from "@quagga/core";
import { MEMBER_NOTE_MAX } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Textarea } from "@quagga/ui/components/textarea";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import {
  EXPORT_REFUSED,
  exportFilenameFrom,
  exportResponseOutcome,
  settleAction,
  type PrivateNoteItemView,
} from "@/lib/member-records-view";

// The Private notes card on a burner's profile (docs/member-records-spec.md,
// frame R1 `Ka9U0` desktop / `r7hFMv` mobile 360). One card per camp the
// viewer and the person share where the viewer is a note person.
//
// DECIDES NOTHING. The page only renders this when the server's
// `loadProfileMemberNotes` returned a card — a plain camp-mate, the person
// themself and the org get no card at all (frame R1b) — and every note
// arrives with the server's `canEdit` / `canDelete` verdict. Each action
// re-decides from the database on every call. The export action (#105) shows
// only on the server's `canExport` (structural leads, co-leads and captains); its route
// re-decides from the database on every download.

/** A member-records action's result, as the store returns it. */
export type MemberNoteActionResult =
  { ok: true } | { ok: false; error: string };

/** A server action taking an untrusted payload (validated server-side). */
export type MemberNoteAction = (
  raw: unknown,
) => Promise<MemberNoteActionResult>;

/** One note as the card renders it: text and the server's verdicts only. */
export type PrivateNoteItem = PrivateNoteItemView;

const NUMBER = new Intl.NumberFormat("en-GB");

/** "50 / 2,000", red past the cap. */
function CharCount({ length }: { length: number }) {
  const over = length > MEMBER_NOTE_MAX;
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        over ? "text-destructive" : "text-muted-foreground",
      )}
      aria-live="polite"
    >
      {NUMBER.format(length)} / {NUMBER.format(MEMBER_NOTE_MAX)}
    </span>
  );
}

/** A note's text is sendable: something after trimming, within the cap. */
function sendable(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= MEMBER_NOTE_MAX;
}

function AuthorInitials({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold"
    >
      {initialsFromName(name)}
    </span>
  );
}

function NoteRow({
  slug,
  note,
  edit,
  remove,
}: {
  slug: string;
  note: PrivateNoteItem;
  edit: MemberNoteAction;
  remove: MemberNoteAction;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"view" | "edit" | "confirm">("view");
  const [draft, setDraft] = React.useState(note.body);
  const [isPending, startTransition] = React.useTransition();
  const editId = React.useId();

  function save() {
    startTransition(async () => {
      const result = await settleAction(() =>
        edit({ slug, noteId: note.id, body: draft }),
      );
      if (result.ok) {
        toast.success("Note saved");
        setMode("view");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function destroy() {
    startTransition(async () => {
      const result = await settleAction(() =>
        remove({ slug, noteId: note.id }),
      );
      if (result.ok) {
        toast.success("Note deleted");
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setMode("view");
    });
  }

  const meta = (
    <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground sm:flex-nowrap">
      <span className="text-sm font-medium text-foreground">
        {note.authorName}
      </span>
      <span className="hidden sm:inline" aria-hidden>
        ·
      </span>
      <span className="basis-full sm:basis-auto">
        {note.dateLabel}
        {note.edited && (
          <>
            <span aria-hidden> · </span>edited
          </>
        )}
      </span>
    </p>
  );

  return (
    <li className="flex gap-3 py-4" data-testid="private-note">
      <AuthorInitials name={note.authorName} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {mode === "edit" ? (
          <>
            {meta}
            <label htmlFor={editId} className="sr-only">
              Edit note
            </label>
            <Textarea
              id={editId}
              value={draft}
              maxLength={MEMBER_NOTE_MAX}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <div className="flex items-center justify-between gap-2">
              <CharCount length={draft.length} />
              <span className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft(note.body);
                    setMode("view");
                  }}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={save}
                  disabled={isPending || !sendable(draft)}
                >
                  {isPending ? "Saving…" : "Save"}
                </Button>
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              {meta}
              {note.unreadable ? (
                <p className="text-sm italic text-muted-foreground">
                  This note can&apos;t be read: the site&apos;s encryption key
                  has changed. Tell an organiser.
                </p>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm">
                  {note.body}
                </p>
              )}
            </div>
            {mode === "confirm" ? (
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <span className="text-sm text-muted-foreground">
                  Delete this note for good?
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={destroy}
                  disabled={isPending}
                >
                  {isPending ? "Deleting…" : "Delete"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMode("view")}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              (note.canEdit || note.canDelete) && (
                <div className="flex items-center gap-1 sm:shrink-0">
                  {note.canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setMode("edit")}
                      aria-label={`Edit note by ${note.authorName}, ${note.dateLabel}`}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Edit
                    </Button>
                  )}
                  {note.canDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setMode("confirm")}
                      aria-label={`Delete note by ${note.authorName}, ${note.dateLabel}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Delete
                    </Button>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Fetch the export and hand it to the browser as a download. Fetched rather
 * than linked so a refusal (no encryption key, access changed since the page
 * loaded) is a toast with a sentence, not a browser error page or a "file"
 * holding an error message.
 */
async function downloadExport(
  href: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(href, {
    cache: "no-store",
    credentials: "same-origin",
    // A redirect (the questionnaire gate, a lapsed session) must not be
    // followed into an HTML page that would then be saved as the "file".
    redirect: "manual",
  });
  const contentDisposition = res.headers.get("Content-Disposition");
  const outcome = exportResponseOutcome({
    status: res.status,
    contentDisposition,
  });
  if (outcome !== "file") {
    // 503 carries the server's own sentence (the encryption key); every other
    // refusal is the same not-found.
    return {
      ok: false,
      error: outcome === "unavailable" ? await res.text() : EXPORT_REFUSED,
    };
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFilenameFrom(contentDisposition);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before freeing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { ok: true };
}

/** "Export notes about this member" — structural leads, co-leads and
 * captains only
 * (the server's `canExport`; the route decides again on every call). */
function ExportNotesAction({
  href,
  subjectName,
}: {
  href: string;
  subjectName: string;
}) {
  const [isPending, startTransition] = React.useTransition();
  const hintId = React.useId();

  function run() {
    startTransition(async () => {
      const result = await settleAction(() => downloadExport(href));
      if (result.ok) toast.success("Notes exported");
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={isPending}
        aria-describedby={hintId}
        className="self-start sm:self-auto"
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
        {isPending ? "Exporting…" : "Export notes about this member"}
      </Button>
      <p id={hintId} className="text-xs text-muted-foreground sm:text-right">
        A text file to send {subjectName} if they ask for their notes. Read
        it first: notes can mention other people.
      </p>
    </div>
  );
}

/**
 * The Private notes card (frame R1): an add form with a 2,000-character
 * counter and the audience line, then the camp's notes about the person,
 * newest first, each with the edit / delete the server allowed.
 */
export function PrivateNotesCard({
  camp,
  subjectUserId,
  subjectName,
  notes,
  showCampName,
  exportHref,
  actions,
}: {
  camp: { name: string; slug: string };
  subjectUserId: string;
  subjectName: string;
  notes: PrivateNoteItem[];
  /** Several camps are shared: say which camp this card belongs to. */
  showCampName: boolean;
  /** The export route, when the server said this viewer may export (a
   * structural lead, co-lead or captain); null hides the action. */
  exportHref: string | null;
  actions: {
    add: MemberNoteAction;
    edit: MemberNoteAction;
    remove: MemberNoteAction;
  };
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState("");
  const [isPending, startTransition] = React.useTransition();
  const fieldId = React.useId();
  const audienceId = React.useId();

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!sendable(draft)) return;
    startTransition(async () => {
      const result = await settleAction(() =>
        actions.add({
          slug: camp.slug,
          subjectUserId,
          body: draft,
        }),
      );
      if (result.ok) {
        setDraft("");
        toast.success("Note added");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card data-testid="private-notes">
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <NotebookPen className="h-4 w-4 text-accent" aria-hidden />
            {showCampName ? `Private notes · ${camp.name}` : "Private notes"}
          </CardTitle>
          <CardDescription>
            About {subjectName}, kept by the camp. Newest first.
          </CardDescription>
        </div>
        {exportHref && (
          <ExportNotesAction href={exportHref} subjectName={subjectName} />
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <form onSubmit={add} className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="text-sm font-medium">
            Add a note
          </label>
          <Textarea
            id={fieldId}
            value={draft}
            maxLength={MEMBER_NOTE_MAX}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Something the camp's leads should know"
            aria-describedby={audienceId}
          />
          <p
            id={audienceId}
            className="flex items-start gap-2 text-xs text-muted-foreground"
          >
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {MEMBER_NOTES_AUDIENCE_NOTE}
          </p>
          <div className="flex items-center justify-between gap-2">
            <CharCount length={draft.length} />
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !sendable(draft)}
            >
              {isPending ? "Adding…" : "Add note"}
            </Button>
          </div>
        </form>

        {notes.length === 0 ? (
          <div className="mt-2 flex flex-col items-center gap-1 rounded-lg bg-muted/40 px-4 py-6 text-center">
            <NotebookPen
              className="h-5 w-5 text-muted-foreground"
              aria-hidden
            />
            <p className="text-sm font-semibold">No notes yet</p>
            <p className="text-xs text-muted-foreground">
              Notes added here show newest first.
            </p>
          </div>
        ) : (
          <ul
            className="flex flex-col divide-y divide-border border-t border-border"
            aria-label={`Private notes about ${subjectName}`}
          >
            {notes.map((note) => (
              <NoteRow
                key={note.id}
                slug={camp.slug}
                note={note}
                edit={actions.edit}
                remove={actions.remove}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
