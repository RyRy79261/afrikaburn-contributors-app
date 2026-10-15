# Team audiences — Feature Spec

| Field                  | Value                                         |
| ---------------------- | --------------------------------------------- |
| **Category**           | Engineering Spec                              |
| **Doc status**         | Active                                        |
| **Normative language** | Descriptive only                              |
| **Requirement IDs**    | Partial — App Spec §4a `COMM-012`, `COMM-014` |
| **Owner / Updated**    | Ryan, 2026-10-16                              |

Camp teams exist ([camp-teams-spec.md](camp-teams-spec.md)), but an
announcement or a meeting can still only go to the whole camp or to chosen
roles. The kitchen lead wants to tell the kitchen team about Monday's prep
without making "Kitchen" a role too. This adds **teams** as an audience.

## Decisions (Ryan, 15 Oct 2026)

- **Where**: camp **announcements** and camp **meetings**. Questionnaires and
  onboarding keep roles for now.
- **Team leads send to their own team** without the camp-wide
  `post_announcements` / `schedule_meetings` permission. They cannot reach the
  whole camp, roles, or other teams that way. Holders of the camp-wide
  permission (and camp leads) may pick any teams.

- Frames: A1 announcement form `knWLt` / `y2O4gf`; A2 meeting form `bIVG2` /
  `YGauR` and team page shortcuts `Yzft0` / `IyeIT`. Each form keeps its
  wording and adds one option ("By team" / "Teams"). The team page shortcuts
  show to the team's leads and the camp's leads.

## Decisions (Ryan, 16 Oct 2026)

- **Team leads may require acknowledgement of their own teams.** A team lead
  without `post_announcements` may send a "Must acknowledge" announcement when
  every chosen team is one they lead. Nothing else widens: they still cannot
  reach the whole camp, roles or other teams, and one chosen team they do not
  lead means the `mayRequireAck` grant decides.
- **Camp leads get no inbox notice for a team announcement.** It is delivered
  (inbox, must-acknowledge gate) only to the members of the chosen teams. The
  camp's leads and co-leads can still read it on the announcements page, and
  the composer's reach line says so.
- **A role-limited `post_announcements` grant reaches only the teams its
  holder leads.** Only a grant scoped to every role counts as camp-wide for
  teams.

## Model

No migration. The audience is the existing jsonb `ProjectAudience`
(`@quagga/types` `audience.ts`): `mode` gains `"teams"` and a `teamIds`
array (ignored unless `mode` is `teams`). Rows written before keep their
meaning. Questionnaire and onboarding inputs refuse `mode: "teams"` at their
boundary.

## Rules (`@quagga/core`, server-side)

- **Who is reached**: current members of any of the chosen teams (not
  archived teams; former and erased accounts never).
- **Who sees an announcement / meeting sent to teams**: the reached members,
  the camp's leads and co-leads, and the sender / scheduler — the same rule
  the role audience uses.
- **Who may send to a team**: a camp lead or co-lead; a holder of the
  camp-wide permission (any teams); a **team lead, to teams they lead only**
  (a role-limited `post_announcements` grant adds no teams). A team lead's
  reach is checked on the server against their seats at send time.
- **Who may require acknowledgement of a team**: a camp lead or co-lead; a
  holder of `post_announcements` with `mayRequireAck`; and a **team lead, when
  every chosen team is one they lead**. Checked on the server against the
  same seats, read `FOR SHARE` in the publish transaction and again when a
  scheduled send is dispatched, so a lead removed in between is refused.
- **A team deleted or archived after sending**: the announcement or meeting
  keeps its readers as resolved at read time from the stored team ids;
  an archived team still resolves to its members (its history stays visible);
  a deleted team resolves to nobody but the camp leads and the sender.
- **Editing a meeting's audience** by a team lead stays within their teams.
- Notifications and must-acknowledge gates work exactly as for roles. Only
  the reached members are notified; the camp's leads read a team
  announcement on the announcements page, without an inbox notice.

## Surfaces

- The audience picker on the announcement form and the meeting form gains a
  **Teams** option beside "Everyone" and "Chosen roles", listing the camp's
  teams (only the lead's own teams for a team lead without the permission),
  with a reach count.
- Team page: "Post to the team" and "Schedule a team meeting" shortcuts for
  its leads, opening the forms with the team pre-selected.
- The audience chip reads "Kitchen team" / "Kitchen + Build crew".

## Not built

- Teams as an audience for questionnaires and onboarding.
- Mixing roles and teams in one audience.
