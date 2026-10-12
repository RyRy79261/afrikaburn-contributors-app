# Work Access Passes — Feature Spec

| Field                  | Value                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| **Category**           | Engineering Spec                                                                         |
| **Doc status**         | Draft — for review before build                                                          |
| **Normative language** | Descriptive only                                                                         |
| **Requirement IDs**    | Partial — App Spec §9 `WAP-001`, `WAP-003`–`WAP-009`, `WAP-011`, `WAP-012`, `WAP-014`, `WAP-015` |
| **Owner / Updated**    | Ryan, 2026-10-12 (epic #53)                                                              |

A Work Access Pass (WAP) lets a person onto the site before the event opens,
to build, or after it closes, to strike. AfrikaBurn grants a project a number
of passes; the project's lead names who gets them. Today the platform stores
only the number the project asked for (`registrations.s4_work_access_passes`),
and leads track the names in spreadsheets.

## Decisions (Ryan, 12 Oct 2026, #53)

- **Every project type**: theme camps, artworks and mutant vehicles. All three
  already request a count on the same `registrations` row (#52).
- **The org approves the whole list at once**, not each name. The lead submits
  the list; the org approves it or returns it with a note.
- **A person on two lists is shown, not blocked.** A project gets a collection
  of passes to hand out; the lead sees that a person already holds one and
  **which project it is from**, and decides.
- **That project is always named, a free camp included.** This is a
  deliberate, narrow exception to "free camps are undiscoverable to strangers"
  (AGENTS.md). It is shown only to the managers of another project that holds
  the same person, only next to that person, and only the project's name.
- **Dates and build/strike come from the roster plans** the member already set
  (`membership_logistics`, #55). No new form. The lead may override them on the
  pass.

## Model

- `registrations.wap_granted` (int, nullable) — set by the org. Null = not
  decided yet. Separate from `s4_work_access_passes` (what was asked for).
  Not carried forward (same rule as the request).
- `registrations.wap_list_status` — `draft | submitted | approved | returned`,
  default `draft`; with `wap_list_submitted_at`, `wap_list_reviewed_at`,
  `wap_list_reviewed_by`, `wap_list_return_note`.
- `wap_allocations` (registration, membership, `allocated_by`, created) —
  unique per (registration, membership). Optional overrides:
  `arrival_date`, `departure_date`, `build`, `strike` (null = use the roster
  plan). Cascades with the membership and the registration.

Arrival on the pass = the override, else the member's roster arrival, else the
registration's `s4_first_arrival_date` (fewer forms: a sensible default, never
an empty cell).

## Rules (`@quagga/core` `work-access-passes.ts`, enforced server-side)

- **Who allocates**: the project's structural lead and co-leads
  (`canManageWorkAccessPasses`). No custom-role privilege yet.
- **Who is eligible**: current members of the project (former members are not).
- **Cap**: allocations ≤ `wap_granted`. Allocation needs a granted number.
  Checked inside a transaction that locks the registration row, so two tabs
  cannot overshoot.
- **Editing**: allowed in `draft` and `returned`. A `submitted` list is locked
  until the org acts. Editing an `approved` list moves it back to `draft`; the
  lead must submit again, and the org sees what changed since approval.
- **Lowering `wap_granted`** below the allocations already made is refused;
  the org returns the list instead.
- **Incomplete** (WAP-007, WAP-015): a pass holder is flagged when their bio is
  incomplete (`isBioComplete`) or a sent onboarding is unfinished. A flag, not
  a block.
- **Same person, other project**: shown as "Also has a pass from {project}".
  The same note shows to the org reviewer.
- **Archiving or removing a member** deletes their allocation. An approved list
  that loses a name stays approved; the org view shows "1 removed since
  approval".
- **Members** see their own pass on the project page: "You have a Work Access
  Pass", with its status (draft lists show nothing).

## Org (`apps/org`, domain `registrations`)

- Registration review gets a **Work Access Passes** panel: requested, granted
  (editable with `update`), list status, the names with arrival, departure,
  build and strike, flags, and Approve / Return with a note.
- `/registrations/passes` — all projects for the edition: requested, granted,
  allocated, list status; filter by status and project type; **Export CSV**
  (WAP-009).
- Names need `read`. The export needs `personal_information` because it holds
  email. It never holds a hard-locked field (phone, emergency contacts, ID).

## Notifications (kind `wap`, in-app only)

- Leads and co-leads: passes granted or changed; list approved; list returned
  (with the note).
- Pass holders: when their project's list is approved.
- No email until Resend exists.

## Surfaces

- `/camps/[slug]/passes`, `/artworks/[slug]/passes`, `/vehicles/[slug]/passes`
  — the lead's page (frame W1): "7 of 10 allocated", the member list with
  dates, build/strike and flags, add/remove, Submit to AfrikaBurn.
- The project page — a Passes tile for leads; the member's own pass line.
- Org review panel (W2) and the passes overview with export (W3).

## Not built

- **Categories** (`WAP-002`): build and strike are the categories for now.
  Add real categories when AfrikaBurn says what they are.
- **Sending the list to AfrikaBurn's systems** (`WAP-010`): the CSV is the
  hand-off until AfrikaBurn says what it can ingest.
- **Functional roles** (`WAP-013`) on the pass: the roster already shows roles.
- **Ticket status** (`WAP-016`): ticketing stays with Quicket.
- **Camp-fee status** (`WAP-017`): out under the money law.
