# Camp statistics — Feature Spec

| Field                  | Value                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| **Category**           | Engineering Spec                                                                              |
| **Doc status**         | Active                                                                                        |
| **Normative language** | Descriptive only                                                                              |
| **Requirement IDs**    | Partial — App Spec §5 `STATS-001`–`STATS-003`, `STATS-005`–`STATS-007`, `STATS-011`, `STATS-013`–`STATS-015`, `STATS-017`–`STATS-019`, `STATS-022`–`STATS-027`, `STATS-030`, `STATS-031` |
| **Owner / Updated**    | Ryan, 2026-10-13                                                                              |

Camp leads count their people in spreadsheets: how many are coming, who has
done onboarding, which shifts are empty, how many passes are left. The
platform already holds all of it. This puts it on one page, and gives each
member a short participation summary. Nothing here is asked: every number is
derived (fewer forms).

## Decisions (Ryan, 13 Oct 2026)

- **A new Stats page** per project: `/camps/[slug]/stats`. The roster keeps
  its small stats card and links to the page.
- **Who sees it: roster viewers** — the structural lead and co-leads, and any
  member holding `view_member_details`. Everyone else gets the camp's 404.
- **Per-person statistics**: a participation summary on a member's profile
  (`/burners/[id]`, where the roster's rows link), for roster viewers;
  **every member sees their own** on the camp page.

## The camp page (`/camps/[slug]/stats`, current edition)

Each figure links to the list behind it where one exists (roster filter,
shifts day, passes page).

- **People** (`STATS-017`–`019`): current members; new to the camp vs returning
  (`classifyCampTenure`, camp-held records only); first burn ever; former
  members (archived) shown apart, never counted as current.
- **Onboarding** (`STATS-022`, `023`): of the members a sent onboarding
  targets — completed, in progress, not started. Hidden when nothing was sent.
- **Bios** — complete / incomplete (`isBioComplete`).
- **Build and strike** (`STATS-024`, `025`): joining build, joining strike,
  arrival not set yet (roster plans). Per-day arrivals as a small bar chart.
- **Shifts** (`STATS-026`, `027`): spots filled / open, by team; shifts with an
  open spot in the next 7 days. Hidden when the camp has no shifts.
- **Work Access Passes** (`STATS-030`, `031`): granted, allocated, left, list
  status. Hidden when the project has asked for none.

## Per person (participation summary)

On a member's profile, `/burners/[id]` (roster viewers: one block per theme
camp the viewer can see the roster of and the member currently belongs to),
and on the camp page for the member themself ("Your participation"):

- Burns attended (`STATS-001`) — from the bio, and only if the roster already
  shows it to this viewer; the member's own field privacy is never widened.
- With the camp since (`STATS-002`) — the edition year their membership began.
- Shifts held this edition, and held in past editions (`STATS-003`, `007`): a
  spot held on a shift whose day has passed. This is "held", not "worked" —
  there is no attendance record (see Not built).
- Build / strike this edition (`STATS-005`, `006`), from their roster plan.
- Onboarding: done / in progress / not started (`STATS-011`).
- Roles held now (`STATS-014`) and skills from the bio (`STATS-015`, same
  privacy rule as burns attended).
- Work Access Pass this edition and earlier ones (`STATS-013`).

## Rules (`@quagga/core` `camp-stats.ts`, enforced server-side)

- **Access** is `canViewCampRoster` (the roster's own predicate). One predicate, so
  the page can never show more people than the roster does.
- **Aggregates only on the camp page**: counts, never names, except where a
  figure links to a page the viewer may already open.
- **No new data, no new privacy class**: every figure is computed from tables
  that exist. Medical, phone, emergency contacts and ID are never read.
- Former members count only in "former"; deleted (sanitised) accounts in
  nothing.
- Every figure is for the **current edition** unless it says otherwise.
- Pure derivation in core with unit tests; the store reads the rows in a few
  queries (no per-member query loop).

## Surfaces

- `/camps/[slug]/stats` (frame C1, desktop + 360) — the camp page.
- Roster: the stats card gets "All statistics →".
- Profile `/burners/[id]`: the participation summary, one block per shared
  camp, for roster viewers only (frame C2).
- Camp page: "Your participation" card for the member themself (frame C3).
- Artworks and vehicles: not in this epic (their members have no shifts or
  onboarding yet).

## Not built

- **Shifts missed** (`STATS-004`) — needs attendance, which needs its own
  privacy / "watching staff" review (shifts spec).
- **Fees paid / outstanding, paid campers** (`STATS-009`, `010`, `020`, `021`)
  — there are no dues records yet.
- **Tickets** (`STATS-012`, `028`, `029`) — ticketing stays with Quicket.
- **External AfrikaBurn volunteering, training** (`STATS-008`, `016`) — the
  platform holds no such record.
- Exports and history charts across editions.
