// Which notes text the meeting page should show and start the editor from.
//
// The page's `notesMd` prop is what the server rendered. After "Save notes"
// the editor closes and router.refresh() asks for a fresh render — but until that
// lands (seconds on a slow link at the event, or never if it fails) the prop
// still holds the text from BEFORE the edit, while the shared version has
// already moved on to the save. Reopening the editor from that prop would
// pair old text with the new version, and the first keystroke would pass the
// compare-and-set on the next save and silently replace the notes just saved. So the page
// carries the last text it saved alongside the version that save made, and
// uses it until a render at least that new arrives.

/** Notes text paired with the meeting version it is current at. */
export interface VersionedNotes {
  notesMd: string;
  version: number;
}

/**
 * The newest notes text this page knows: the last save made here when it is
 * newer than the server's render, otherwise the render.
 */
export function currentMeetingNotes(
  rendered: VersionedNotes,
  lastSaved: VersionedNotes | null,
): string {
  return lastSaved !== null && lastSaved.version > rendered.version
    ? lastSaved.notesMd
    : rendered.notesMd;
}
