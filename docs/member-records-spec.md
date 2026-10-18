# Member records: lead notes and duplicate hints — Feature Spec

| Field                  | Value                                                         |
| ---------------------- | ------------------------------------------------------------- |
| **Category**           | Engineering Spec                                              |
| **Doc status**         | Active                                                        |
| **Normative language** | Descriptive only                                              |
| **Requirement IDs**    | Partial — App Spec §4 `CDB-025`, `CDB-034`, `CDB-038`, `CDB-040` |
| **Owner / Updated**    | Ryan, 2026-10-18                                              |

Camp leads keep notes about their people in a private spreadsheet: "great on
build, needs a lift", "asked not to be on night shifts". And when a camp
grows, the same person sometimes ends up on the roster twice under two
accounts. This gives leads private notes on a member and a quiet "possible
duplicate" hint on the roster.

## Decisions (Ryan, 16 Oct 2026)

- **Who writes and reads notes**: camp leads, co-leads, and members holding a
  new camp privilege **`member_notes`** (e.g. a welfare lead). Nobody else in
  the camp; never the org; never public.
- **The member does not see notes about them.** Under POPIA a member can still
  request them
  ([#105](https://github.com/RyRy79261/afrikaburn-contributors-app/issues/105));
  the lead export below answers that, pending the working group's
  confirmation. The note form says so in one line.
- **POPIA access: a lead export** (Ryan, 18 Oct 2026, #105 — built now, the
  working group confirms later). When a member asks for the notes the camp
  keeps about them (POPIA s23), **the camp's leads answer**: a structural lead
  or co-lead of THAT camp — **or a captain of THAT camp** (holds its Captain
  role; Ryan, 18 Oct 2026, same day) — exports the notes from the member's
  profile and sends the file on themselves. Not a `member_notes` holder alone
  (keeping notes is not answering for the camp, and a custom role granting
  every privilege is not the Captain role), not other members, not leads or
  captains of other camps, never the org console. The member still never
  sees notes in the app. Defaults chosen with it, each easy to change: plain
  UTF-8 text, one file per member per camp; **no author names or ids** (who
  wrote a note is third-party information, the PAIA-protective default); no
  notification or email to anyone. See §Export.
- **Duplicates**: a hint only, from **similar names** (the existing
  `name-dedupe.ts` trigram similarity). No merging. Phone, ID and other
  hard-locked fields are never compared.
- **Retention**: notes stay while a member is archived (they may come back);
  leaving the camp or deleting the account deletes them.
- **Encrypted at rest** (Ryan, 17 Oct 2026): a note's text is stored exactly
  as medical notes are — AES-256-GCM via `@quagga/db/crypto`, encrypted and
  decrypted at the apps/web boundary. With no `PGCRYPTO_KEY` a note is
  refused, never stored in plaintext. A note that cannot be decrypted shows as
  unreadable (never as empty) and cannot be edited, only deleted.
- **Captains** keep notes too (Ryan, 17 Oct 2026): the captain role is locked
  to every privilege, `member_notes` included. Like any note-keeper who is not
  a structural lead, a captain deletes only their own notes.

- Frames: R1 profile with private notes `Ka9U0` / `r7hFMv`, R1b plain
  camp-mate view `Z7GfV0` / `TvN1a`, R2 roster with notes and duplicate chips
  `cMHOt` / `Xdabl`.

## Model

- `member_notes` (camp, subject user, body text ≤ 2 000 chars — stored as
  ciphertext, see Decisions — author user,
  created_at, updated_at, edited_by) — several notes per member, newest first.
  Keyed by (camp, user), not membership, so archive keeps them; `leaveCamp`
  and account erasure delete them in their transactions.
- Duplicate hints are computed on read (never stored). Only a dismissal is
  stored: `member_duplicate_dismissals` (camp, user_a, user_b; the pair
  ordered so each pair has one row), so a dismissed pair is not flagged
  again.

## Rules (`@quagga/core`, server-side)

- `canManageMemberNotes(viewer)`: structural lead / admin, or `member_notes`.
  `member_notes` is elevating (an `assign_roles`-only holder cannot grant it).
- Notes are about current or archived members of THIS camp only. A note on
  someone outside the camp is refused as not found.
- Every create, edit and delete writes an `audit_events` row (ids only, never
  the text). Reading on the card is not audited (as roster reads are not);
  an export is (§Export).
- Notes never appear in the roster table, any CSV export, stats, search, the
  org console, or a notification. The one export is the lead's per-member
  POPIA file (§Export).
- `canExportMemberNotes(viewer, subject)`: a STRUCTURAL lead or co-lead of
  this camp (`isPermissionBackstop`), or a holder of this camp's Captain role
  (`holdsCaptainRole` — the role's KIND, accepted consent; never inferred from
  permissions), about a current or archived member who is not themselves.
  `member_notes` alone is not enough.
- Duplicate hint: within one camp, two current members whose display names
  are similar (`isSimilarName`) are both flagged "possible duplicate", shown
  only to roster viewers with `view_member_details`. Dismissing a pair hides it
  for that camp (`member_duplicate_dismissals` (camp, user_a, user_b)), so the
  same pair is not flagged again.

## Surfaces

- Member profile `/burners/[id]`, for note people of a shared camp: a
  **Private notes** card (list, add, edit own, delete own; leads may delete
  any; leads, co-leads and captains may export, §Export) with the line "Only the camp's leads and note-keepers see these. The
  member can request them under POPIA."
- Roster: a small "Notes" count chip on a member row for note people (count
  only, never text), and a "Possible duplicate" chip with a dismiss action for
  roster viewers.
- Roles editor: the `member_notes` privilege.

## Export (POPIA s23 access request, #105)

- **Where**: the member's profile, on the Private notes card — an "Export
  notes about this member" action, for structural leads, co-leads and
  captains of the camp only.
  One member at a time; never from a list, the roster or in bulk.
- **Route**: `GET /camps/[slug]/member-notes/[userId]/export`. Re-decides on
  every call from the database (actor and member locked `FOR SHARE`,
  permissions loaded live, `canExportMemberNotes`). Every refusal is the same
  404; a request the browser marks `cross-site` or `same-site`
  (`Sec-Fetch-Site`) is refused, and HEAD is a 405 (it would otherwise run
  the export).
  `Cache-Control: private, no-store`; the filename is slugified
  (`member-notes-<camp>-<member>-<YYYY-MM-DD>.txt`).
- **The file**: plain UTF-8 text. A header — the camp, the member's display
  name, the date exported, and one paragraph saying these are the camp's
  notes about them provided under POPIA s23 and that authors are not named.
  Then each note, **oldest first**: the day written, the day last edited if it
  was, and the text. **No author name or id.** A note that cannot be decrypted
  is listed with its date as "[This note could not be read]" — never dropped,
  never ciphertext.
- **No key, no file**: with no `PGCRYPTO_KEY` — or a key that reads none of
  the member's notes (wrong or rotated) — the export is refused with a
  sentence (503), never a file of unreadable placeholders.
- **The action's hint**: "A text file to send {member} if they ask for their
  notes. Read it first: notes can mention other people." Authors are removed;
  third parties named in a note's text are the lead's to check.
- **Audit**: every export writes ONE `audit_events` row,
  `camp.member_note.export` — actor, camp, member id and the note count;
  never text. It is a member-records action, so the org console's audit
  readers exclude it in the query like the others.
- **Nothing automatic**: no notification, no email; whoever exports sends the
  file.
- Frame: R1 `Ka9U0` / `r7hFMv` still needs the export action drawn.

## Not built

- Showing members the notes about them in the app (by decision — the export
  above is the access path).
- An export of everything held about one member across the platform (#105
  asks; the working group has not answered).
- Duplicate detection on anything but names; merging accounts.
- Notes on org-side accounts (the console has its own staff notes).
