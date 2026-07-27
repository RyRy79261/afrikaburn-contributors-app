# Roadmap

*The committed track is built from Finlay's grounded scope documents plus Ryan's offline
directive. The Quagga Portal doc contributes a **topic map** — a survey of camp-life
concerns — from which candidate directions graduate only with validated demand and a
pass on the fewer-forms test (see [`synthesis.md`](synthesis.md)). Releases are ordered
by deadline pressure: registration season drives R1, the event itself drives R2.*

## Design principles that shape the ordering

1. **Fewer forms, not more.** The platform exists because people don't fill out forms. Every feature must *reduce* net administrative burden: derive over ask, carry forward by default, aggregates over rosters, progressive disclosure. A feature that adds mandatory admin has the burden of proof against it.
2. **Assume zero on-site connectivity.** On-site interactions are reads of pre-synced local data or QR attestation handshakes (mechanism in [`mvp-proposal.md`](mvp-proposal.md)). Architecture lands in R0, hardening in R2, and every later on-site feature reuses the same primitive.
3. **Persistent entities, per-edition records, edition-scoped config.** Year-to-year carry-forward — the one theme both authors independently demand — is the spine, and it's also the biggest single form-burden reducer.
4. **One `groups` table, ship UI for theme camps.** Joinable groups (kind: org | theme_camp | artwork | mutant_vehicle) with many-to-many memberships give us artworks/MVs, org staff roles, and multi-membership for free; "project" = any non-org group. The generalisation is free now, expensive later.
5. **Big speculative builds never block a release.** The layout designer (a small CAD app) is the canonical example — candidate track, own lane, if ever.
6. **The platform never holds funds.** No camp fees, no treasuries. The only money in scope is AB-side logistics fees, and those start as payment-*status* tracking; an integrated gateway (SA-based, international Visa/Mastercard) happens only if AB wants it.

## Committed track

### R0 — Kickoff MVP *(now; kickoff 28 July 2026; scope in [`mvp-proposal.md`](mvp-proposal.md))*

> *Correction, 27 Jul 2026: R0 grew a **third** app —* `apps/suppliers` *(port 3002),
> which absorbed the "supplier repository" work listed under R1 below. Auth is
> self-hosted Better Auth, not Neon Auth, and 2FA/passkeys shipped inside R0 rather
> than waiting for R1 hardening. The rest of this release sequence still stands.*

Three apps: **`apps/web`** (participants) + **`apps/org`** (admin/review, separate
deployment) + **`apps/suppliers`** (supplier portal). Shared spine (email+Google auth, Resend, **Burner Bio onboarding via the
ported Camp 404 questionnaire engine** with per-field privacy, profile keypairs,
self-registered camps with duplicate/similarity checks, directory + invites, editions
as root namespace) + the registration wizard and org review flow end-to-end + supplier
repository seeded from AB's public Suppliers List + payment-details/reference blocks +
disabled hint tiles for everything parked (containers, water/ice/gas, placement, art
grants, topics). Seeded edition: **AfrikaBurn 2027, 26 April – 2 May 2027**. No
container flows, no attestation flows, no payment processing.

### R1 — Registration season readiness *(deadline: ~September 2026 — Form 1 opens Sept per the Theme Camps Guide)*
- **Two-form model**: Form 1 (Sept, intent/identity → Committee reviews biweekly → approval + wrangler assigned) is the core registration; **Form 2 (Jan: size/placement/sound/gifting + mandatory layout diagram) ships as an org questionnaire targeting registered_camp_leads** — the questionnaire feature's flagship use case. Wrangler assignment moves to Form-1 acceptance.
Make Layer A real for camps and AB staff:
- Production auth, real email (Resend), reminder/deadline jobs (introduce Inngest here if the async workload justifies it)
- **Payment collection decision with AB**: either keep AB's existing channels (Quicket/EFT) with in-app references + reconciliation, or integrate a gateway — SA-based, accepting international Visa/Mastercard (candidates: Paystack, Peach Payments, PayFast). Either way the platform never holds funds
- Registration hardening: validation from the real Google Form, export for placement
- **Previous-year duplication + change-comparison view** — the flagship fewer-forms feature: returning camps confirm deltas instead of re-entering
- Staff-assigned ERFs + camp codes on profiles (unblocks container booking without any placement tool)
- **Wrangler assignments + wrangler board**: assign wranglers (org role) to registered camps per edition; board shows per-camp progress (registration status, bookings, milestones as they get defined)
- **Supplier repository v1**: supplier self-registration at a dedicated URL (account-linked to a burner profile when emails match), directory with vetting status, structured supplier declarations in camp registration (replaces free text), org-side feedback capture
### The container app *(separate application — Ryan, 23 Jul 2026)*
Container transport serves only the largest camps, so it becomes **its own app** in the
monorepo rather than part of the standard participant app. Finlay's detailed V1
container scope (registry, booking wizard, slots/convoys, 12-state lifecycle,
coordinator ops) is this app's spec, riding the same spine (auth, groups, editions,
entitlements, payment-reference blocks). Registry migration from AB's existing data
(format TBC). Deadline pressure: bookings must exist before build week 2027. The driver
manifest ships **disabled/pending-need** — likely an anti-pattern (inventories are
rarely actually known).

### R2 — On-site readiness *(deadline: build week 2027; low priority until the container app exists)*
The offline milestone:
- PWA + service worker; "pack for site" pre-event sync (bookings, manifests, camp lists, public keys); local store + outbound queue
- Attestation flows live: container delivery + post-event collection sign-off (driver ⇄ collection person), offline issue-flagging
- Printable fallbacks (manifests, camp lists) — paper is the ultimate offline mode
- Device re-enrolment (lost phone) and key revocation

### R3 — Logistics V2 *(needs AB discovery input first)*
Water, ice, gas on the same rails, built on the **request-queue pattern**: a camp files
a request via the questionnaire spine → it lands in an org coordinator's or a specific
supplier's queue → on-site fulfilment closes with a QR attestation. Water is the
canonical case (registered camps sign up in advance with AB's registered water
supplier). Ordering leans on registration data already held (camp size → allocation)
rather than new forms.

## Candidate directions — from the topic map

*None of these are commitments. Each graduates only if (a) someone real asks for it,
(b) it survives the fewer-forms test, and (c) it doesn't add a POPIA surface AB hasn't
justified. Listed roughly by how plausibly they'd graduate.*

- **Carry-forward extensions** — duplicating layouts/infrastructure/safety info year-to-year with expiry flags for annually-reconfirmed items. The most fewer-forms-aligned part of the whole topic map; parts may fold into R1 naturally.
- **Camp-people tools** (camp-authored onboarding content, member views, shifts, statistics) — participants are already users with Burner Bios and camp memberships (spine), so the substrate exists; what's unvalidated is camp-admin tooling on top. Camp 404 proves single-camp demand for some of it. Graham's admin-managed camper-identity database (IDs/passports) specifically should likely *never* be built without a hard AB requirement — it's the opposite of the self-serve bio model.
- **Working budget** — value depends on whether treasurers actually want a tool or a spreadsheet; manual EFT/cash recording only, no dues gateway (payment-intermediary compliance surface).
- **Compliance / anti-plug-and-play review** — worth adopting as a *value*; implement as progressive disclosure triggered for the few camps that match (>20 participants, >R100k dues, turnkey services), only if AB confirms it acts on this.
- **Supplier portal (`apps/suppliers`)** — the supplier-side deep workflow: AB's onboarding steps, meetings, deposit tracking, vetting workflow. Explicitly a separate sub-project in the monorepo, built once AB's actual procedure is known (blocker table). The camp-facing repository (R1) doesn't wait for it.
- **Placement & layout tooling** — **explicitly deferred (Ryan, 22 Jul 2026)**: no structured geo data exists, the official map is a PDF that arrives late, and the layout changes every year — nothing reliable to build against. Staff-assigned codes/locations on camp profiles (R1) cover what other workflows need. The layout designer / erf-fit ideas stay parked until AB's map process changes.
- **Collectives** (formerly "villages" — a camp of camps, e.g. Mad Hatters) — shared shifts/budgets/lists across member camps; a questionable feature until real demand shows (the Mad Hatters connection makes this worth *asking about* at kickoff).
- **Creative Project Mode** (artworks/MVs) — unlocked by AB's scope answer; cheap if the `projects` generalisation held from R0.
- **Distant**: WhatsApp/SMS notifications, AI assists (budget/scheduling), supplier/asset tracking.
- **Out, permanently (Ryan, 22 Jul 2026)**: **ticketing** — it stays entirely with Quicket; the platform records status at most and never issues, transfers, or integrates tickets.

## What we need from others to keep this moving

| Blocker | Blocks | Who |
|---|---|---|
| Sign-on HTML prototype (still not in repo) | Auth screen review in R0 | Collaborators |
| 2027 registration opening date | R1 deadline | AB |
| Google Form access + validation rules | R1 registration hardening | AB |
| Container registry data + format | R1 migration | AB |
| Pricing (routes/storage/water/ice/gas), refund policy, and how AB wants to collect fees (existing channels vs integrated gateway; merchant account status) | R1/R3 | AB |
| Site map / erf data format | Placement candidate work | AB |
| Full-camper-list vs minimal-contacts decision (default: minimal) | Data posture across the board | AB |
| Supplier deposit/fee amounts, Supplier Agreement text, vetting criteria (procedure itself now documented — see `docs/sources/quaggapedia/supplier-depot.md`) | Supplier portal; repository vetting fields | AB |
| Confirm current water process (public wiki documents no delivery service; Finlay's scope says Quicket-based delivery exists — one is stale) | R3 water workflow | AB |

### Platform-as-backend: public API + MCP server *(Ryan's idea, 24 Jul 2026 — after the design pass)*
Make the platform a formal backend others can build on: a public API + an MCP server as
their own app/project in the monorepo. Camp-specific apps (e.g. Camp 404) authenticate
against it and reuse the shared spine — one Burner Bio per human across every camp app,
memberships/entitlements queried rather than duplicated. Slots naturally into the
existing architecture (the org/participant apps already consume the same packages).
Explicitly parked until after the design pass lands.
