# Roadmap

| Field | Value |
|---|---|
| **Category** | Planning |
| **Doc status** | Active |
| **Normative language** | Descriptive only |
| **Requirement IDs** | Partial — `RELEASE-*` (App Spec §20) |
| **Owner / Updated** | Repo maintainers, 2026-08-12 |

_The committed track is built from Finlay's grounded scope documents plus Ryan's offline
directive. The Quagga Portal doc contributes a **topic map** — a survey of camp-life
concerns — from which candidate directions graduate only with validated demand and a
pass on the fewer-forms test (see [`synthesis.md`](synthesis.md)). Releases are ordered
by deadline pressure: registration season drives R1, the event itself drives R2._

## Design principles that shape the ordering

1. **Fewer forms, not more.** The platform exists because people don't fill out forms. Every feature must _reduce_ net administrative burden: derive over ask, carry forward by default, aggregates over rosters, progressive disclosure. A feature that adds mandatory admin has the burden of proof against it.
2. **Assume zero on-site connectivity.** On-site interactions are reads of pre-synced local data or QR attestation handshakes. Architecture lands in R0, hardening in R2, and every later on-site feature reuses the same primitive.
3. **Persistent entities, per-edition records, edition-scoped config.** Year-to-year carry-forward — the one theme both authors independently demand — is the spine, and it's also the biggest single form-burden reducer.
4. **One `groups` table, ship UI for theme camps.** Joinable groups (kind: org | theme_camp | artwork | mutant_vehicle) with many-to-many memberships give us artworks/MVs, org staff roles, and multi-membership for free; "project" = any non-org group. The generalisation is free now, expensive later.
5. **Big speculative builds never block a release.** The layout designer (a small CAD app) is the canonical example — candidate track, own lane, if ever.
6. **The platform never holds funds — settled, not merely current practice.** No camp fees, no treasuries, no gateway, ever ([Decision 009](decisions/decision-009-payment-direction.md), 12 Aug 2026). The only money in scope is AB-side logistics fees, and those are payment-_status_ tracking permanently: a unique code identifying who a payment is for, and a checkbox marking it received. The earlier "an integrated gateway happens only if AB wants it" is superseded — a gateway now requires reopening Decision 009, not a feature request.

## Committed track

### R0 — Kickoff MVP _(shipped; kickoff 28 July 2026)_

> _Correction, 27 Jul 2026: R0 grew a **third** app —_ `apps/suppliers` _(port 3002),
> which absorbed the "supplier repository" work listed under R1 below. Auth is
> self-hosted Better Auth, not Neon Auth, and 2FA/passkeys shipped inside R0 rather
> than waiting for R1 hardening. The rest of this release sequence still stands._

Three apps: **`apps/web`** (participants) + **`apps/org`** (admin/review, separate
deployment) + **`apps/suppliers`** (supplier portal). Shared spine (email+Google auth, Resend, **Burner Bio onboarding via the
ported Camp 404 questionnaire engine** with per-field privacy, profile keypairs,
self-registered camps with duplicate/similarity checks, directory + invites, editions
as root namespace) + the registration wizard and org review flow end-to-end + supplier
repository seeded from AB's public Suppliers List + payment-details/reference blocks +
disabled hint tiles for everything parked (containers, water/ice/gas, placement, art
grants, topics). Seeded edition: **AfrikaBurn 2027, 26 April – 2 May 2027**. No
container flows, no attestation flows, no payment processing.

### R1 — Registration season readiness _(deadline: ~September 2026 — Form 1 opens Sept per the Theme Camps Guide)_

- **Two-form model**: Form 1 (Sept, intent/identity → Committee reviews biweekly → approval + wrangler assigned) is the core registration; **Form 2 (Jan: size/placement/sound/gifting + mandatory layout diagram) ships as an org questionnaire targeting registered_camp_leads** — the questionnaire feature's flagship use case. Wrangler assignment moves to Form-1 acceptance.
  Make Layer A real for camps and AB staff:
- Production auth, real email (Resend — **blocked pending AfrikaBurn buy-in**, not an engineering task; the code is complete and degrades honestly without a key), reminder/deadline jobs ✅ _(shipped: `/api/registrations/deadline-reminders`, 21/7/1-day milestones, idempotent. **Nothing schedules it yet** — no Vercel cron job, by decision; it needs a scheduler pointed at it to go live. Inngest was not introduced — one query a day did not justify it)_
- **Payment: DECIDED, no gateway ever** ([Decision 009](decisions/decision-009-payment-direction.md), 12 Aug 2026). The platform never handles funds. It issues **unique codes that identify who a payment is for** (`QP-2027-MAH-001` for AB-side fees; `MAH-M017` per membership for a camp's own EFT reconciliation) and offers **a checkbox to mark someone paid**. AfrikaBurn collects through its existing channels. ✅ _(shipped: the Payment card on the registration review screen)_
- Registration hardening: validation owned by **our own questionnaire engine — no Google Forms** ([Decision 014](decisions/decision-014-questionnaire-engine-over-google-forms.md), 12 Aug 2026); export for placement ✅ _(shipped: `/api/registrations/export`, CSV, no personal data)_
- **Previous-year duplication + change-comparison view** — the flagship fewer-forms feature ✅ _(shipped: `@quagga/core` `registration-carry-forward` + `bio-carry-forward`, the camp-side offer banner, and the reviewer's diff above the sections)_

  **The rollover rule (Ryan, 12 Aug 2026).** Carry-forward is a **typing aid, never a shortcut through the process**. A returning camp still makes a new proposal — new Form 1, new Form 2, reviewed on its own merits — and a returning burner still completes their bio. What rolls over is pre-filled text they must go through and update; nothing is marked complete on their behalf.
  - **Burner Bio** — copied into the new edition, presented with `completedAt: null` so the onboarding gate still requires completion. **Everything carries except `firstTime`**, which is an edition-relative claim. That includes the ID/passport number (an SA ID never changes, and the field stays editable for a renewed passport) and medical notes (so they are confirmed rather than silently lost).
  - ⚠️ **The ID retention purge still does not exist.** `@quagga/core` `id-retention` is a pure, tested rule with **no caller** — nothing writes `buildIdPurgePatch()` to the database, so no ID data is deleted on any schedule today. `docs/accounts-security-spec.md` has always said the job is a later task; this is a reminder that it is still outstanding, and that carrying bios forward makes it more worth building rather than less.
  - **Camp registration** — only **Form 1** answers pre-fill. **Everything Form 2 asks starts empty every year**: size, arrival date, sound, placement preferences and the layout diagram. Placement zones are configured per edition year, so a carried choice could name a zone that no longer exists. The Plug & Play acknowledgement is also given fresh each edition — copying a tick manufactures consent nobody gave.
  - **Erf and camp code** never carry: they are staff-assigned per edition and are not in the carry-forward field set at all.
- Staff-assigned ERFs + camp codes on profiles (unblocks container booking without any placement tool) ✅ _(shipped: `registrations.camp_code` unique per edition, `registrations.erf` free text — deliberately not a placement tool, see [Decision 012](decisions/decision-012-map-erf-readiness.md))_
- **Wrangler assignments + wrangler board**: assign wranglers (org role) to registered camps per edition; board shows per-camp progress (registration status, bookings, milestones as they get defined)
- **Supplier repository v1**: supplier self-registration at a dedicated URL (account-linked to a burner profile when emails match), directory with vetting status, structured supplier declarations in camp registration (replaces free text), org-side feedback capture

### The container app _(separate application — Ryan, 23 Jul 2026)_

Container transport serves only the largest camps, so it becomes **its own app** in the
monorepo rather than part of the standard participant app. Finlay's detailed V1
container scope (registry, booking wizard, slots/convoys, 12-state lifecycle,
coordinator ops) is this app's spec, riding the same spine (auth, groups, editions,
entitlements, payment-reference blocks). Registry migration from AB's existing data
(format TBC). Deadline pressure: bookings must exist before build week 2027. The driver
manifest ships **disabled/pending-need** — likely an anti-pattern (inventories are
rarely actually known).

### R2 — On-site readiness _(deadline: build week 2027; low priority until the container app exists)_

The offline milestone:

- PWA + service worker; "pack for site" pre-event sync (bookings, manifests, camp lists, public keys); local store + outbound queue
- Attestation flows live: container delivery + post-event collection sign-off (driver ⇄ collection person), offline issue-flagging
- Printable fallbacks (manifests, camp lists) — paper is the ultimate offline mode
- Device re-enrolment (lost phone) and key revocation

### R3 — Logistics V2 _(needs AB discovery input first)_

Water, ice, gas on the same rails, built on the **request-queue pattern**: a camp files
a request via the questionnaire spine → it lands in an org coordinator's or a specific
supplier's queue → on-site fulfilment closes with a QR attestation. Water is the
canonical case (registered camps sign up in advance with AB's registered water
supplier). Ordering leans on registration data already held (camp size → allocation)
rather than new forms.

## Candidate directions — from the topic map

_None of these are commitments. Each graduates only if (a) someone real asks for it,
(b) it survives the fewer-forms test, and (c) it doesn't add a POPIA surface AB hasn't
justified. Listed roughly by how plausibly they'd graduate._

- **Carry-forward extensions** — duplicating layouts/infrastructure/safety info year-to-year with expiry flags for annually-reconfirmed items. The most fewer-forms-aligned part of the whole topic map; parts may fold into R1 naturally.
- **Camp-people tools** (camp-authored onboarding content, member views, shifts, statistics) — participants are already users with Burner Bios and camp memberships (spine), so the substrate exists; what's unvalidated is camp-admin tooling on top. Camp 404 proves single-camp demand for some of it. Graham's admin-managed camper-identity database (IDs/passports) specifically should likely _never_ be built without a hard AB requirement — it's the opposite of the self-serve bio model.
- **Working budget** — value depends on whether treasurers actually want a tool or a spreadsheet; manual EFT/cash recording only, no dues gateway (payment-intermediary compliance surface).
- **Compliance / anti-plug-and-play review** — worth adopting as a _value_; implement as progressive disclosure triggered for the few camps that match (>20 participants, >R100k dues, turnkey services), only if AB confirms it acts on this.
- **Supplier portal (`apps/suppliers`)** — the supplier-side deep workflow: AB's onboarding steps, meetings, deposit tracking, vetting workflow. Explicitly a separate sub-project in the monorepo, built once AB's actual procedure is known (blocker table). The camp-facing repository (R1) doesn't wait for it.
- **Placement & layout tooling** — **explicitly deferred**: no structured geo data exists, the official map is a PDF that arrives late, and the layout changes every year — nothing reliable to build against. Staff-assigned codes/locations on camp profiles (R1) cover what other workflows need. The layout designer / erf-fit ideas stay parked until AB's map process changes.
- **Collectives** (formerly "villages" — a camp of camps, e.g. Mad Hatters) — shared shifts/budgets/lists across member camps; a questionable feature until real demand shows (the Mad Hatters connection makes this worth _asking about_ at kickoff).
- **Creative Project Mode** (artworks/MVs) — unlocked by AB's scope answer; cheap if the `projects` generalisation held from R0.
- **Distant**: WhatsApp/SMS notifications, AI assists (budget/scheduling), supplier/asset tracking.
- **Out, permanently**: **ticketing** — it stays entirely with Quicket; the platform records status at most and never issues, transfers, or integrates tickets.

## What we need from others to keep this moving

| Blocker                                                                                                                                                      | Blocks                                     | Who           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------- |
| Sign-on HTML prototype (still not in repo)                                                                                                                   | Auth screen review in R0                   | Collaborators |
| **Resend: buy-in + a registered domain.** Not an ops chore — an AB decision. The email code is complete and tested; without a key it logs and says so honestly | Real email delivery across all three apps  | AB            |
| 2027 registration opening + closing dates                                                                                                                    | R1 deadline; the reminder job stays silent until a close date is set | AB |
| Container registry data + format                                                                                                                             | R1 migration                               | AB            |
| Pricing (routes/storage/water/ice/gas) and refund policy. **How** AB collects is no longer open — [Decision 009](decisions/decision-009-payment-direction.md) settles it: their channels, our references and a paid checkbox. What remains is the amounts | R1/R3 | AB |
| Site map / erf data format                                                                                                                                   | Placement candidate work                   | AB            |
| Full-camper-list vs minimal-contacts decision (default: minimal)                                                                                             | Data posture across the board              | AB            |
| Supplier deposit/fee amounts, Supplier Agreement text, vetting criteria (procedure itself now documented — see `docs/sources/quaggapedia/supplier-depot.md`) | Supplier portal; repository vetting fields | AB            |
| Confirm current water process (public wiki documents no delivery service; Finlay's scope says Quicket-based delivery exists — one is stale)                  | R3 water workflow                          | AB            |

### Platform-as-backend: public API + MCP server

Make the platform a formal backend others can build on: a public API + an MCP server as
their own app/project in the monorepo. Camp-specific apps (e.g. Camp 404) authenticate
against it and reuse the shared spine — one Burner Bio per human across every camp app,
memberships/entitlements queried rather than duplicated. Slots naturally into the
existing architecture (the org/participant apps already consume the same packages).
Explicitly parked until after the design pass lands.
