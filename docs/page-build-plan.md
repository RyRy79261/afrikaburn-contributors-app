# Page Build Plan — one task per page, components first

*Ryan, 25 Jul 2026. Every canvas page frame → an implementation task. Prereqs:
docs/component-spec.md (Tier 1-3 components) and the platform/database decision
(docs/platform-architecture-spec.md) land FIRST. Specs referenced are the law for
each page; the canvas frame (desktop + mobile 360 pair) is the visual contract;
`design/qa/audit.py --sections <frameId>` lists a frame's exact composition.*

Status key: ✅ implemented (pre-design-pass code exists, needs reconcile vs canvas) ·
🆕 not implemented.

## apps/web (participant)

| Page | Frame (desktop/mobile) | Spec | Status |
|---|---|---|---|
| Landing | L82AQr / R8zPnr | build-spec routes | ✅ reconcile (copy fix: no payment refs) |
| Auth (sign up/in) | u87N7 / HCt1i | build-spec + accounts-security | ✅ reconcile |
| Onboarding (Burner Bio) | h3ak0 / Z2300W | build-spec §6b Bio v3 | ✅ reconcile (years chips, phone, emergency contacts, hard-locks) |
| Profile | C313E / SdcDN | build-spec Bio | ✅ reconcile |
| Burner Profile (3rd-party) | mm31G / lYUEe | synthesis (public fields only) | 🆕 |
| Directory | u7RSIJ / D0LTCb | build-spec + camp categories | ✅ reconcile (category chips) |
| Create a camp | g5Uqfw / Evh1t | build-spec (3 fields, red-line) | ✅ reconcile |
| Join a camp (invite) | qhcHh / MttcT | build-spec invites | ✅ reconcile |
| Camp Dashboard | RGcNS / EQW5G | build-spec (+ ref codes, pinned bulletin) | ✅ reconcile |
| Registration Wizard | RBIDd / XAJSe | build-spec 6 sections | ✅ reconcile |
| Registration Feedback | P0Tcl / QzpU6 | build-spec | ✅ reconcile |
| MV Registration | S8ZcWf / Qq5u0 | Quaggapedia DMV/SOOP | 🆕 |
| Art Registration | d3pOJI / H2DP4 | Quaggapedia grants | 🆕 |
| Camp Settings · Roles & Officers | ZyKzw / TIrbC | questionnaire-spec Roles v2 | 🆕 (core done in @quagga/core; UI new) |
| Camp Questionnaires | Hameq / YOdgW | questionnaire-spec | ✅ reconcile (gates, audiences) |
| Questionnaire Runner v2 | uj2yF / M6JCN | questionnaire-spec Builder v2 | 🆕 |
| Questionnaire Gate | qKG3g / TOUE1 | questionnaire-spec blocking | ✅ reconcile |
| Forgot Password | Gf1iJ / s2PAS | accounts-security | 🆕 |
| Account · Manage / Security / Delete | SjInE·G35eq·Q3pQj6 / U6ixd·JbB35·Ur0rS | accounts-security | 🆕 (shared across apps) |
| Notifications | X6YN3 / qLjMS | notifications-spec | 🆕 |
| Bulletin view | R6l2G / d7HlH | notifications-spec | 🆕 |

## apps/org (console)

| Page | Frame | Spec | Status |
|---|---|---|---|
| Org gate | T7siQ9 / E5Oip | build-spec god/org roles | ✅ reconcile |
| Overview | obd4x / pKW7z | overhauled 25 Jul (no payments) | 🆕 rebuild to new design |
| Status Board | RTfFF / w6X0wA | org stats spec (new 4-card KPIs) | 🆕 |
| Registrations queue | StJXH / NkPRL | build-spec review flow | ✅ reconcile |
| Review (registration) | PRDdG / t4Ji4 | build-spec + wrangler assign | ✅ reconcile |
| Accounts (god elevate) | CJs0P / y1idvL | build-spec god admin | ✅ reconcile |
| Suppliers | iQEpd / hSNjO | supplier-spec (standing, n/7, notes) | ✅ reconcile |
| Supplier Sign-up Mgmt | U7929T / D6IGel | accounts-security supplier docs | 🆕 |
| Camp Categories | g4CzsM / X8RHa | build-spec categories | 🆕 |
| Org Questionnaires | JY7dF / XY8yO | questionnaire-spec audiences | 🆕 |
| Questionnaire Builder v2 | sCEHP·AssNH / ELUfI·ZBw8O | questionnaire-spec Google-Forms parity | 🆕 |
| Results v2 | Mjiqz / nRtO7 | questionnaire-spec | 🆕 |
| Bulletins list + Compose | QqnNq·U8CqE / laWqH·zW1uE | notifications-spec | 🆕 |
| Org Notifications | xRjgy / Cb5MV | notifications-spec | 🆕 |

## apps/suppliers

| Page | Frame | Spec | Status |
|---|---|---|---|
| Sign up / Sign in | K3zNk·OX6KJ / h83pUG·xgCd7 | accounts-security supplier | 🆕 (sign-in exists; redesign) |
| Onboarding checklist (+docs panel) | Q4fye / lm3jO | supplier-spec 7 steps | ✅ reconcile (docs panel new) |
| Standing | R4wvO / TXyLN | supplier-spec | ✅ reconcile |
| Notifications | swSq4 / OSqoc | notifications-spec | 🆕 |

## Sequencing

1. Platform/database restructure (architecture spec) — BLOCKS everything below
2. Component tiers (component-spec build order)
3. Reconcile pass over ✅ pages (existing code vs canvas — mostly chrome/bell/copy)
4. 🆕 pages in priority order for the kickoff narrative: Account suite → Notifications
   set → Builder v2 → Bulletins → MV/Art registrations → Categories/Stats → the rest
