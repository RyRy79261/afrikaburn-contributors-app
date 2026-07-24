# Design Brief — AfrikaBurn Contributors App ("Quagga Portal")

*Functional design brief for the Pencil design pass. This document is the complete
inventory: every page, component, term, journey, state, and reference. The working
implementation exists and is running — this is a **redesign-over-a-real-app**, not
blue-sky. Verify anything against the code in this repo.*

---

## 0. THE ONE MANDATE — read this before anything else

**Design the component system FIRST. Then build every screen exclusively out of it.**

Do not design screens ad-hoc and extract components afterwards. The order is:

1. **Tokens** (§3 — already decided and shipped; treat as law, propose changes as explicit deltas)
2. **Tier-1 primitives** (§7.2 — every state of every base component)
3. **Tier-2 composites** (§7.3 — the app-specific components, built from Tier 1)
4. **Tier-3 patterns** (§7.4 — shells, form layouts, table layouts)
5. **Screens** (§8–§9 — assembled *only* from the above)

A screen that needs something the system doesn't have means the system gets a new
component first, with all its states, then the screen uses it. No orphan one-off
elements. Every component ships with: default / hover / focus-visible / active /
disabled / loading / error / empty states, in **both themes** (dark default + light)
and **both accents** (teal participant / apricot org), at **mobile (360px) and
desktop (1280px)** widths. Mobile-first: on-site usage is phones.

---

## 1. What this product is

A platform for AfrikaBurn theme camps. Two deployed apps, one design language:

- **Participant app** (`apps/web`, teal accent) — any burner signs up, completes a Burner Bio, browses the camp directory, creates or joins a camp, and (as a camp lead) completes the annual registration that earns the camp its entitlements.
- **Organiser console** (`apps/org`, apricot accent) — AfrikaBurn staff review registrations section-by-section, elevate accounts, vet suppliers, reconcile payment references. Deliberately a separate app: it must *feel* related but unmistakably distinct (accent, header treatment, density).

Product principles that shape design decisions:

- **Fewer forms, not more.** The product exists because people don't fill out forms. Every screen should feel lighter than the Google Form it replaces: progress that persists, sections in any order, prefill, short screens, honest progress indicators.
- **Anyone can organise; registration earns entitlements.** A camp exists the moment it's created (a "free camp"). Approval is an attribute, not a gate to existence. The free-vs-registered contrast is the core product story — design the dashboard so this difference is *legible at a glance*.
- **The platform never holds funds.** Money appears only as reference-and-status blocks ("we track, AB collects"). Never design anything that looks like a checkout.
- **Zero on-site connectivity** (future): flows will eventually work offline with QR handshakes. Nothing to design yet, but avoid patterns that assume always-on (e.g. don't make autosave feedback dependent on instant server echo).
- **Non-corporate.** This is a volunteer-built tool for a decommodified desert arts event. Warm, direct, a little playful. Never SaaS-sterile, never startup-breathless.

## 2. Users & roles

| Role | App | What they do | Design notes |
|---|---|---|---|
| **Burner** (base user) | web | Sign up, Burner Bio, browse directory, join a camp via invite | The default persona; may never lead anything |
| **Camp lead / admin** | web | Create camp, manage members + invites, complete registration, resubmit after feedback | Primary persona for the wizard |
| **Camp member ("camper")** | web | View their camp, leave | Read-mostly |
| **God admin** (Ryan, bootstrap) | org | Everything; elevates org staff | Rare, powerful — confirmations matter |
| **Org staff** | org | Review registrations, vet suppliers, reconcile payments | Efficiency persona: tables, filters, keyboard-friendly |
| *Future, visible as hints only:* supplier, contractor/driver, wrangler | — | — | Do not design their flows |

## 3. Brand foundation (shipped — treat as law)

Sampled from afrikaburn.org's Elementor kit. Full token file:
`packages/ui/src/styles/globals.css`; spec: `docs/build-spec.md` §7.

- **Brand ramp**: teal `#2D7696` · teal-deep `#235C75` · apricot `#F4B672` · peach `#FFBC7D` · sage `#B6D090` · olive `#7D9953` · charcoal `#333333` · warm white `#FFFAF2`
- **Dark theme (default)**: background `#17191B`, card `#1F2326`, muted `#262B2F`, border `#323A3F`, foreground `#F4F0E8`, muted-fg `#ADB6B3`; primary teal, accent apricot, success sage, warning apricot, destructive `#C24438`
- **Light theme**: warm white `#FFFAF2` background, white cards, charcoal text; **dark foregrounds on olive/apricot fills** (white text fails WCAG there — this is a hard rule)
- **Org accent skin**: primary flips to apricot (`#F4B672` dark / `#D98A2B` light with dark text)
- **Type**: **Montserrat** only (500 body / 600–700 UI / **800 UPPERCASE for h1–h2**, letter-spacing 0.01em). Self-hosted.
- **Motif**: **QuiltBand** — original repeating diamond band in teal/apricot/sage. Used on header top-edges and as section dividers. You may evolve the quilt language (corner motifs, empty-state art, pattern fills) — original geometry only.
- **Brand marks — APPROVED (Ryan, 24 Jul 2026)**: the real AfrikaBurn logo and San-hand emblem are in scope — assets live in [`design/brand/`](../design/brand/) (quilt wordmark banner 768×109 + 282×40 nav size, emblem at 270/192/32, footer icons). Header rule: the top QuiltBand spans the **entire page width edge-to-edge**, and the nav carries the real logo at left. Still forbidden: photography of identifiable people (event photo-consent culture) — illustrated/geometric art only.
- **Status color mapping** (used everywhere a status appears): draft→muted · submitted/under_review→teal · changes_requested→warning apricot · approved→success sage · rejected/withdrawn→destructive/muted · pending payment→muted · reconciled→sage · waived→outline
- Radius 0.5rem; WCAG AA minimum on every pair (already audited — keep it that way).

## 4. Voice & copy

- Warm, direct, second person. "Your camp exists — invite your people." not "Camp created successfully."
- Burn-literate but never gatekeeping: terms from §5 used naturally, explained inline on first encounter (e.g. tooltip or helper text on "WAP").
- Honest about what's parked: disabled tiles say *why* ("Containers get their own app — it's coming for the big camps"), never "coming soon" alone.
- Forms narrate progress: "4 of 6 sections complete. Any order. Nothing is lost."
- No lorem ipsum anywhere — the seed content (Mad Hatters, Camp 404, fictional camps) is the demo copy; write real microcopy in mocks.
- South African English (organiser, colour is fine either way, R for Rand).

## 5. Vocabulary (all the words — use these, never synonyms)

| Term | Meaning |
|---|---|
| **Burner** | Any user of the platform |
| **Camper** | A burner who is a member of a camp |
| **Burner Bio** | The per-year self-serve profile every burner completes at onboarding |
| **Group** | Anything joinable: the org, theme camps, (later: artworks, mutant vehicle teams) |
| **Theme camp / camp** | The main group kind |
| **Free camp** | A camp with no approved registration this edition — exists, works, no entitlements |
| **Registered camp** | Camp with an approved registration this edition — public/indexable, entitled |
| **Entitlements** | What registration unlocks: placement application, art grants, containers, water/ice/gas (mostly parked as hints) |
| **Edition** | The year namespace — "AfrikaBurn 2027 · 26 April – 2 May 2027" |
| **Registration** | The annual six-section submission a camp makes to AfrikaBurn |
| **The six sections** | Camp Identity · Leave No Trace · Participation & Gifting · Camp Size & Logistics · Sound & Placement · Suppliers & Commerce |
| **Section review** | Org feedback on one section: comment thread, open/resolved |
| **Org** | AfrikaBurn the organisation, modeled as a group; staff = org memberships |
| **God admin** | System-wide max privileges (bootstrap user) |
| **Lead / admin / member** | Camp membership roles |
| **Invite** | One-time link; kinds: member, lead-transfer. No kick — members leave voluntarily |
| **Joinability** | "Accepting new members" (open) vs "Invite only" — directory badge |
| **Supplier** | Camp-hired external provider (tents, power); on AB's official Suppliers List; vetting status: listed / registered / flagged |
| **Payment reference** | `QP-2027-MAH-001` style; statuses pending / reconciled / waived. Never a checkout |
| **WAP** | Work Access Pass — free early-entry pass, allocated to crew leads of registered projects |
| **SOOP** | Sound Out Of Place — the sound scale: **Level 1 = normal car stereo**, Level 2 = amplified "like a taxi", Level 3 = club/stadium |
| **MOOP** | Matter Out Of Place — Leave No Trace |
| **LNT** | Leave No Trace; each camp names an LNT lead (contact only, no account) |
| **Tankwa Town** | The event city; **Binnekring** = inner ring; **Buitekring** = outer; clock-radial streets "3-ish" |
| **Quaggafontein / Quagga** | The farm site; container storage; namesake of "Quagga Portal" |
| **Die Yskas** | The ice shop at Off-Centre Camp — the only thing sold at the event |
| **Plug-and-play** | Banned turnkey camping — acknowledged in registration Section 6 |
| **Attestation** | (Future) offline QR proof-of-interaction; today only a key fingerprint on the profile |
| **Wrangler** | (Future) org role babysitting camps' progress |
| **Collective** | (Future, parked) a camp of camps — e.g. Mad Hatters Village |

## 6. Naming & seed cast (use in mocks)

Product name candidate: **Quagga Portal** (undecided — design a neutral lockup: wordmark-friendly but works as "AfrikaBurn Contributors"). Apps: participant app has no sub-name; org app is the **"Organiser Console"**. Edition string everywhere: **AfrikaBurn 2027 · 26 April – 2 May 2027**. Seed camps for mocks: **Mad Hatters** (approved/registered), **Camp 404** (under review), fictional: *Dust Bunnies* (draft), *Karoo Kombuis* (changes requested), *The Long Drop Inn* (free camp), etc. Seed humans are obviously fictional (`dusty.prototype@example.com`, "Ren Notfound", "Alice Hatter"). Payment refs: `QP-2027-MAH-001`.

## 7. The component system

### 7.1 Tokens — shipped (§3). Start here; propose deltas explicitly.

### 7.2 Tier 1 — primitives (all exist as shadcn-based code; design every state)

`Button` (default/secondary/outline/ghost/destructive/link · sm/default/lg/icon) ·
`Badge` (default/secondary/outline/destructive + status colors) · `Card` (+header/
content/footer) · `Input` · `Textarea` (with live word-count variant) · `Select` ·
`Dialog` · `Table` (dense org variant needed) · `Tabs` · `Toast` (success/error/info).
Missing primitives to add to the system: `Checkbox`, `RadioGroup`, `Switch` (privacy
toggles), `Tooltip` (term explainers), `Skeleton` (loading), `EmptyState` (with quilt
art), `Breadcrumb` (org), `Pagination` (org tables), `Avatar` (initials-based — no
photos), `ProgressSteps` (wizard 6-section indicator).

### 7.3 Tier 2 — composites (exist in code; redesign from Tier 1)

| Component | File | What it does / states |
|---|---|---|
| `QuiltBand` | ui/quilt-band | Brand motif band; opacity variants; header + divider usage |
| `PaymentDetailsBlock` | ui/payment-details-block | Reference, optional amount (R), status badge, "AB collects" note |
| `DisabledHintTile` | ui/disabled-hint-tile | Parked-feature tile: name, one-line why, lock affordance; must look intentional, not broken |
| `AppShell` / `ConsoleHeader`+`ConsoleNav` | web/org | Nav, edition banner, user menu, QuiltBand edge; org variant denser + apricot |
| `NotConfiguredBanner` | both | Env-less boot state — calm, not alarming |
| `QuestionnaireRunner` + `Field` | web/questionnaire/* | Data-driven form runner (Burner Bio): text/textarea/select/multi/consent fields, per-field privacy step, hard-locked rows (visibly locked + why), progress |
| `PrivacyToggles` / `PrivacyForm` | web | Per-field public/private switches; hard-locked fields rendered locked |
| `RegistrationWizard` | web/registration/* | Six-section any-order wizard: section nav with completeness ticks, autosave indicator ("Saved just now"), submit gate (disabled until 6/6 + missing list), 60-word counter |
| `FieldKit` | web/registration/field-kit | Registration field primitives incl. SOOP sound-level select (3 levels + descriptions), placement preference selects, operating-hours multi-select |
| `LayoutUploads` | web/registration | Up to 4 layout images; upload or URL fallback; thumbnail grid |
| `SupplierPicker` | web/registration | Multi-select from AB Suppliers List + free-text note; vetting badge per supplier |
| `RegistrationSummary` | web/registration | Read-only post-submit view: status banner, sections with feedback threads, resubmit CTA |
| `SectionReviewThread` | org | Per-section comment thread; open/resolved state; camp-side + org-side variants |
| `DecisionPanel` | org | Approve / request changes / reject (+reason); confirmation affordances |
| `RegistrationFilters` | org | Status / sound level / new-vs-returning filters above the table |
| `StatusBadges` | org | Status → color mapping (§3) |
| `AccountActions` | org | Elevate/demote org_staff (god only) + audit note |
| `SupplierVettingSelect` / `AddSupplierForm` | org | Vetting status control; manual supplier add |
| `PaymentActions` | org | Mark reconciled / waived |
| `CampInvites` | web | Create/revoke invite links (member + lead-transfer), copy-link, expiry display |
| `CreateCampForm` | web | Name (with live dedupe: exact = blocked, similar = warning "Did you mean…"), 60-word description counter, joinability choice |
| `JoinButton` / `LeaveCampButton` / `SignOutButton` | web | Single-action affordances with confirm on leave |
| `GateScreen` | org | The polite wall for non-staff |
| `PageHeading` / `FieldList` | org | Console typography + read-only field display |

### 7.4 Tier 3 — patterns

Form page (single column, generous rhythm) · Wizard layout (section rail + content) ·
Console table page (heading, filters, dense table, pagination) · Detail/review page
(two-column: content + action rail) · Auth pages (QuiltBand, minimal) · Gated/empty/
error page patterns · Landing page (the only "marketing" surface).

## 8. Pages — participant app (`apps/web`, teal)

| Route | Purpose | Key content & components | States to design |
|---|---|---|---|
| `/` | Landing + gateway | Edition banner, value prop ("Your camp, one place"), sign-in/up CTAs, QuiltBand; signed-in: redirect-style dashboard of "your camps" + directory link | signed-out · signed-in-no-bio (push to onboarding) · signed-in · not-configured |
| `/auth/*` | Sign in/up | Neon Auth screens themed to system | default · error |
| `/onboarding` | Burner Bio | QuestionnaireRunner: intro step ("takes 3 minutes, yours to control"), fields, privacy step with hard-locked rows, done step | fresh · partially-saved · complete |
| `/profile` | Own profile | Bio view/edit, privacy toggles, key fingerprint (small, technical, explained), sign-out | view · edit · saving |
| `/directory` | Public camp directory | Search, camp cards (name, 60-word blurb, joinability badge, registered mark), member-only free camps section | results · empty search · no camps yet |
| `/camps/new` | Create camp | CreateCampForm | clean · dedupe-warning · dedupe-blocked · created→redirect |
| `/camps/[slug]` | Camp dashboard — **the core screen** | Header (name, registered/free state, edition), registration status tile with CTA, member list (roles, Avatar initials), CampInvites (lead only), PaymentDetailsBlock, hint tiles row: Containers ("separate app — for the big camps") · Water/Ice/Gas ("pending AfrikaBurn input") · Placement & Art grants ("entitlement — process TBC") · Shifts/Budget/Layout ("topics under exploration") | member view vs lead view · free vs registered · registration in each of 7 statuses · non-member view of registered camp (public, NO emails) |
| `/camps/[slug]/registration` | The six-section wizard | RegistrationWizard + FieldKit + LayoutUploads + SupplierPicker; autosave; submit gate | per-section empty/partial/complete · submit-blocked (missing list) · submitting · post-submit summary · changes-requested (feedback threads + resubmit) · approved (celebratory but calm) |
| `/join/[token]` | Invite redemption | Camp teaser + accept; handles used/expired token | valid-member · valid-lead-transfer (explicit "you will become lead") · used · expired · signed-out |

## 9. Pages — Organiser Console (`apps/org`, apricot)

| Route | Purpose | Key content & components | States |
|---|---|---|---|
| `/auth/*` + GateScreen | Staff entry | Themed auth + polite wall for non-staff | wall · not-configured |
| `/` | Overview | Count cards: registrations by status, camps, suppliers, pending payments; QuiltBand header | zero-data · seeded |
| `/registrations` | Review queue | RegistrationFilters + dense Table (camp, status, sound level, new/returning, submitted date) | filtered-empty · loaded |
| `/registrations/[id]` | **The review screen** | Full read-only submission (six sections via FieldList), SectionReviewThread per section, DecisionPanel action rail, audit note | under-review · with-open-threads · decided (approved/rejected) · resubmitted-diff emphasis |
| `/accounts` | Elevation | User search, role display, AccountActions (god only) | god view · staff (read-only) view · confirm dialog |
| `/suppliers` | Supplier repository | Table (name, services, source badge "AB sheet"/manual, vetting select), AddSupplierForm | list · adding |
| `/payments` | Reference reconciliation | Table of PaymentDetailsBlocks/rows, PaymentActions | pending-heavy · reconciled |

## 10. User journeys (design end-to-end, number the screens)

1. **First contact → belonging**: land → sign up → Burner Bio (with privacy moment) → directory → open a registered camp's public page → dead-ends politely ("ask a lead for an invite").
2. **Founder**: sign up → bio → create camp (hit the similarity warning once) → camp exists instantly → copy invite link → member joins via `/join/[token]` → dashboard shows both.
3. **Registration — the golden path**: lead opens dashboard → "Begin registration" → completes six sections across two sittings (autosave!) → submit gate shows missing sections → completes → submits → status tile flips.
4. **Review loop**: org staff opens queue → filters submitted → reviews Karoo Kombuis → requests changes on Sound & Placement with a comment → camp lead sees feedback thread → edits → resubmits → org approves → camp flips to **registered**, entitlement tiles light up.
5. **Lead transfer**: lead creates lead-transfer invite → successor accepts → roles swap → old lead is admin.
6. **Org bootstrapping**: god signs in (GOD_EMAILS) → console → elevates a second account → audit trail visible.
7. **Payments narration**: registered camp's dashboard shows `QP-2027-MAH-001` pending → org marks reconciled → camp side shows reconciled. (No money moves — make this visually obvious.)
8. **Leaving**: member leaves a camp (confirm) → camp gone from their landing.

## 11. State machines (statuses drive most UI — design each state's look once, in the system)

- **Registration**: draft → submitted → under_review → (approved | changes_requested → *submitted again* | rejected); withdrawn from any pre-decision state. 7 states, colors in §3.
- **Section review thread**: open ↔ resolved.
- **Invite**: active → used | expired | revoked.
- **Membership role**: member ↔ admin ↔ lead (lead only via transfer).
- **Payment**: pending → reconciled | waived.
- **Supplier vetting**: listed → registered | flagged.

## 12. Cross-cutting screen states (every page defines these)

Not-configured (env-less demo boot) · signed-out · signed-in-but-no-bio (hard gate →
onboarding) · loading (Skeleton, no spinners-only) · empty (EmptyState with quilt art +
one action) · error (honest, recoverable) · mobile 360px (every screen) · light theme
(every screen) · org-accent (every org screen).

## 13. References (all of it, in this repo)

- **Running app**: `pnpm install && pnpm --filter @quagga/web dev` (:3000), `--filter @quagga/org dev` (:3001) — boots env-less
- **Tokens/spec**: `packages/ui/src/styles/globals.css`, `docs/build-spec.md` (§7 theme, routes, schema)
- **Product docs**: `docs/synthesis.md` (vocabulary, decisions), `docs/mvp-proposal.md`, `docs/roadmap.md`
- **The real form being replaced**: `docs/sources/scope-theme-camp-registration.txt` (every field, section by section)
- **Event ground truth**: `docs/sources/quaggapedia/` — 68 pages + `files/` (2026 event map, sound maps, supplier rules, STAR onboarding PDF). Good for tone, terminology, and empty-state flavor text
- **Brand source**: afrikaburn.org (Elementor kit sampled; assets in scratchpad, palette in §3)
- **Design-quality bar**: github.com/ryry79261/camp-404 — same author, same stack; its token architecture and component discipline are the standard to meet
- Fonts: Montserrat (Google Fonts, self-hosted via next/font)

## 14. Deliverables & acceptance

1. **The component library page(s) first** — every Tier 1–3 component, every state, both themes, both accents. This is the acceptance gate for everything after.
2. All §8/§9 screens at 360px and 1280px, dark + light, assembled only from the system.
3. The 8 journeys as connected flows (§10).
4. A short "deltas" note listing anything you changed about tokens/type/motif and why.
5. Original artwork only (quilt-derived); no AB marks; no identifiable-people photography; WCAG AA on all pairs.
6. Naming in mocks matches §5/§6 exactly — the words are part of the design.
