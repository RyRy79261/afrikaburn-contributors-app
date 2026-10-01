# Camp shifts and rotas — Feature Spec

| Field                  | Value                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| **Category**           | Engineering Spec                                                                                          |
| **Doc status**         | Active                                                                                                    |
| **Normative language** | Descriptive only                                                                                          |
| **Requirement IDs**    | Partial — App Spec §6 `SHIFT-001`–`SHIFT-013`, `SHIFT-017`–`SHIFT-022`, `SHIFT-025`, `SHIFT-026`          |
| **Owner / Updated**    | Ryan, 2026-10-01 (epic #57)                                                                                |

Camp leads run kitchen, tea bar, sound, meal and MOOP rotas in spreadsheets.
This puts them on the camp, in `apps/web` ([Decision 007](decisions/decision-007-application-boundary.md)).
Canvas frames S1–S4 (merged in #83) are the design.

## Decisions (Ryan, 27–28 Sep 2026, #57)

- **Teams** are a starter list (Kitchen, Tea bar, Sound, Meal rota, Build &
  strike, MOOP) the lead edits: add, rename, remove. Written once per camp, the
  first time a lead opens Shifts (`groups.shift_teams_seeded_at`, compare-and-set).
- **Required skill = a camp role.** Only members holding it (accepted
  assignment) can sign up, be assigned, be handed it or take it.
- **Swapping needs no approval.** The holder either hands the shift to a
  campmate (who accepts or declines), or offers it up as "needs a replacement"
  and the first eligible member takes it. The holder stays on it until it moves.
- **Open shifts show every day** of the burn, build and strike included — never
  filtered by travel plans.
- Members sign themselves up; leads can also assign.

## Model

- `shift_teams` (camp, name, sort) — unique per camp, case-insensitive.
- `shifts` (camp, edition, team?, name, `shift_date`, `start_minute`,
  `duration_minutes`, capacity 1–50, required camp role?, `signup_mode`
  `open|assign`). A repeating shift is one row per picked day. Time has no zone:
  date + minutes after midnight, as the lead typed it. All day = 00:00 + 24 h.
- `shift_assignments` (shift, membership, assigned_by?, `offered_at`?,
  `handover_to_membership_id`?) — at most one hand-on state at a time (CHECK).

Days: four build days before the edition's first day, the event, one strike
day after (`SHIFT_BUILD_DAYS` / `SHIFT_STRIKE_DAYS` in `@quagga/core`).

## Rules (`@quagga/core` `shifts.ts`, enforced server-side)

- **Who manages** (create, edit, cancel, assign, take off, teams): the
  structural lead and co-leads (`canManageShifts`). No custom-role privilege yet.
- **Who sees**: the camp's current members. Strangers, members of other camps
  and former members get the camp's 404.
- Sign-up needs `signup_mode = open`, a free spot, the role, not already on it,
  and no clash with the member's other shifts. A lead assignment ignores the
  mode; everything else applies.
- Offered spots are still held: capacity counts them.
- `signup_mode` governs only how a shift is FIRST filled. Once someone holds a
  spot — on either kind — they may hand it on or offer it up, and an offered
  spot on a lead-only shift shows in Open shifts like any other: swaps need no
  lead approval. The role and clash rules still apply to whoever takes it.
- Every write runs in one transaction. It first locks the membership row of
  each person it puts on a shift (`FOR NO KEY UPDATE`, sorted, one statement
  — so a concurrent archive waits, and one member cannot be put on two
  overlapping shifts from two tabs), then the shift row `FOR UPDATE`. A take
  and an accept are compare-and-sets, so two people taking the same spot
  resolve to one winner.
- A lead cannot shrink a shift below the people already on it.
- Archiving a member frees their spots and cancels hand-ons to them (same
  transaction). Account sanitisation does the same, and a deleted account is
  in no member list or picker. Restoring a former member (by a lead, or by
  their invite) clears anything still keyed to their membership: they come
  back on no shifts. Leaving the camp cascades.
- The shift actions answer "Camp not found." to anyone who is not a current
  member — the same answer as a slug that does not exist.

## Notifications (kind `shift`, origin `camp`, in-app only)

Sent after commit, best effort ([notifications spec](notifications-spec.md)):

- a lead puts you on a shift, or takes you off it;
- a lead moves the day or time of, or cancels, a shift you're on;
- a campmate asks to hand you their shift; they hear when you accept or decline;
- your offered shift is taken;
- the camp's leads and co-leads hear when a shift changes hands.

No email, no reminders (see below).

## Surfaces

- `/camps/[slug]` — the Shifts tile (members): open spots, count, range. A
  lead's open-spot count is every gap; a member's counts only spots on shifts
  they could sign up for.
- `/camps/[slug]/shifts` — lead overview (S1): stats, the week, team filter,
  a day's shifts with Assign and edit. Members get their own view here.
- `/camps/[slug]/shifts/mine` — the member view (S3): hand-on requests to
  you, My shifts, Open shifts.
- `/camps/[slug]/shifts/new`, `/[id]/edit` — the form (S2); edit adds who is on
  it, take off, assign, cancel the shift.
- `/camps/[slug]/shifts/[id]/hand-on` — hand on (S4), and "take me off".

## Not built

- Attendance, late cancellations, no-shows (`SHIFT-014`–`016`) — need their own
  privacy / "watching staff" review.
- Scheduled reminders and email (`SHIFT-024`, `SHIFT-027`). The canvas's
  Reminder select is deliberately absent: nothing would send it.
- WhatsApp / SMS (`SHIFT-028`, `SHIFT-029`), offline, village-wide shifts
  (`SHIFT-011`), a named shift lead (`SHIFT-006`), compulsory shifts
  (`SHIFT-009`), lead approval of swaps (`SHIFT-023`, decided against).
