# Camp meetings and calendar — Feature Spec

| Field                  | Value                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| **Category**           | Engineering Spec                                                                           |
| **Doc status**         | Draft — built overnight 14–15 Oct at Ryan's request; questions for Ryan at the end          |
| **Normative language** | Descriptive only                                                                           |
| **Requirement IDs**    | Partial — App Spec §4a `COMM-010`, `COMM-011`, `COMM-012` (meeting notices), `COMM-016`    |
| **Owner / Updated**    | Ryan, 2026-10-15                                                                           |

Camps plan the burn in meetings: a Sunday call in March, a kitchen-team
meeting in April, the on-site sunrise briefing. Today the invite lives in
WhatsApp, the call link in someone's calendar, and the notes in a Google Doc
nobody can find. This puts the camp's meetings on the camp, with the link,
the agenda and the notes in one place, and adds one camp calendar that shows
the dates that matter: build, the event, strike, meetings and your shifts.

Modelled on Camp 404's meeting notes (`meeting_notes`), without its Google
Calendar sync: the platform holds the meeting itself.

## Decisions (defaults taken overnight — see "Questions for Ryan")

- **Who schedules**: the structural lead and co-leads, and members holding a
  new camp privilege **`schedule_meetings`**.
- **Audience**: the whole camp, or chosen camp roles (the announcements
  audience picker). Only the audience sees the meeting, its link and notes.
- **Notes**: anyone in the audience may read; the scheduler, leads and
  `schedule_meetings` holders may write the agenda and notes (markdown, the
  shared editor). Compare-and-set on `version`, like the layout.
- **No RSVP in v1.** "Who came" is a simple attendee tick list in the notes,
  written by the note-taker, never a tracking feature.
- **Calendar** is read-only and derived: edition milestones (build window,
  event days, strike), the camp's meetings for this viewer, and the viewer's
  own shifts. No new data entry.
- **"Add to my calendar"**: a per-meeting `.ics` download. No subscribed feed
  (a feed URL is a credential; later).
- **Notifications** (kind `meeting`, in-app only): scheduled, moved, cancelled.

## Model

- `camp_meetings` (camp, edition, title, `meeting_date` (date),
  `start_minute`, `duration_minutes`, `location` text?, `video_link` (https
  only)?, `audience` (everyone | role ids, the announcements shape),
  `agenda` md, `notes` md, `version`, `cancelled_at`?, created_by, updated_by,
  timestamps). Time has no zone: date + minutes after midnight, as typed, like
  shifts.
- `camp_meeting_attendees` (meeting, user) — the note-taker's tick list.

## Rules (`@quagga/core` `camp-meetings.ts`, server-side)

- Non-members get the camp's 404; members outside the audience get the
  meeting's 404 (the same answer as a meeting that does not exist).
- `video_link` must be `https://`; it renders as a plain external link with
  `rel="noopener noreferrer"`. No embedding.
- A cancelled meeting stays readable (with its notes) and drops off "upcoming".
- Moving or cancelling notifies the audience; editing notes does not.
- Former members: no access. Account erasure removes their attendee rows and
  leaves the notes' text (authored text is the camp's record; their name is
  shown as "Deleted account").

## Surfaces

- `/camps/[slug]/meetings` — upcoming and past meetings; "Schedule meeting".
- `/camps/[slug]/meetings/new`, `/[id]`, `/[id]/edit` — the form; the meeting
  page with time, place, "Join call", agenda, notes, attendees, `.ics`.
- `/camps/[slug]/calendar` — month view on desktop, agenda list at 360.
- Camp page: a "Next meeting" line in the camp tiles.

## Not built

- Calling via WhatsApp (`COMM-009`): phone numbers are hard-locked.
- Group formation around shifts / functions / friends (`COMM-013`–`015`):
  needs its own spec (groups are close to villages and DMs).
- Calendar sync with Google/Outlook, subscribed feeds, reminders by email.
- Decisions and action items as structured rows (Camp 404 has them; later).
- Village meetings (`COMM-020`): no villages yet.

## Questions for Ryan

Listed in `quagga-board/drafts/morning-questions-2.md`.
