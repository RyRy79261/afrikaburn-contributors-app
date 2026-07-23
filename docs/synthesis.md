# Requirements Synthesis — AfrikaBurn Contributors App

*Correlated from all source documents. Plain-text/markdown extractions live in
[`docs/sources/`](sources/); original PDFs/docx at the repo root. The `AfrikaBurn App/`
folder is a byte-identical duplicate of the root documents (verified by checksum) and can
be deleted.*

## Source inventory

| Document | Author | Maturity | What it covers |
|---|---|---|---|
| Master Brief (3pp) | Finlay Kettlewell | Preliminary | Problem, user families, workflow map (V1/V2/V3), cross-cutting concerns, priority questions |
| Scope: Container Transport (5pp) | Finlay | **Detailed** (V1) | Entities, 12-state lifecycle, storage/routes/pricing, convoys & slots, booking wizard, confirmed rules |
| Scope: Theme Camp Registration (5pp) | Finlay | **Detailed** (V1) | All Google Form fields (6 sections), registration states, review workflow, design opportunities |
| Scope: Water / Ice / Gas (2pp each) | Finlay | Preliminary (V2) | User stories both sides; processes largely unknown |
| Discovery Meeting Agenda | Finlay | — | Meeting plan; confirms V1 = Registration + Containers; AB side still unknown |
| **Quagga Portal App Platform** ([source](sources/quagga-portal-platform.md)) | Graham | **Ideation only** — potential ideas, nothing concrete; treat as a survey of concerns, not a spec | Camp-internal topics: onboarding, camper DB, shifts, budgets, fees, WAPs, tickets, layout design, villages, compliance, creative projects |
| Ryan's direction (chat, 22 Jul 2026) | Ryan | Directive | **Assume zero on-site connectivity for all operations**; QR-signature attestation for offline proof of interaction with lazy sync; app must tolerate running offline for extended periods. **The Quagga doc is to be read as topics, not features.** |
| **Quaggapedia corpus** ([index](sources/quaggapedia/INDEX.md)) | AfrikaBurn (official event wiki) | 68 pages + 21 files, mirrored 22 Jul 2026 | Ground truth: Supplier Depot procedure, SOOP sound levels & zone rules, WAPs, Quicket ticketing, DMV/MV licensing, LNT/MOOP, fire & generator rules, event/sound maps, STAR camp-onboarding guideline |

**How to read Graham's Quagga doc (working-group agreement, per Ryan):** it is an
ideation scope written without engineering feasibility in view — potential ideas, nothing
concrete. Its value is as a map of the *concerns* camps have (people, money, shifts,
space, tickets, compliance) — not as a feature list to implement. Critically, its
default mechanism — more mandatory forms, acknowledgements, and tracking — runs
*against* the core problem this platform exists to solve: **participants already don't
complete the forms that exist.** Anything drawn from this topic map must clear a high
bar: it ships only if it *reduces* net administrative burden. Finlay's documents remain
the concrete scope, and Finlay is the active scoping contact.

Cross-document detail confirming the link between the two authors' worlds: Finlay's
container scope uses codes `MAH-1/MAH-2/MAH-3` — Mad Hatters — the same village whose
budget structure the Quagga doc is built on.

## The core product principle: fewer forms, not more

The founding observation (Ryan, 22 Jul 2026): **the problem is that people don't fill
out forms — so the platform must never answer a problem by adding one.** This is the
test every feature passes or fails:

- Every field must earn its place: if AB doesn't act on it, don't ask for it.
- Derive over ask: compute from data we already hold (prior years, profile, bookings) before asking a human to type it.
- Carry forward by default: returning camps/campers confirm deltas, never re-enter.
- Aggregates over rosters: report a number instead of collecting a list wherever the consumer only needs the number.
- Progressive disclosure: extra detail only when a trigger actually fires (e.g. compliance review), not from everyone up front.

This principle also settles several tensions below in favour of the *minimal* option by
default, with the richer option needing explicit AB justification.

## Two documents, two altitudes

The two source sets describe **different layers of the same product space** — but at
very different levels of rigour:

- **Layer A — the Participant Portal (camp ⇄ AfrikaBurn).** Finlay's territory, and the **buildable scope**. Annual registration & placement submission, AB review workflow, container transport, water/ice/gas logistics, payments to AB. Grounded and detailed: built from the real 2026 Google Form and last year's working container app.
- **Layer B — camp-internal tooling.** The Quagga doc's territory, held as a **topic map** (see reading note above). It tells us which concerns exist in camp life; whether any become features depends on demand validation and the fewer-forms test. Notably, Ryan's Camp 404 is a working single-camp implementation of several of these topics — real evidence of which ones matter in practice.

The layers meet at four joints, and those joints are the architectural spine:

1. **The annual submission.** Quagga §14's registration/placement submission is a superset of Finlay's registration scope (adds camper list, budget, build/strike plans, safety docs, layout) — a superset the fewer-forms principle says we do *not* build by default; Finlay's field list, itself mapped from the real form, is the baseline. The state machines are near-identical (Draft → Submitted → Under Review → Changes Requested → Approved/Declined, with Quagga adding Placement Allocated → Final Layout Approved), which is good independent confirmation of the workflow shape.
2. **Previous-year duplication.** Both docs independently make year-to-year carry-forward a core requirement. Confirms the persistent-entity vs per-edition-record split as the foundation.
3. **WAPs.** Finlay: registration captures the WAP request count. Quagga: full internal allocation tool, with AB retaining final approval. Compatible — camp allocates internally, portal submits the list.
4. **Placement.** Finlay flags it as an open question; Quagga specifies a full layout designer, erf-fit testing, and a wrangler ⇄ camp negotiation loop. Both agree the final decision is AB's.

Precedent: **last year's container app validates Layer A**; Camp 404 is live evidence of
which Layer-B topics have real demand in a working camp. Layer A is what we build;
Layer B topics graduate individually if they pass the fewer-forms test.

Quagga is also the only document proposing a product name: **Quagga Portal** (after
Quaggafontein storage — a nice fit with the container-world vocabulary).

## Tensions to surface at kickoff

| Topic | Finlay docs | Quagga topic map | Working default (fewer-forms principle applied) |
|---|---|---|---|
| People data given to AB | Confirmed rule: only lead / alt contact / LNT lead tracked; "population is just a number" | §16 mandates a **full camper list** (with IDs) in every placement submission | **Default: Finlay's minimal rule wins.** Collecting per-camper identity data multiplies the form burden ~40× per camp and makes the platform a POPIA honeypot. Only revisit if AB states a concrete need it acts on, and then via progressive disclosure (compliance triggers), not blanket collection. |
| Ticketing | Confirmed rule: "Registration and ticketing are completely separate" | Ticket allocation tracking incl. "submit camper details to the event ticketing system" | Keep them separate. No ticket features unless AB/Quicket ever offers an integration worth having (the Quagga doc itself concedes it shouldn't issue tickets). |
| Payments | Yoco for camp → AB logistics fees | Payment gateway for camper → camp treasury (dues, instalments, refunds) | **Camp dues/treasuries are out, permanently** — the platform never holds funds. Even AB-side fees start as *status tracking* (booking references + reconciliation); integrated checkout only if AB wants it, via an SA-based provider that accepts international Visa/Mastercard. |
| First release size | Two workflows, deep | Sixteen "Phase 1 modules" | Finlay's V1 + the shared spine, full stop. Topics stay topics until demand-validated. See [`roadmap.md`](roadmap.md). |
| Offline | On-site flows routed through the single wifi box | "Offline event functionality" parked in Phase 3 | **Superseded by Ryan's directive**: assume no on-site connectivity at all; offline + QR attestation is a foundational design constraint (see below). |

## Participant & entitlement model (Ryan, 22 Jul 2026)

The base unit is the **participant**, not the camp:

- **Every user is an AfrikaBurn participant.** Onboarding = a **Burner Bio** (self-serve profile, Camp 404's `burner_profiles` pattern), with **privacy controls on sensitive aspects** — user-owned identity, *not* an admin-managed camper database.
- **Years are the root namespace for data.** The Burner Bio carries across editions (confirm-and-carry, per the fewer-forms principle); everything else a participant does — camp membership, roles, bookings — is data assigned alongside the bio for the currently-active burn.
- **Participants either join a project or free-camp.** Joining a theme camp (or, later, an artwork / mutant vehicle — implying a browsable project registry) puts them inside that organisational structure. Free campers remain plain participants and simply don't get the organisational features.
- **Camps are self-registered, never pre-created by AB.** Any participant can create a camp and gather members immediately — internal operations work from day one.
- **Approval is an attribute, not a gate to existence.** Completing the annual registration (Finlay's 7-state workflow) and getting approved flips the camp's per-edition status from *free camp* to *registered theme camp*. That status is what carries **entitlements**: applying for placement, applying for art grants, booking containers, ordering water/ice/gas. Wanting a spot ("we'd like the camping forest") never implies allocation or entitlement — AB allocates.
- **The questionnaire system is reused from Camp 404** wholesale: bespoke code questionnaires (Burner Bio) + the builder for camp-authored ones, dispatched via activations and gated via `required_actions`.
- **Terminology:** user = **burner**. A **camper** is a burner who is a member of a camp. A **group** is anything joinable — the AfrikaBurn **org**, theme camps, art projects, mutant vehicle teams; a **project** is any non-org group (the kind that registers and earns entitlements).
- **Multi-membership is allowed** (unlikely but legal): one burner can simultaneously be in the org, a theme camp, an art project, and an MV team — Facebook-groups semantics, with context switching in the UI. Memberships are plain many-to-many rows with roles.
- **Admin tiers:** **god admin** (system-wide maximum privileges — bootstrapped by the first sign-in, i.e. Ryan, via a GOD_EMAILS-style mechanism per Camp 404) → **org roles** (AfrikaBurn staff: coordinator, reviewer, wrangler — held as memberships in the org group, not a stored `is_staff` flag) → **group roles** (lead/admin) → member → burner.
- **Visibility follows registration (Ryan, 22 Jul 2026):** registered groups (any kind — camp, artwork, MV) are **public and indexable** in a group directory; unregistered groups may stay private. No bespoke privacy gates yet — but the schema reserves a per-group visibility/privacy setting so finer controls can be added later without migration pain.
- **Joinability is a directory attribute:** a group is either *accepting new members* (open join) or *invite-only*; invites reuse Camp 404's one-time invite-link pattern.
- **Wranglers are assigned, not ambient:** a wrangler (org role) is a "babysitter for theme camps" — assigned to specific registered camps per edition, checking milestone progress, with a **wrangler board** showing per-camp progress (registration status, bookings, later real milestones).
- **Suppliers are a distinct user kind (Ryan, 22 Jul 2026):** external service providers hired by camps (tent builds, electricity). All suppliers must register via a **dedicated procedure and login URL** — not the normal burner sign-up (email overlap with a burner profile links the accounts). Camp-facing need now: a **supplier repository** camps declare from during registration (replacing Finlay's free-text suppliers field), with org-side vetting status and feedback. The supplier-side deep workflow (AB's onboarding steps, meetings, deposits) is deliberately **a separate sub-project** (`apps/suppliers` portal).
- **Requests are questionnaires; fulfillment is attestations (Ryan, 22 Jul 2026):** when a camp needs something — water delivery sign-up, a supplier service, an extra allocation — it files a **request built on the questionnaire spine**. Requests land in a queue owned by an **org-level person** (coordinator) or a **specific supplier**, who works them; where the fulfilment happens on site (a delivery, a handover), it closes with a **QR attestation**. One pattern covers water sign-up, gas orders, ice allocations, and supplier bookings without bespoke plumbing per workflow.
- **Explicitly out of the platform (Ryan, 22 Jul 2026):** **ticketing** (stays entirely with Quicket — we only ever *note* status, never touch tickets) and **placement maps** (no structured geo data exists; the map is a PDF that arrives late and the layout changes every year — nothing reliable to build against yet).

| Family | Roles | Notes |
|---|---|---|
| Burners | Everyone — Burner Bio onboarding; zero or more group memberships | Free campers = burners without a camp; "camper" = burner + camp membership; capabilities derive from memberships (Camp 404 stance) |
| Camp-side admin | Camp creator/lead, Alternative contact | Memberships with roles on a self-registered project |
| Org (AfrikaBurn) | God admin (system-wide; first user bootstraps), Container coordinator, Registration reviewer, Theme-camp wrangler / placement coordinator | Org is a group; staff roles are org memberships. Exact AB functional roles still unknown — discovery question |
| Contractors (work for AB) | Container truck driver, Water delivery driver | Fulfil AB logistics; lightweight token access + printable fallbacks |
| **Suppliers (work for camps)** | Tent/structure builders, electricians, stretch-tent providers, etc. | **Separate registration procedure and login URL** (planned `apps/suppliers` portal in the monorepo); may also hold a burner account — linked by email. Camps declare suppliers from a **supplier repository**; org tracks vetting status and collects feedback. AB's full supplier onboarding (steps, meetings, deposits) is its own sub-project. |
| On-site handover roles | Container collection person | Not a full account; magic link/PIN + device key for attestations |
| Deferred (topic map) | Graham's admin-managed camper DB (ID/passport records), Village leads, Organisation compliance reviewer | Distinct from participant self-serve profiles; only with validated demand + fewer-forms test passed |

## The offline constraint & QR attestation (Ryan's directive — supersedes prior on-site flows)

**Assumption: any operation that needs to happen on site will have no connectivity.**
The "walk to the wifi box" flows in Finlay's docs are replaced by this model:

- The app runs offline for extended periods (PWA + local store + pre-event "pack for site" sync of the user's slice: bookings, manifests, camp lists, relevant public keys).
- Any on-site interaction that needs *proof* becomes an **attestation**: a two-party QR signature handshake.
  - Each device enrols a keypair at login (private key never leaves the device); public keys are registered server-side and distributed in the pre-event sync bundle.
  - Party A displays a QR encoding a compact signed payload (attestation type, subject IDs, edition, nonce, A's key ID, A's signature).
  - Party B scans it offline, verifies A's signature against the pre-synced public key, countersigns, and stores the double-signed record locally (optionally showing a receipt QR back to A so both hold proof).
  - When either device regains connectivity — the wifi box, or back in town after the event — queued attestations **lazy-sync**; the server verifies both signatures and applies the resulting state transitions.
- Attestations are append-only *evidence*; server state is derived from them, so sync is idempotent and order-tolerant. Offline timestamps are treated as claims, not proofs — the signatures prove *that* the interaction happened between *these* parties; nonces prevent replay.

This one primitive covers both layers: container delivery/collection sign-off (driver ⇄
collection person), ice ticket redemption, gas handover, and — camp-internally — shift
attendance check-ins. It should live in the shared spine, not inside any single workflow.
Same problem space as Camp 404, so patterns/solutions should be shared between the two
projects.

## Cross-cutting constraints (updated)

1. **Offline-first on site** — as above. Hard constraint, foundational.
2. **Mobile-first** — on-site is phone-only; pre-event may be desktop.
3. **Payments** — three working rules (Ryan, 22 Jul 2026): (a) **the platform never holds funds** — if a gateway is integrated, money settles directly to AfrikaBurn's merchant account; (b) **no camp fees / camp treasuries, ever** — the only money in scope is AB-side logistics fees; (c) the MVP does **payment-status tracking**, not payment processing — whether AB even wants in-app checkout (vs keeping Quicket/EFT and reconciling references) is a discovery question. If integrated later, the provider must be **SA-based but accept international Visa/Mastercard**; candidates to evaluate: Paystack, Peach Payments, PayFast. (Finlay's docs assume Yoco, which is domestically focused — treat that as an assumption to revisit, not a decision.)
4. **Auth** — email/Google OAuth full accounts; magic link/PIN for handover roles; Quagga adds MFA for privileged roles.
5. **POPIA** — applies to what we do hold (contacts, phones, financial figures); Camp 404's pgcrypto pattern applies. Staying on the minimal-data default keeps this surface small — a strong reason *not* to build the camper-identity database from the topic map.
6. **Year-to-year continuity** — duplication of submissions, camper data, budgets, layouts; expiry flags for annually-reconfirmed items (safety certs, insurance, arrival dates).
7. **Notifications** — in-app + email; Quagga floats WhatsApp/SMS (consent + cost — defer).
8. **Scale** — ~120 registered camps, ~100 artworks; with every participant onboarding a Burner Bio, the user base trends toward event scale (thousands) — self-serve and low-touch by design, so it's an auth/storage question rather than an admin burden.
9. **Anti-plug-and-play stance** — "genuine participation easier, administrative abuse harder" is the one part of the Quagga doc worth adopting as a value. Done right it is *not* more forms for everyone: it's progressive disclosure — triggers (>20 participants, >R100k dues, turnkey-looking services) prompt extra questions from the few camps they apply to, if AB confirms it wants this at all.

## Consolidated open questions

### Closed or narrowed by the Quaggapedia corpus (22 Jul 2026)

- **Suppliers — procedure now documented** (`sources/quaggapedia/supplier-depot.md`): only registered creative projects may use suppliers; each project gets a unique non-shareable **Supplier Code**; all supplier operations run through the **Supplier Depot ("The Yard")**; 7-step registration (form → agreement + deposit → inventory sheet → crew IDs/tickets → compulsory briefing → registration fee → compliance = deposit refund); 2026 deadline was Fri 28 March (~1 month pre-event); plug-and-play servicing forfeits deposits. *Still needed from AB: deposit/fee amounts and the Supplier Agreement text.*
- **Sound — answered**: the official **SOOP scale is 3 levels** (1 = normal car stereo; 2 = amplified "like a taxi", restricted areas; 3 = club/stadium, loud zones only, speakers away from Binnekring), plus zone/time rules (quiet camping areas, general camping midnight–11am ban, Binnekring 2am cut-off Mon–Thu, louder zone 7am, hard midnight-Sunday stop). ⚠️ Finlay's registration example "Level 2 — car stereo" mislabels the official scale — car stereo is Level 1. Sound camps register as such for placement. Sound maps exist as images.
- **WAPs — answered**: free passes allocated to **crew leads of registered creative projects**, who allocate onward; needed alongside a ticket; early-arrival window Wed–Sun before gates; includes E-Toll until the Sunday.
- **Tickets — answered**: **Quicket confirmed** as vendor; categories (General, Subsidised, Pensioner, Anathi, Kids free ≤13, Minor 14–17); one-edit and transfer rules; name must match ID. Supports the "registration ≠ ticketing" rule.
- **Mutant vehicles — answered**: DMV pre-registration via Google Form + on-site Testing Station licensing at 6ish/Binnekring, day/night licences, e-bikes >400W count as MVs. A complete model for the eventual MV registration workflow (R7).
- **Ice — answered**: sold at **Die Yskas** at Off-Centre Camp — literally the only thing sold at the event. No public pricing.
- **LNT / fire / generators — concrete registration-form fields**: designated LNT officer, greywater/evaporation plan, no-glass acknowledgement, 2-hour communal clean-up commitment + LNT sign-off ("Green" on the MOOP map), fire-extinguisher counts (~1×4.5kg DCP per 8×8m, min 2 per 50m²), camp "Safety Baron", brazier-only fires, generator hours + **fuel-litre logging for carbon reporting**, camp fees allowed only open-book/no-profit.
- **Placement layout conventions**: Binnekring (inner ring) / Buitekring (outer), clock radials "1-ish"–"11-ish", concentric roads renamed yearly to theme; reserved marked areas for registered projects; ARTeria is arrival reception for camps/artists. **No structured geo data exists** — maps are per-year images/PDFs; "erf" is internal AB vocabulary, absent from the public wiki.
- **Entitlements confirmed from the corpus**: registered projects get reserved placement, WAP allocation, supplier codes, and (historically) limited on-site non-potable water extraction.
- **Water — resolved (Ryan, 22 Jul 2026)**: there is no general water delivery; **registered theme camps sign up in advance with AB's registered water supplier**, submitting their placement map as part of the sign-up. Supplier reliability is a known pain point. This makes water delivery exactly what our model predicts: a registered-camp entitlement fulfilled by a supplier — a natural fit for the request-queue pattern below. Remaining questions: who the supplier is, pricing, and the sign-up mechanics.

**For AfrikaBurn (discovery meeting)**
- Scope of identity: theme camps only, or all registered projects (~220)? Do artworks/MVs register and use logistics? (Both authors independently anticipate the broader answer — Finlay's V3, Quagga's Creative Project Mode.)
- Does AB have a concrete, acted-upon need for full camper lists in submissions (Quagga §16 claims so), or do minimal contacts (Finlay's confirmed rule, our default) suffice? POPIA posture and form burden both depend on it.
- Placement: in-app or external? Is mapping/erf data available in any structured form?
- AB staff roles and review processes; what's painful; what must not break.
- All pricing (routes, storage, water, ice, gas), refund policies.
- **How does AB actually want to collect logistics fees?** Keep existing channels (Quicket / EFT / their current Yoco arrangement?) with the app tracking payment references and status — or integrated in-app checkout? If integrated: SA-based provider accepting international Visa/Mastercard (candidates: Paystack, Peach Payments, PayFast).
- Container registry migration; last year's app lessons.
- Water/ice/gas current processes — essentially everything.
- **Entitlements**: confirm what an approved (registered) camp unlocks — placement application, **art grants** (newly surfaced: what's the grant process and does it belong in-app?), container booking, water/ice/gas. Anything else?
- **Suppliers (narrowed)**: deposit + registration-fee amounts, the Supplier Agreement text, vetting criteria, and whether camp feedback on suppliers is visible to other camps or AB-only. (The procedure itself is now documented — see the Quaggapedia block above.)

**For the working group (us)**
- ~~Which vision leads the MVP?~~ Settled: Finlay's V1 + shared spine is the build; Graham's doc is ideation only (Ryan, 22 Jul 2026). Finlay is the active scoping contact.
- ~~Does AB pre-create camps?~~ Settled: no — participants self-register camps; approval is a per-edition attribute (Ryan, 22 Jul 2026).
- ~~Project-join mechanics~~ Settled: per-group joinability attribute — *accepting new members* (open) or *invite-only* (Camp 404 one-time invite links) (Ryan, 22 Jul 2026).
- Privacy details for unregistered/private groups are explicitly **up in the air** — schema reserves the setting; no gates built until it's a real problem.
- What exactly does the Burner Bio ask, and which aspects are private vs visible to camp leads / AB? (Fewer-forms test applies to the bio itself.)
- Product name: adopt "Quagga Portal"?
- How to keep Graham's *concerns* represented at kickoff without re-opening his feature list — the fewer-forms test is the neutral filter.

## Gaps & discrepancies

1. **The sign-on HTML prototype is still not in this repo.** Mentioned twice now; needs to be added before it can be reviewed.
2. ~~Stretch Tent Supplier orphan role~~ **Resolved**: stretch-tent providers are **suppliers** (camp-hired, supplier repository + portal), not AB contractors. Finlay's registration Section 6 free-text "suppliers list" becomes a structured declaration against the repository.
3. **Naming**: documents say "AfricaBurn"; the event is "AfrikaBurn". Standardise. "Quagga Portal" is the only proposed product name.
4. **Placement is load-bearing** for container booking (ERF-from-profile). MVP needs at minimum staff-assigned ERFs.
5. **Layout tool scope**: the Quagga doc's layout designer (two tools: camp layout + under-Bedouin tent packing, with collision/safety warnings and auto-arrange) is by far the largest single engineering item in either vision — effectively a small CAD app. It must not be allowed to block earlier releases.
6. **WhatsApp/SMS notifications** (Quagga §6) carry integration cost and consent requirements — deferred pending real demand.
