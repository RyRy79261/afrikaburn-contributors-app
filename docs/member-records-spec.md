# Member records: lead notes and duplicate hints — Feature Spec

| Field                  | Value                                                         |
| ---------------------- | ------------------------------------------------------------- |
| **Category**           | Engineering Spec                                              |
| **Doc status**         | Active                                                        |
| **Normative language** | Descriptive only                                              |
| **Requirement IDs**    | Partial — App Spec §4 `CDB-025`, `CDB-034`, `CDB-038`, `CDB-040` |
| **Owner / Updated**    | Ryan, 2026-10-16                                              |

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
  request them; that question is raised with the working group in
  [#105](https://github.com/RyRy79261/afrikaburn-contributors-app/issues/105).
  The note form says so in one line.
- **Duplicates**: a hint only, from **similar names** (the existing
  `name-dedupe.ts` trigram similarity). No merging. Phone, ID and other
  hard-locked fields are never compared.
- **Retention**: notes stay while a member is archived (they may come back);
  leaving the camp or deleting the account deletes them.

- Frames: R1 profile with private notes `Ka9U0` / `r7hFMv`, R1b plain
  camp-mate view `Z7GfV0` / `TvN1a`, R2 roster with notes and duplicate chips
  `cMHOt` / `Xdabl`.

## Model

- `member_notes` (camp, subject user, body text ≤ 2 000 chars, author user,
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
  the text). Reading is not audited (as roster reads are not).
- Notes never appear in the roster table, any CSV export, stats, search, the
  org console, or a notification.
- Duplicate hint: within one camp, two current members whose display names
  are similar (`isSimilarName`) are both flagged "possible duplicate", shown
  only to roster viewers with `view_member_details`. Dismissing a pair hides it
  for that camp (`member_duplicate_dismissals` (camp, user_a, user_b)), so the
  same pair is not flagged again.

## Surfaces

- Member profile `/burners/[id]`, for note people of a shared camp: a
  **Private notes** card (list, add, edit own, delete own; leads may delete
  any) with the line "Only the camp's leads and note-keepers see these. The
  member can request them under POPIA."
- Roster: a small "Notes" count chip on a member row for note people (count
  only, never text), and a "Possible duplicate" chip with a dismiss action for
  roster viewers.
- Roles editor: the `member_notes` privilege.

## Not built

- Showing members the notes about them, and a POPIA access export (#105).
- Duplicate detection on anything but names; merging accounts.
- Notes on org-side accounts (the console has its own staff notes).
