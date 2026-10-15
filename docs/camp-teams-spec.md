# Camp teams and team chat — Feature Spec

| Field                  | Value                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| **Category**           | Engineering Spec                                                                  |
| **Doc status**         | Active                                                                            |
| **Normative language** | Descriptive only                                                                  |
| **Requirement IDs**    | Partial — App Spec §4a `COMM-008`, `COMM-012`, `COMM-013`, `COMM-014`, `COMM-016` |
| **Owner / Updated**    | Ryan, 2026-10-15                                                                  |

A camp runs on teams — kitchen, build crew, sound, MOOP — and each team runs on
a WhatsApp group that someone has to admin, that holds everyone's phone number,
and that outlives the burn. This gives each team a page and a chat inside the
platform, with the same privacy rules as direct messages.

Modelled on Camp 404's teams (a team page per team: description, leads,
members, upcoming meetings and notes). Unlike Camp 404, which sends members to
a Telegram group, the chat is in the app.

## Decisions (Ryan, 15 Oct 2026)

- **In-app group chat**, built on the existing direct messages (epic #69):
  same reporting, disappearing timer, no phone numbers.
- **Camp teams only.** Teams are the camp's own, created by leads. The shift
  teams that already exist (Kitchen, Tea bar, …) ARE these teams — one list.
  Member-made friend groups (`COMM-015`) are not in this build.
- **Joining**: members tap **Join** on an open team; camp leads and team leads
  add and remove anyone; a team can be set to **leads add only**.
- **Team leads**: each team can have team leads. A team lead edits the team
  page, adds and removes members, and sets the team chat's timer — for their
  team only. Camp leads and co-leads can do everything on every team.
- **Camp leads read a team chat only if they join the team** (the
  direct-message law: only a chat's members read it).
- **New members see messages from when they joined**, not the history.
- **Removing someone from a team keeps their shifts** (shifts are separate
  sign-ups; a lead takes them off shifts as today).
- Frames: T1 teams list `Zam6P` / `mcghm`, T2 team page `z53vuX` / `lexRq`,
  T3 team chat `qsuL0` / `fyZFW`, T4 inbox `p17kP` / `DwjfT`. A Teams tile on
  the camp page and the shifts "Edit teams" link are built without a frame.

## Model

- `shift_teams` gains `description` (markdown, optional), `join_mode`
  `open | leads_add`, `archived_at`. It stays the one team list; shifts keep
  their `team_id`. (The table keeps its name — a rename is a migration risk
  for no user benefit.)
- `team_members` (team, user, `is_lead`, `added_by`, timestamps) — unique per
  (team, user). Only current camp members; leaving or being archived from the
  camp removes the row.
- `conversations` gains `kind` `direct | team` and `team_id` (unique where
  set). A team's chat is created with the team. `pair_key` is null for team
  chats (unique only where set).
- `conversation_participants` rows for a team chat follow `team_members`
  (added on join, removed on leave) in the same transaction, so the existing
  inbox, unread count and "only participants read" rule work unchanged.

## Rules (`@quagga/core`, server-side)

- **Who sees a team**: every current camp member sees the camp's team list and
  each team page (description, leads, members). Strangers get the camp's 404.
- **Who reads a team chat**: ONLY its current members — the direct-message law
  stands: there is no camp-lead, org or god path to `messages`. A camp lead
  who wants to read a team chat joins the team (visible to everyone in it).
- **Leaving** a team removes you from its chat; you keep nothing of it. New
  members see messages sent after they joined only (`joined_at` filter), so
  joining does not open old conversations.
- **Blocking**: a block between two people hides each one's messages from the
  other in shared team chats; neither is removed from the team.
- **Reporting** works as in direct messages: the reported messages are copied
  to the org safety queue, nothing else. The queue row and the report page
  also say where it came from — "{camp name} · {team name} team chat" (Ryan,
  15 Oct 2026). Those two names are a snapshot taken when the report is made
  (`message_reports.source_camp_name` / `source_team_name`, migration 0041),
  so a later rename, archive or deletion of the team does not change or lose
  it; nothing else about the chat is shown. Direct-message reports show as
  before, with no source line.
- **Timer**: team leads and camp leads set the team chat's disappearing timer
  (off / 24 h / 7 d / 90 d), shown in the chat.
- **Mentions, files, reactions**: not in this build.
- **Read gate, twice**: reading needs a chat participant row AND a current
  `team_members` row with an active camp membership — a stale row of either
  kind alone opens nothing. The 1:1 message paths refuse a team chat's id.
- **Archived teams**: off the list except for camp leads and people still on
  them; the chat stays readable for its members and is read-only. Team leads
  lose their rights on an archived team; camp leads keep theirs.
- **Timer and appointing leads**: a camp lead must be on the team to set the
  timer (no write path into a chat they cannot read). Team leads and camp
  leads appoint a team's leads from people already on it.
- **Reports** from a team chat name as the reported person whoever sent most
  of the selected messages (the queue shows every copy with its sender).
- Former members and erased accounts: removed from every team and chat (the
  existing sanitiser deletes their messages).

## Notifications (in-app)

- The existing message unread badge and inbox include team chats.
- "You were added to {team}" when a lead adds you.
- No per-message notification beyond the unread count (as for DMs).

## Surfaces

- `/camps/[slug]/teams` — the camp's teams: name, lead(s), member count, Join /
  Joined, open or leads-add.
- `/camps/[slug]/teams/[id]` — the team page: description, leads, members,
  Join / Leave, the team's upcoming shifts, a "Team chat" button; edit controls
  for team leads and camp leads.
- `/messages` — the inbox lists team chats beside direct messages; a team chat
  shows sender names and the team name.
- The shifts team editor links to the team pages (one list). Its old add /
  rename / remove dialog is gone: the remove was a hard delete that took the
  team's chat with it, where the team pages archive instead.
- The team chat opens at `/messages/[id]` (the chat's conversation id), the
  same route as a direct chat; the page serves it only through the team-chat
  gate, and the team page's "Team chat" button is shown only to its members.
- The camp page has a Teams tile (members only): how many teams, how many the
  member is on.

## Not built

- Member-made friend groups (`COMM-015`) and village-wide groups (`COMM-020`).
- Team announcements and team-only meetings (announcements and meetings keep
  their role audiences; a team audience can come later).
- Mentions, attachments, reactions, message editing, read receipts.
- Team budgets (Camp 404 has them; the camp budget covers this for now).
