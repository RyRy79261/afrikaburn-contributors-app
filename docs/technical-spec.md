# Technical Specification — Quagga Portal

Companion to the **App Specification** (Coda). That document says what the
product should do; this one says what is built, how, and what each unbuilt part
would actually take. Section numbers match the App Spec so the two can be read
side by side.

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

Nothing built. Not hard — it is counting — but it counts things that do not
exist yet: shifts, fees, tickets, passes. Realistically it follows §6–§10 rather
than leading them.

The App Spec's own caution ("should not become a public scoring system") is
straightforward to honour technically: these numbers would live behind the same
per-camp permission check as the roster.

## 6. Shift management ❌

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

Nothing built. The codebase assumes **Quicket remains the system of record** and
the platform only ever notes status, never issues a ticket.

**The technical question to settle before any work starts is what Quicket
allows.** Whether a camp allocation can be represented there, whether we can
read ticket status per person, and whether names can be submitted, are questions
about their integration surface, not ours. Building camp-side allocation without
that answer risks a parallel record of who has a ticket that quietly disagrees
with the real one — worse than no feature.

## 11. Theme-camp layout tool ⚠️

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

Depends entirely on §11. The described rules — pole positions, rigging exclusion
zones, emergency walkways, overlap warnings, automatic arrangement — are a
constraint-solving problem, and a genuinely interesting one, but they need the
scaled canvas first.

Worth noting for planning: "automatically arrange tents fairly" is meaningfully
harder than "warn when tents overlap". The warnings are worth having on their
own and could ship long before the optimiser.

## 13. AfrikaBurn map and erf placement ⚠️

Blocked on the same missing data as §11, plus a second dependency: this section
assumes AfrikaBurn allocates erven in a system we can read and write.

The **back-and-forth workflow** it describes — a wrangler proposes a layout, the
camp approves, rejects, comments or revises — is not new. That is precisely the
registration review loop that already works (§14), applied to a different
artifact. When map data exists, that pattern is reusable rather than rebuilt.

## 14. Annual registration and placement submission ✅

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

Not built. One structural piece is: the platform already models camps, art
projects and mutant vehicles as the same kind of thing with different types, so
a Village is a group containing groups rather than a new concept.

Everything else — shared rosters, shifts, budgets, announcements, cross-camp
reporting — depends on those modules existing first.

The sharing rule the App Spec states ("each camp controls what it shares") is the
part to design carefully. Sharing consent between organisations is a permission
model in its own right, not a checkbox.

## 18. Creative Project Mode 🚧

**Built:** art projects and mutant vehicles are first-class — their own
registration paths, their own roles, sharing the same identity, membership,
permission and review machinery as camps.

**Not built:** the modules they would share with camps, because those are not
built for camps either (§6, §7, §9, §10).

This section needs no separate technical plan. Anything built for camps arrives
for creative projects roughly free, provided it is built on the shared spine.

## 19. Permissions and security ✅

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

Held, and visible in the technical choices rather than only stated: the platform
records money without holding it, publishes nothing it was not given permission
to publish, audits access to the sensitive things, and asks people for their own
data rather than having administrators enter it for them.

Where this document disagrees with the App Spec — §4 most sharply, §8 next — the
disagreement is about that principle, not about effort.
