# Technical Specification — Quagga Portal

| Field | Value |
|---|---|
| **Category** | Product |
| **Doc status** | Active |
| **Normative language** | Descriptive only — this document reports build status; it does not itself impose requirements |
| **Requirement IDs** | Exhaustive — full 1:1 section mirror of the App Specification. Every section below cites the `PREFIX-NNN` IDs it addresses |
| **Owner / Updated** | Repo maintainers, 2026-08-05 |

Companion to the **[App Specification](https://docs.superhuman.com/d/AB-Theme-Camp-Development_dQ_I7n93cZT/App-Specification_suoUXVqN#_lue9jm34)**
— the authoritative, Requirement-ID-tagged source of truth for what the product
should do (see [`docs/README.md`](README.md) for the full precedence chain).
That document says what the product should do; this one says what is built,
how, and what each unbuilt part would actually take. Section numbers match the
App Spec so the two can be read side by side, and each section below cites the
specific `PREFIX-NNN` Requirement IDs it addresses, grouped by this doc's own
status legend — see [`docs/README.md`](README.md#technical-language-guide) for
the citation format and the protocol for keeping these current when the App
Spec changes.

Written to be commented on by non-technical readers. Where a term is unavoidable
it is explained once.

| Label            | Meaning here                                     |
| ---------------- | ------------------------------------------------ |
| ✅ **Built**     | Working in the deployed apps, with tests         |
| 🚧 **Partial**   | Some of it works; the rest is named below        |
| ❌ **Not built** | No code, no database tables                      |
| ⚠️ **Blocked**   | Cannot be built yet, and the blocker is not code |

**Three facts that shape every answer below.**

1. **It is live.** Real people's phone numbers, emergency contacts and medical
   notes are in the database. There is no practice copy — a change to how data
   is stored runs against production the next time we deploy, and cannot be
   edited afterwards, only corrected by another change.
2. **Three apps, one account pool.** Participants, AfrikaBurn staff and
   suppliers each get their own app; one sign-in identity spans all three.
3. **Rules live in one place.** Who may see what is decided by shared code
   (`@quagga/core`) that all three apps call, not by hiding buttons. A hidden
   control and a refused action can never disagree.

Diagrams: [`architecture.md`](architecture.md) (how the system fits together),
[`flows.md`](flows.md) (the journeys).

---

## 1. Product purpose 🚧

**Requirement IDs:** 🚧 PURPOSE-001, PURPOSE-002 *(App Spec §1 — the only two tagged bullets in this section; the rest of §1 is narrative)*

Built: identity, camps and rosters, the annual registration and its review loop,
questionnaires, bulletins and notifications, the supplier repository, an audit
trail, and an in-app bug reporter.

Not built: the camp-operations modules — shifts, budgets, tickets, layout.

The distinction matters technically: what exists is the **spine** (identity,
membership, permissions, submission-and-review, audit). The unbuilt modules are
mostly **leaves** that hang off that spine. That is the cheap direction to have
built things in — a shift system on top of an existing roster and permission
model is ordinary work; the reverse would not have been.

## 2. Core modules — technical state 🚧

**Requirement IDs:** ✅ CORE-009 · 🚧 CORE-001, CORE-005, CORE-010 · ❌ CORE-003, CORE-004, CORE-007, CORE-011 · ⚠️ CORE-002, CORE-006, CORE-008 *(App Spec §2 — one CORE-NNN id per row below, in order)*

| Module                                | State | What it rests on                                                                                       |
| ------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| Camper onboarding                     | 🚧    | Platform onboarding built; camp-authored content needs the questionnaire engine pointing at camps (§3) |
| Camper database / camp list           | ⚠️    | Built as self-owned profiles, not admin-managed records — a real difference, see §4                    |
| Shift management                      | ❌    | Needs new tables; nothing exists                                                                       |
| Budget and financial tracking         | ❌    | Needs new tables; one number exists today (`s6ExpectedBudgetZar`)                                      |
| Work Access Pass allocation           | 🚧    | A requested count is captured; per-person allocation needs new tables                                  |
| Ticket allocation                     | ⚠️    | Nothing built; Quicket is the system of record (§10)                                                   |
| Tent placement under Bedouin tents    | ❌    | Depends on the layout tool (§11)                                                                       |
| Placement and layout design           | ⚠️    | Preferences and file uploads only; blocked on map data (§11–13)                                        |
| Annual registration and submission    | ✅    | Built, including the review loop                                                                       |
| Previous-year records and duplication | 🚧    | Records are kept per year; copying forward is not built                                                |
| Camp reporting and statistics         | ❌    | Needs the modules above to have data to report on                                                      |

## 3. Camper onboarding 🚧

**Requirement IDs:** 🚧 ONBOARD-004, ONBOARD-005, ONBOARD-010, ONBOARD-014, ONBOARD-015, ONBOARD-018–ONBOARD-021 (the questionnaire engine already supports this shape; camp-lead authorship of onboarding content specifically is not yet wired) · ❌ ONBOARD-001–ONBOARD-003, ONBOARD-006–ONBOARD-009, ONBOARD-011–ONBOARD-013, ONBOARD-016, ONBOARD-017, ONBOARD-022–ONBOARD-028 *(App Spec §3)*

**Built:** every burner completes a **Burner Bio** when they join the platform,
and it can be made a hard gate — the app refuses to show anything else until it
is done.

**Not built:** camps authoring their own onboarding — culture, rules, build and
strike duties, acknowledgements.

**What it would take: less than it looks.** The questionnaire engine that
already runs the Burner Bio is generic: AfrikaBurn staff build a questionnaire
in the console, choose who gets it, and mark it blocking or not — no developer
involved, no deploy. Camp-authored onboarding is that same engine with the
author changed from "AfrikaBurn" to "a camp lead", plus per-camp visibility
rules and completion tracking on the roster.

The listed content types split cleanly: written information, acknowledgements
and required steps are questions the engine already supports. **Videos and
uploaded documents are the new part** — file storage exists (layout uploads use
it) but nothing serves camp-authored media yet.

"Returning campers skip unchanged material" is a design decision with a cost:
it means versioning onboarding content per year and remembering what each person
already agreed to. Worth stating so it is chosen deliberately rather than
discovered late.

## 4. Camper database and camp list ⚠️

**Requirement IDs:** ✅ CDB-027, CDB-031, CDB-032, CDB-037, CDB-038, CDB-040, CDB-043 · 🚧 CDB-042 · ❌ CDB-025, CDB-026, CDB-028, CDB-029, CDB-030, CDB-034, CDB-035, CDB-036 · ⚠️ CDB-001–CDB-024 (captured via self-owned Burner Bio, not admin-managed records — see below) *(App Spec §4; CDB-039 "masked ID/passport numbers" not individually assessed — encryption exists, a distinct masked-display treatment is not confirmed)*

**This is the section where the build and the spec genuinely differ, and the
difference is not an oversight.**

The App Spec describes camp administrators creating and editing camper records,
including full name, ID or passport number, and contact details.

What is built is the inverse: **each burner owns their own profile**, and camps
see a roster of people who joined them. Camps invite; people fill in their own
details.

The technical reason is the privacy model, which is enforced in code rather than
policy:

- **Hard-locked fields** — ID and passport numbers, phone, emergency contacts —
  can never be made public by anyone, including the person themselves. The code
  refuses.
- **Medical notes** are a stricter class again: never public, visible only to
  that person's own camp leads and AfrikaBurn safety staff, on a single detail
  screen, and **every read is recorded**.
- ID, passport and medical are **encrypted in the database**, and medical is
  discarded rather than stored if the encryption key is missing.
- A deleted account leaves none of it behind.

Admin-managed records would mean camp administrators typing other people's ID
numbers into a system those people cannot see or correct. That is a different
consent position under POPIA, and it is the one place where doing what the spec
says would require unpicking a control the current design leans on.

**Built today:** invite people, roster, roles, search, member detail, audited
medical access, POPIA-grade retention and deletion.
**Not built:** spreadsheet import/export, duplicate detection, carry-forward
between years, archiving, admin-only notes.

Import/export is ordinary work. **Bulk import is the one to think about**: a
spreadsheet of other people's ID numbers is exactly the shape of data the rest
of the model is arranged to avoid.

## 5. Camper statistics ❌

**Requirement IDs:** ❌ STATS-001–STATS-031 *(App Spec §5 — nothing built; statistics depend on modules in §6–§10 that don't yet exist)*

Nothing built. Not hard — it is counting — but it counts things that do not
exist yet: shifts, fees, tickets, passes. Realistically it follows §6–§10 rather
than leading them.

The App Spec's own caution ("should not become a public scoring system") is
straightforward to honour technically: these numbers would live behind the same
per-camp permission check as the roster.

## 6. Shift management ❌

**Requirement IDs:** ❌ SHIFT-001–SHIFT-029 *(App Spec §6 — nothing built)*

Nothing exists — no shifts, no sign-ups, no attendance.

**What it would take:** new tables for shifts, assignments and attendance; a
sign-up and swap flow with approval; and reminders. The permission model and the
roster it needs are already there.

Two technical notes for planning:

- **Swaps are the awkward part.** "Nobody may drop a shift until a qualified
  replacement accepts it" is a rule with a race condition in it — two people
  accepting the same swap at once. Solvable, but it is the piece to specify
  carefully rather than the calendar.
- **WhatsApp and SMS are not free or instant.** In-app and email reminders use
  what we already run. WhatsApp needs a Business API provider, approved message
  templates and consent records; SMS costs money per message. Both are
  integrations with their own approval timelines, not settings.

## 7. Working budget ❌

**Requirement IDs:** 🚧 BUDGET-001 (one number captured — the expected budget declared at registration) · ❌ BUDGET-002–BUDGET-062 *(App Spec §7 — everything beyond that one field is unbuilt)*

One number exists today: the expected budget a camp declares at registration
(`s6ExpectedBudgetZar`). Everything else in this section is unbuilt.

**What it would take:** a budget structure (categories, line items, proposed vs
approved vs actual), which is a well-understood shape. The requirements raised
in discussion — invoice scanning, real-time spend tracking, reimbursements,
NPC/PBO-grade bookkeeping — are each a step up in difficulty:

| Ask                                      | Technical reality                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| Categories, proposed vs actual, variance | Ordinary. New tables and screens.                                                 |
| Cost-per-camper, live recalculation      | Ordinary, once roster and budget are linked.                                      |
| Reimbursement requests                   | Needs an approval workflow and an audit trail — both patterns we already have.    |
| Invoice scanning                         | Document storage plus text extraction. A real feature on its own, not a checkbox. |
| Bookkeeping to NPC/PBO standard          | This is accounting software. Strongly consider integrating rather than building.  |

**Keeping the approved budget intact while actuals change** is a specific
requirement and a good one: it means versioning, not editing in place.

## 8. Camp fees and payment gateway ⚠️

**Requirement IDs:** ❌ PAY-001–PAY-021 *(App Spec §8 — the platform deliberately never runs a payment gateway; what IS built — recording payment references/status/reconciliation manually — is a standing alternative to this section's gateway model, not a partial implementation of it)*

**Built:** payments are _recorded_ — a reference, an amount, a status
(pending / reconciled / waived), and who recorded it. Staff reconcile EFT and
cash manually.

**Deliberately not built:** the platform never takes custody of money. There is
no gateway, no card handling, no payouts.

This is a standing decision, not an omission, and it has real consequences worth
weighing openly:

- Handling camp dues would make the platform a payment processor between
  campers and camps. That brings PCI obligations, chargeback disputes, refund
  handling, and — the sharpest one — **holding other people's money in an
  account somebody has to own and account for**.
- Recording references keeps the platform's role factual: it says what was paid
  and what is outstanding, and never moves funds.

If AfrikaBurn does want a gateway, the technically sane scope is **AfrikaBurn's
own fees**, not camp dues, on a South African provider supporting international
cards. Camp dues between a camp and its members are a different relationship.

## 9. Work Access Pass allocation 🚧

**Requirement IDs:** 🚧 WAP-001 (requested count captured at registration; not yet a "granted" allocation) · ❌ WAP-002–WAP-017 *(App Spec §9 — named-person allocation, categories, and eligibility rules are all unbuilt)*

**Built:** a camp states how many passes it needs at registration
(`s4WorkAccessPasses`), and AfrikaBurn sees that number when reviewing.

**Not built:** allocating passes to named people, categories, arrival and
departure dates, approval state, export.

**What it would take:** an allocation table linking a person to a pass, plus the
eligibility rules listed in the App Spec (build team, strike team, onboarding
complete, fees paid). Those rules are the interesting part — most reference
things that do not exist yet (§3, §6, §7). Ordinary work, correctly ordered
after them.

Submitting allocations to AfrikaBurn's ticketing or access system depends on
whether such an interface exists to submit to. Unknown, and worth asking early.

## 10. Ticket allocation ⚠️

**Requirement IDs:** ❌ TICKET-001–TICKET-017 *(App Spec §10 — nothing built; Quicket remains the system of record by design)*

Nothing built. The codebase assumes **Quicket remains the system of record** and
the platform only ever notes status, never issues a ticket.

**The technical question to settle before any work starts is what Quicket
allows.** Whether a camp allocation can be represented there, whether we can
read ticket status per person, and whether names can be submitted, are questions
about their integration surface, not ours. Building camp-side allocation without
that answer risks a parallel record of who has a ticket that quietly disagrees
with the real one — worse than no feature.

## 11. Theme-camp layout tool ⚠️

**Requirement IDs:** ⚠️ LAYOUT-001–LAYOUT-043 *(App Spec §11 — blocked on missing scaled map/erf data, not on code; registration instead accepts layout-diagram uploads and text placement preferences, outside this section's object-list model)*

**Built:** camps upload a layout diagram at registration (up to four files) and
state first and second placement preferences and neighbour requests.

**Not built:** the interactive scaled layout tool.

**Blocked, and not on code.** A scaled tool needs to know real dimensions — of
erven, roads, frontages. That data does not exist in any structured form; the
official map is a PDF. Until there is data with actual measurements, a layout
tool would let camps place objects to a false scale, which is worse than a
photograph of a sketch.

The object library in the App Spec (tents, containers, generators, water tanks,
each with clearance and safety areas) is buildable and largely a data-entry
exercise. It is the **canvas underneath it** that is blocked.

## 12. Private tent placement under Bedouin tents ❌

**Requirement IDs:** ❌ TENT-001–TENT-034 *(App Spec §12 — depends entirely on the layout tool in §11, which is blocked)*

Depends entirely on §11. The described rules — pole positions, rigging exclusion
zones, emergency walkways, overlap warnings, automatic arrangement — are a
constraint-solving problem, and a genuinely interesting one, but they need the
scaled canvas first.

Worth noting for planning: "automatically arrange tents fairly" is meaningfully
harder than "warn when tents overlap". The warnings are worth having on their
own and could ship long before the optimiser.

## 13. AfrikaBurn map and erf placement ⚠️

**Requirement IDs:** 🚧 ERF-019–ERF-023 (the approve/reject/comment/revise loop already exists as the registration review mechanism, §14, and is reusable here once map data exists) · ⚠️ ERF-001–ERF-018 *(App Spec §13 — blocked on the same missing map/erf data as §11)*

Blocked on the same missing data as §11, plus a second dependency: this section
assumes AfrikaBurn allocates erven in a system we can read and write.

The **back-and-forth workflow** it describes — a wrangler proposes a layout, the
camp approves, rejects, comments or revises — is not new. That is precisely the
registration review loop that already works (§14), applied to a different
artifact. When map data exists, that pattern is reusable rather than rebuilt.

## 14. Annual registration and placement submission ✅

**Requirement IDs:** ✅ REG-001, REG-002, REG-004, REG-005, REG-007, REG-011, REG-012, REG-014, REG-018, REG-021, REG-022–REG-028 · 🚧 REG-006, REG-013, REG-015, REG-020 · ❌ REG-003, REG-008, REG-009, REG-010, REG-016, REG-017, REG-019, REG-029, REG-030 *(App Spec §14 — the review-loop states REG-022–028 are fully built; REG-029/030 placement-allocation states are not, since placement itself is blocked per §11/§13)*

Built, and the most complete part of the platform.

**One design decision is worth explaining, because it is not obvious and it
shaped the build.** AfrikaBurn's real process is two forms at different times of
year: the September application, and a January form asking size, placement,
sound and the mandatory layout diagram.

So the platform splits them. **Only the September sections gate submission.**
Requiring a camp to declare its January answers in September is not a stricter
form — it is an unanswerable one, and it would have blocked the whole
registration season.

The January form ships as a **questionnaire AfrikaBurn authors and releases
itself**, with no developer and no deploy. Its answers land in the same place the
wizard writes, so everything downstream reads one record and cannot tell which
form an answer came from.

The submission tracks: draft → submitted → under review → changes requested →
resubmitted → approved or declined, plus withdrawal and reopening. Reopening a
withdrawn registration returns a **draft, never the approval** — an approval
restored without re-review would hand back a placement nobody looked at.
Feedback is per-section and two-way, and every decision is audited.

Not built, because they depend on unbuilt modules: camper list, budget, build
and strike plans, WAP and ticket requirements as structured submission artifacts.

## 15. Previous-year submissions 🚧

**Requirement IDs:** ✅ PREVYR-011 (edition-scoped storage keeps every year intact) · 🚧 PREVYR-001, PREVYR-012 · ❌ PREVYR-002–PREVYR-010, PREVYR-013–PREVYR-025 *(App Spec §15 — nothing forward-carrying exists yet, only the underlying per-edition storage a carry-forward feature would build on)*

**Built:** everything is stored per edition, so previous years exist and are
intact.

**Not built:** duplicating last year's submission, carrying data forward,
comparing years, flagging what needs re-confirming.

**What it would take:** ordinary work, with one rule worth agreeing up front —
**what must never carry forward**. Safety certificates, insurance and fire or
gas documentation should expire by default rather than silently reappear as
current. Carrying a stale certificate forward is the kind of convenience that
becomes an incident.

## 16. Plug-and-play and turnkey prevention 🚧

**Requirement IDs:** ✅ PNP-003, PNP-005, PNP-006, PNP-007 · 🚧 PNP-002, PNP-016–PNP-028, PNP-029–PNP-038, PNP-039, PNP-049 · ❌ PNP-001, PNP-004, PNP-008–PNP-015, PNP-040–PNP-048 *(App Spec §16 — baseline declarations are built; automatic disclosure triggers and the risk-indicator dashboard are not)*

**Built:** the baseline declarations. Every camp states its fee structure,
whether it pays performers, its suppliers, its expected budget, and explicitly
acknowledges the plug-and-play policy (`s6PlugAndPlayAck`). There is a supplier
repository, and camps declare which suppliers they use.

**Not built:** automatic triggers on the thresholds (more than 20 participants,
more than R100,000 collected), and the risk-indicator dashboard.

**What it would take:** the thresholds are checks against numbers we already
collect, so the trigger itself is easy. The harder question is what a trigger
_does_ — flag for review, require more disclosure, or block submission — and
that is a policy decision that should be made before it is coded, because each
answer is a different feature.

The App Spec's requirement that the dashboard show risk indicators "without
automatically exposing unnecessary personal or financial information" is already
how the console works: staff see personal information only where their
department's remit covers it, and the check happens in the database query, not
in what the screen chooses to draw.

## 17. Village functionality ❌

**Requirement IDs:** ❌ VILLAGE-001–VILLAGE-015 *(App Spec §17 — nothing built; the `groups` schema's group-containing-groups shape is structural readiness, not an implemented requirement)*

Not built. One structural piece is: the platform already models camps, art
projects and mutant vehicles as the same kind of thing with different types, so
a Village is a group containing groups rather than a new concept.

Everything else — shared rosters, shifts, budgets, announcements, cross-camp
reporting — depends on those modules existing first.

The sharing rule the App Spec states ("each camp controls what it shares") is the
part to design carefully. Sharing consent between organisations is a permission
model in its own right, not a checkbox.

## 18. Creative Project Mode 🚧

**Requirement IDs:** ✅ CREATIVE-001, CREATIVE-002, CREATIVE-009, CREATIVE-018 · 🚧 CREATIVE-005, CREATIVE-007, CREATIVE-014, CREATIVE-017 · ❌ CREATIVE-003, CREATIVE-004, CREATIVE-006, CREATIVE-010, CREATIVE-012, CREATIVE-013, CREATIVE-015, CREATIVE-019 · ⚠️ CREATIVE-008, CREATIVE-011, CREATIVE-016 *(App Spec §18 — art projects/MVs are first-class citizens of the shared spine; everything they'd share with camps is exactly as (un)built as it is for camps)*

**Built:** art projects and mutant vehicles are first-class — their own
registration paths, their own roles, sharing the same identity, membership,
permission and review machinery as camps.

**Not built:** the modules they would share with camps, because those are not
built for camps either (§6, §7, §9, §10).

This section needs no separate technical plan. Anything built for camps arrives
for creative projects roughly free, provided it is built on the shared spine.

## 19. Permissions and security ✅

**Requirement IDs:** ✅ SEC-001, SEC-002, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014, SEC-015, SEC-016, SEC-021 · 🚧 SEC-005, SEC-006, SEC-007, SEC-017, SEC-018, SEC-019, SEC-020, SEC-023 · ❌ SEC-003, SEC-008, SEC-022 *(App Spec §19 — the strongest section: most roles and every core security control are built; the two acknowledged gaps below sit under SEC-020/SEC-023)*

Built, and beyond the App Spec's list.

- **Sign-in:** email and password, Google, two-factor with encrypted backup
  codes, and passkeys.
- **Roles are data, not code.** AfrikaBurn creates departments and roles in the
  console and sets exactly what each may do. Adding a department does not need a
  developer.
- **Camps have their own role system**, mirroring the same shapes, including
  officer roles that ask the person's consent before publishing their contact
  details outside the camp.
- **Personal information is enforced in the database query, per department** —
  not by hiding fields on screen. A refused caller's data never contains the
  personal information at all, not even unrendered.
- **Medical notes** are audited on every read; the record answers "who saw my
  medical information?" and is deliberately not surveillance of staff.
- **POPIA:** documented lawful purpose, encryption at rest, bounded retention,
  consent at the point of entry, account deletion with a grace period, and a
  breach procedure. The obligations and incident runbooks are in
  [`auth-platform-spec.md`](auth-platform-spec.md).
- **Verified by tests**, including adversarial ones: a camp lead cannot read
  another camp's members, a role that can assign roles cannot use that to
  promote itself, and no route ships without a permission check.

Two gaps stated plainly: **nothing is watching for attacks** — there is no
alerting on failed-login spikes — and the **automatic deletion of expired ID
documents is written but not scheduled**.

## 20. First development release ⚠️

**Requirement IDs:** ✅ RELEASE-001, RELEASE-002, RELEASE-012 · 🚧 RELEASE-003, RELEASE-008, RELEASE-009, RELEASE-021, RELEASE-022, RELEASE-033 · ⚠️ RELEASE-004 · ❌ RELEASE-005–RELEASE-007, RELEASE-010, RELEASE-011, RELEASE-013–RELEASE-020, RELEASE-023–RELEASE-032, RELEASE-034 *(App Spec §20 — written before the current build existed; several Phase-1 items are done out of order, and Phase 1's two heaviest items, RELEASE-014/RELEASE-016, remain blocked on the same missing map data as §11–§13)*

The App Spec's Phase 1 was written before the current build existed, and reads
oddly against it now: several Phase 1 items are done, while Phase 1 also
contains the two heaviest unbuilt things in the document (a layout tool, and
tent-packing under Bedouin tents).

A technically ordered sequence, given what exists:

**Next** — the modules that need no external answer and sit directly on the
spine: camp-authored onboarding (§3, reuses the questionnaire engine), shifts
(§6), budget (§7, the ordinary half), roster import/export (§4).

**After** — things that need the above to exist: WAP allocation (§9), camp
statistics (§5), previous-year duplication (§15), disclosure triggers (§16).

**Blocked until somebody outside the team answers** — placement and layout
(§11–13, needs map data), tickets (§10, needs Quicket's integration surface),
payments (§8, needs a decision on whether AfrikaBurn wants to take money at
all).

**Not before those** — Village functionality, AI-assisted anything.

The one thing worth doing regardless of sequence: **set the reporter's keys** so
that when people use this, they can tell us what broke.

## 21. Core development principle ✅

**Requirement IDs:** ✅ PRINCIPLE-001–PRINCIPLE-008 *(App Spec §21 — held, and demonstrated in technical choices: no money custody, no unconsented publishing, audited sensitive access, self-entered data over admin-entered)*

Held, and visible in the technical choices rather than only stated: the platform
records money without holding it, publishes nothing it was not given permission
to publish, audits access to the sensitive things, and asks people for their own
data rather than having administrators enter it for them.

Where this document disagrees with the App Spec — §4 most sharply, §8 next — the
disagreement is about that principle, not about effort.
