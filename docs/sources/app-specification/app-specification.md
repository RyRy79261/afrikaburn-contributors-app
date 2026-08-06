# App Specification

Source document: https://docs.superhuman.com/d/App-Specification_dQ_I7n93cZT/App-Specification_suoUXVqN#_lu-AoJfG
Document ID: Q_I7n93cZT
Exported: 2026-07-29

---

## App Specification

## Document Structure

- [App Spec Change Record](app-specification/app-spec-change-record.md)
- [Requirement Index](app-specification/requirement-index.md)
- [Decisions Record](decisions-record.md)
- [Task Assignment](task-assignment.md)
- [Member List](member-list.md)
- [Links](links.md)

> Source of Truth Master document for app features.
>
> All changes must be documented in https://coda.io/d/_dQ_I7n93cZT/_suiEB2Mp

# Quagga Portal App Platform

# 1. Product Purpose 🚧

🚧 **Status:** In progress
📋 **Context:** The MVP currently delivers registration/review and strong identity/security foundations, while several camp-management modules in this section remain incomplete.

Quagga Portal App is a management platform for theme camps, villages, collectives and creative projects attending AfrikaBurn or similar participatory Burner events.

The platform must reduce repetitive administration, improve participant onboarding, simplify annual registration and placement submissions, and give camps practical tools to manage their people, budgets, shifts, tickets, Work Access Passes and physical camp layouts.

The system must be modular, but every registered camp must receive the same essential management tools.

More advanced Village, collaboration and creative-project functions can be activated through the settings dashboard.

## Development Direction ⚠️

⚠️ **Status:** At risk
📋 **Context:** Direction is not fully converged. Decision 002 keeps architecture open pending AfrikaBurn feedback, and Decision 004's placement/container demo focus is not yet reflected in shipped placement tooling. Group-chat context: Fin argued for separate compulsory-org vs broader camp-planning app boundaries (2026-07-22 09:56), and Graeme acknowledged those concerns as valid (2026-07-22 10:42). Open decision: [Decision 007](decisions-record/decision-007-proposed-application-boundary-strategy-org-vs-camp-flows.md).

The platform should remain modular, with a clear split between:

- **PURPOSE-001** Core camp-management capabilities that every registered camp receives.
- **PURPOSE-002** Optional or expanded community-led features that can be enabled later for Villages or creative projects.

For the current development cycle, the first demonstrable slice should focus on placement tools and container-related management so the team can show practical value early.

The architecture integration strategy for organizational and non-organizational needs remains open pending further feedback from AfrikaBurn.

Offline functionality should be restricted to the container, gas, and water organization projects unless a later decision expands that scope.

For users who do not want or cannot use the full interface, the platform should support a simplified fallback path for the minimum mandatory submission and placement flows.

---

# Implementation Status Tracking

This document now tracks implementation directly inside each feature section.

Status labels used throughout:

- ✅ Implemented
- 🚧 In progress
- ❌ Not implemented
- ⚠️ At risk (directional divergence, unresolved decision, or critical dependency risk)

Cross-references:

- Change history: [App Spec Change Record](app-specification/app-spec-change-record.md)
- Requirement-level index: [Requirement Index](app-specification/requirement-index.md)
- Architecture/technical mandates: [Decisions Record](decisions-record.md)
- Work ownership: [Task Assignment](task-assignment.md)

## Requirement ID Conventions

Every individual requirement bullet in this document carries a stable ID in the form `PREFIX-NNN` (e.g. `WAP-003`), bolded inline immediately before the requirement text. IDs make it possible to cite an exact requirement from `task-assignment.md`, a decision record, a Jira ticket, or a code comment, and to see at a glance when something in the spec is added, changed, or removed.

Rules:

- **Prefix per section.** Each numbered section (2–21) has one fixed prefix, listed below. Section 1's prefix (`PURPOSE`) covers the one substantive bullet list under "Development Direction"; the rest of Section 1 is narrative and untagged.
- **Append-only, never renumbered.** A new requirement added to a section always takes the next unused number for that prefix. Existing IDs are never renumbered or reused, even after removals, so a reference made today stays valid.
- **Removed, not deleted.** A requirement that no longer applies is struck through in place (`~~text~~`) and annotated `(Removed — see Change Record <date>)`. The ID itself keeps its row in the [Requirement Index](app-specification/requirement-index.md), marked `Removed`, so old references resolve to an explanation instead of a silent gap.
- **Scope.** Only substantive specification bullets (fields, capabilities, objects, categories, workflow states) are tagged. Document-structure links, the status-label legend, cross-reference lists, and section-level "Context" commentary bullets are not requirements and are left untagged.
- **Change Record entries should cite IDs.** When editing this spec, name the specific `PREFIX-NNN` IDs added, changed, or removed in the corresponding [App Spec Change Record](app-specification/app-spec-change-record.md) entry, rather than only describing the change in prose.

Prefix reference:

| Prefix | Section |
| --- | --- |
| PURPOSE | 1. Product Purpose |
| CORE | 2. Core Modules Required for Every Camp |
| ONBOARD | 3. Camper Onboarding |
| CDB | 4. Camper Database and Camp List |
| STATS | 5. Camper Statistics |
| SHIFT | 6. Shift Management |
| BUDGET | 7. Working Budget and Financial Tracking |
| PAY | 8. Camp Fees and Payment Gateway |
| WAP | 9. Work Access Pass Allocation |
| TICKET | 10. Ticket Allocation and Ticket Status |
| LAYOUT | 11. Theme-Camp Layout Tool |
| TENT | 12. Private Tent Placement Under Bedouin Tents |
| ERF | 13. AfrikaBurn Map and Erf Placement |
| REG | 14. Annual Registration and Placement Submission |
| PREVYR | 15. Previous-Year Submissions |
| PNP | 16. Plug-and-Play and Turnkey Camp Prevention |
| VILLAGE | 17. Village Functionality |
| CREATIVE | 18. Creative Project Mode |
| SEC | 19. Permissions and Security |
| RELEASE | 20. Suggested First Development Release |
| PRINCIPLE | 21. Core Development Principle |

---

# 2. Core Modules Required for Every Camp 🚧

🚧 **Status:** In progress
📋 **Context:** Current per-module state in MVP:
- Camper onboarding — In progress
- Camper database and camp list — At risk
- Shift management — Not implemented
- Working budget and financial tracking — In progress
- Work Access Pass allocation — In progress
- Ticket allocation and camper ticket status — At risk
- Tent allocation and placement under Bedouin tent — Not implemented
- Theme-camp placement and layout design — At risk
- Annual registration and placement submission — In progress
- Previous-year submission records and duplication — In progress
- Camp reporting and statistics — Not implemented

Every theme camp or collective must have access to the following tools:

1. **CORE-001** Camper onboarding

1. **CORE-002** Camper database and camp list

1. **CORE-003** Shift management

1. **CORE-004** Working budget and financial tracking

1. **CORE-005** Work Access Pass allocation

1. **CORE-006** Ticket allocation and camper ticket status

1. **CORE-007** ?Tent allocation and placement under Bedouin tent

1. **CORE-008** Theme-camp placement and layout design

1. **CORE-009** Annual registration and placement submission

1. **CORE-010** Previous-year submission records and duplication

1. **CORE-011** Camp reporting and statistics

These are the minimum required functions and should not depend on whether the camp is operating independently or as part of a Village.

---

# 3. Camper Onboarding 🚧

🚧 **Status:** In progress
📋 **Context:** MVP has platform-level self-serve onboarding, but camp-authored onboarding content and workflows are not yet implemented.

Each camp must be able to create a structured onboarding process for new and returning campers.

The onboarding process should include:

- **ONBOARD-001** Camp introduction
- **ONBOARD-002** Camp culture
- **ONBOARD-003** Camp rules
- **ONBOARD-004** AfrikaBurn principles
- **ONBOARD-005** Participation expectations
- **ONBOARD-006** Build responsibilities
- **ONBOARD-007** Strike responsibilities
- **ONBOARD-008** Shift requirements
- **ONBOARD-009** Leave No Trace requirements
- **ONBOARD-010** Consent and behaviour policies
- **ONBOARD-011** What the camp provides
- **ONBOARD-012** What campers must provide themselves
- **ONBOARD-013** Payment terms
- **ONBOARD-014** Required agreements and acknowledgements

Camp administrators must be able to:

- **ONBOARD-015** Add written information
- **ONBOARD-016** Add videos
- **ONBOARD-017** Upload documents
- **ONBOARD-018** Create required acknowledgements
- **ONBOARD-019** Set compulsory onboarding steps
- **ONBOARD-020** Track onboarding completion
- **ONBOARD-021** Prevent incomplete campers from being marked as fully registered
- **ONBOARD-022** Update onboarding content annually

The system should distinguish between:

- **ONBOARD-023** New campers
- **ONBOARD-024** Returning campers
- **ONBOARD-025** Camp leads
- **ONBOARD-026** Build participants
- **ONBOARD-027** Strike participants
- **ONBOARD-028** Service providers

Returning campers should not need to repeat unchanged onboarding material unnecessarily. Administrators should be able to require only new or updated sections each year.

---

# 4. Camper Database and Camp List ⚠️

⚠️ **Status:** At risk
📋 **Context:** Direction divergence. MVP uses self-owned Burner Bios with camp rosters, while this section specifies admin-managed camper records. Group-chat context: Ryan framed a shared cross-year burner profile model for reuse across apps (2026-07-24 16:41). Open decision: [Decision 008](decisions-record/decision-008-proposed-canonical-camper-data-model.md).

> 📝 **Note (2026-07-29):** The MVP implements the inverse model — self-owned camper profiles ("Burner Bios") attached to camp rosters, rather than admin-managed records. Whether camps need admin-managed identity records remains open pending AfrikaBurn's data-posture input.

Each camp must have a secure camper database.

The camper record should include:

- **CDB-001** Full name as shown on ID or passport
- **CDB-002** South African ID number or passport number
- **CDB-003** Nationality
- **CDB-004** Email address
- **CDB-005** Mobile number
- **CDB-006** Emergency contact
- **CDB-007** Profile photograph
- **CDB-008** Optional Burner photograph
- **CDB-009** Burner name
- **CDB-010** Camp role
- **CDB-011** Arrival date
- **CDB-012** Departure date
- **CDB-013** Build attendance
- **CDB-014** Strike attendance
- **CDB-015** Shift commitments
- **CDB-016** Work Access Pass status
- **CDB-017** Ticket status
- **CDB-018** Camp-fee status
- **CDB-019** ?Village fee status is applicable
- **CDB-020** Onboarding status
- **CDB-021** Agreements signed
- **CDB-022** Previous event participation
- **CDB-023** Relevant skills
- **CDB-024** External AfrikaBurn volunteer roles encouraged and noted
- **CDB-025** Notes visible only to authorised administrators

The system must allow administrators to:

- **CDB-026** Add campers
- **CDB-027** Invite campers to complete their own profiles
- **CDB-028** Edit camper records
- **CDB-029** Import campers from a spreadsheet
- **CDB-030** Export camper lists
- **CDB-031** Filter campers
- **CDB-032** Search campers
- **CDB-033** identify missing information
- **CDB-034** Identify duplicate records
- **CDB-035** Carry returning camper details into the following year
- **CDB-036** Archive campers without permanently deleting historical records

Sensitive identity information must be protected through:

- **CDB-037** Encryption
- **CDB-038** Restricted permissions
- **CDB-039** Masked ID and passport numbers
- **CDB-040** Audit logs
- **CDB-041** Secure access controls
- **CDB-042** Defined data-retention periods
- **CDB-043** POPIA-compliant consent and processing

Ordinary campers must never be able to view another camper’s identity number, passport number, payment information or private administrative notes.

---

# 5. Camper Statistics ❌

❌ **Status:** Not implemented
📋 **Context:** Camp-admin statistical dashboards are not yet delivered.

Each camper record should generate participation statistics.

These may include:

- **STATS-001** Number of previous Burns attended
- **STATS-002** Number of years with the camp
- **STATS-003** Number of shifts completed
- **STATS-004** Number of shifts missed
- **STATS-005** Build participation
- **STATS-006** Strike participation
- **STATS-007** Internal camp volunteering
- **STATS-008** External AfrikaBurn volunteering
- **STATS-009** Fees paid
- **STATS-010** Fees outstanding
- **STATS-011** Onboarding completion
- **STATS-012** Ticket status
- **STATS-013** Work Access Pass history
- **STATS-014** Camp roles held
- **STATS-015** Skills volunteered
- **STATS-016** Training completed

Camp administrators should have dashboard statistics showing:

- **STATS-017** Total campers
- **STATS-018** New campers
- **STATS-019** Returning campers
- **STATS-020** Paid campers
- **STATS-021** Outstanding payments
- **STATS-022** Completed onboarding
- **STATS-023** Incomplete onboarding
- **STATS-024** Build-team numbers
- **STATS-025** Strike-team numbers
- **STATS-026** Filled shifts
- **STATS-027** Unfilled shifts
- **STATS-028** Allocated tickets
- **STATS-029** Unallocated tickets
- **STATS-030** Allocated Work Access Passes
- **STATS-031** Available Work Access Passes

Camper statistics should support planning and administration. They should not become a public scoring or popularity system.

---

# 6. Shift Management ❌

❌ **Status:** Not implemented
📋 **Context:** No shift scheduling/attendance model or workflows are implemented in MVP.

Each camp must have a shift-management system.

Administrators should be able to:

- **SHIFT-001** Create shifts
- **SHIFT-002** Create repeating shifts
- **SHIFT-003** Set dates and times
- **SHIFT-004** Set shift duration
- **SHIFT-005** Define the number of participants required
- **SHIFT-006** Assign a shift lead
- **SHIFT-007** Define required skills
- **SHIFT-008** Limit shifts to specific roles
- **SHIFT-009** Mark shifts as compulsory or optional
- **SHIFT-010** Open shifts to the whole camp
- **SHIFT-011** Open shifts across a Village
- **SHIFT-012** Assign campers manually
- **SHIFT-013** Allow self-sign-up
- **SHIFT-014** Track attendance
- **SHIFT-015** Record late cancellations
- **SHIFT-016** Record no-shows

Campers should be able to:

- **SHIFT-017** View available shifts
- **SHIFT-018** Sign up for shifts
- **SHIFT-019** View their personal schedule
- **SHIFT-020** Request a shift swap
- **SHIFT-021** Offer a shift to another camper
- **SHIFT-022** Accept a shift offered by another camper
- **SHIFT-023** Request administrator approval where required
- **SHIFT-024** Receive reminders
- **SHIFT-025** Receive alerts when their shift changes

Reminder options should include:

- **SHIFT-026** In-app notifications
- **SHIFT-027** Email
- **SHIFT-028** WhatsApp, subject to integration availability and consent
- **SHIFT-029** SMS as an optional paid service

The system should prevent shift swaps from being completed unless the replacement camper accepts the shift and meets any required role or skill conditions.

---

# 7. Working Budget and Financial Tracking 🚧

🚧 **Status:** In progress
📋 **Context:** Not yet built, but actively scoped; budgeting ownership/discovery has started in team discussions.

Every camp must receive a dynamic working budget.

The budget should be customisable but based on standard theme-camp categories and the Mad Hatters Village budget structure.

> 📝 **Note (2026-07-29):** Not yet built in the MVP. Ruchir volunteered to look into budgeting (group chat, 2026-07-28 20:34). Graeme shared the Mad Hatters Village budget spreadsheet as the reference structure and raised additional requirements — invoice scanning, real-time spend tracking, reimbursements, and NPC/PBO-grade bookkeeping (group chat, 2026-07-29 11:31–11:36).

The budgeting system must include:

- **BUDGET-001** Proposed budget
- **BUDGET-002** Approved budget
- **BUDGET-003** Actual income
- **BUDGET-004** Actual expenditure
- **BUDGET-005** Committed expenditure
- **BUDGET-006** Forecast final expenditure
- **BUDGET-007** Outstanding payments
- **BUDGET-008** Cash available
- **BUDGET-009** Variance against budget
- **BUDGET-010** Cost per camper
- **BUDGET-011** Contingency
- **BUDGET-012** Surplus or shortfall

Income categories may include:

- **BUDGET-013** Camp dues
- **BUDGET-014** Village dues
- **BUDGET-015** Fundraising
- **BUDGET-016** Donations
- **BUDGET-017** Grants
- **BUDGET-018** Sponsorship
- **BUDGET-019** Ticket-related contributions
- **BUDGET-020** Transport contributions
- **BUDGET-021** Other income

Expense categories may include:

- **BUDGET-022** Tents and structures
- **BUDGET-023** Transport
- **BUDGET-024** Storage
- **BUDGET-025** Containers
- **BUDGET-026** Power
- **BUDGET-027** Solar
- **BUDGET-028** Generators
- **BUDGET-029** Water
- **BUDGET-030** Showers
- **BUDGET-031** Toilets
- **BUDGET-032** Kitchens
- **BUDGET-033** Refrigeration
- **BUDGET-034** Bars
- **BUDGET-035** Sound
- **BUDGET-036** Lighting
- **BUDGET-037** Décor
- **BUDGET-038** Art
- **BUDGET-039** Fire and gas
- **BUDGET-040** Labour
- **BUDGET-041** External services
- **BUDGET-042** Security
- **BUDGET-043** Insurance
- **BUDGET-044** Equipment
- **BUDGET-045** Waste
- **BUDGET-046** MOOP
- **BUDGET-047** Build
- **BUDGET-048** Strike
- **BUDGET-049** Contingency

Camp administrators must be able to change:

- **BUDGET-050** Camp name
- **BUDGET-051** Number of campers
- **BUDGET-052** Camper fee
- **BUDGET-053** Cost assumptions
- **BUDGET-054** Budget categories
- **BUDGET-055** Shared Village costs
- **BUDGET-056** External-service costs

Changes must automatically update:

- **BUDGET-057** Total projected income
- **BUDGET-058** Total projected expenditure
- **BUDGET-059** Per-camper costs
- **BUDGET-060** Budget variance
- **BUDGET-061** Cash available
- **BUDGET-062** Camp financial dashboard

The system must allow the camp to move from proposed figures to actual figures without deleting or overwriting the original approved budget.

---

# 8. Camp Fees and Payment Gateway ⚠️

⚠️ **Status:** At risk
📋 **Context:** Direction divergence. MVP records payment references/status but avoids fund processing, while this section requires an integrated payment gateway. Group-chat context: payment, store, and operating-cost ownership concerns were raised and remain unresolved (Ryan/Fin, 2026-07-22 16:58–17:02). Open decision: [Decision 009](decisions-record/decision-009-proposed-payment-direction-tracking-vs-gateway.md).

> 📝 **Note (2026-07-29):** Unresolved. The MVP deliberately never holds or processes money — it records payment references and reconciliation status only. A gateway would only be considered if AfrikaBurn requests one, and for AfrikaBurn-side fees rather than camp dues.

The system should include a payment gateway for:

- **PAY-001** Camp dues
- **PAY-002** Village dues
- **PAY-003** Deposits
- **PAY-004** Instalments
- **PAY-005** Fundraising contributions
- **PAY-006** Transport charges
- **PAY-007** Optional services
- **PAY-008** Refunds
- **PAY-009** Credits

Each camper should see:

- **PAY-010** Amount due
- **PAY-011** Amount paid
- **PAY-012** Outstanding balance
- **PAY-013** Due dates
- **PAY-014** Instalment schedule
- **PAY-015** Receipts
- **PAY-016** Refunds
- **PAY-017** Credits

Payments should automatically update:

- **PAY-018** Camper payment status
- **PAY-019** Camp income
- **PAY-020** Budget actuals
- **PAY-021** Financial reporting

Administrators must also be able to record EFT, cash or manually reconciled payments.

---

# 9. Work Access Pass Allocation 🚧

🚧 **Status:** In progress
📋 **Context:** MVP only captures requested counts in registration; full per-camper allocation workflow is not yet implemented.

The platform must provide a Work Access Pass allocation tool.

Camp administrators should be able to:

- **WAP-001** Record the number of Work Access Passes granted
- **WAP-002** Create Work Access Pass categories
- **WAP-003** Allocate passes to eligible campers
- **WAP-004** Record arrival and departure dates
- **WAP-005** Record build or strike responsibilities
- **WAP-006** Prevent duplicate allocations
- **WAP-007** Identify campers with incomplete information
- **WAP-008** Track approval status
- **WAP-009** Export allocation lists
- **WAP-010** Submit data to the ticketing or AfrikaBurn system where integration is available

Work Access Pass eligibility may be linked to:

- **WAP-011** Build-team participation
- **WAP-012** Strike-team participation
- **WAP-013** Functional roles
- **WAP-014** Approved arrival date
- **WAP-015** Onboarding completion
- **WAP-016** Ticket status
- **WAP-017** Camp-fee status

The camp should be able to define its own internal approval process, while AfrikaBurn retains final approval over official Work Access Passes.

---

# 10. Ticket Allocation and Ticket Status ⚠️

⚠️ **Status:** At risk
📋 **Context:** Unresolved direction. MVP has no ticket module and assumes Quicket remains system-of-record; this section requires camp-side allocation tooling. Group-chat/kick-off context: ticketing was explicitly assigned for research before implementation. Open decision: [Decision 010](decisions-record/decision-010-proposed-ticketing-scope-quicket-vs-camp-module.md).

> 📝 **Note (2026-07-29):** Nothing ticket-related is built in the MVP, whose codebase assumes ticketing stays entirely with Quicket. The kick-off meeting assigned research on ticketing infrastructure before any implementation, so this module is neither confirmed nor retired.

The system must allow camps to manage ticket allocations.

Each camper record should show:

- **TICKET-001** Whether the camper requires a ticket
- **TICKET-002** Whether a ticket has been allocated
- **TICKET-003** Ticket category
- **TICKET-004** Ticket reference
- **TICKET-005** Ticket payment status
- **TICKET-006** Ticket transfer status
- **TICKET-007** Ticket cancellation status
- **TICKET-008** Whether the ticket is linked to a Work Access Pass
- **TICKET-009** Whether the camper has completed the required information

Administrators should be able to:

- **TICKET-010** Record the camp’s total ticket allocation
- **TICKET-011** Allocate tickets to campers
- **TICKET-012** Reallocate returned tickets
- **TICKET-013** Track unused tickets
- **TICKET-014** Track ticket deadlines
- **TICKET-015** Export ticket lists
- **TICKET-016** Identify duplicate camper allocations
- **TICKET-017** Submit camper details to the event ticketing system

The system should not issue official tickets itself unless formally integrated with the event’s ticketing platform.

---

# 11. Theme-Camp Layout Tool ⚠️

⚠️ **Status:** At risk
📋 **Context:** Deferred due to mapping data/process dependencies; current MVP support is limited to layout uploads and placement preferences. Open decision: [Decision 011](decisions-record/decision-011-proposed-theme-camp-layout-tool-strategy.md).

> 📝 **Note (2026-07-29):** Deferred in the MVP — no structured map/erf data exists to build against. Registration currently accepts layout file uploads and placement-zone preferences instead. Graeme is arranging a meeting with town planner Roger van Wyk and Kshetra to unblock mapping (group chat, 2026-07-29 10:50); Sections 11–13 should be revisited after that meeting.

Every camp must have access to a scaled camp-layout tool.

The tool should allow camps to create a preferred placement plan using accurately sized objects.

Objects should include:

- **LAYOUT-001** Bedouin tents
- **LAYOUT-002** Stretch tents
- **LAYOUT-003** Geodesic domes
- **LAYOUT-004** Campers’ private tents
- **LAYOUT-005** Gazebos
- **LAYOUT-006** Shade structures
- **LAYOUT-007** Shipping containers
- **LAYOUT-008** Trucks
- **LAYOUT-009** Cars
- **LAYOUT-010** Trailers
- **LAYOUT-011** Caravans
- **LAYOUT-012** Rooftop tents
- **LAYOUT-013** Shower trailers
- **LAYOUT-014** Toilets
- **LAYOUT-015** Kitchens
- **LAYOUT-016** Bars
- **LAYOUT-017** Stages
- **LAYOUT-018** Sound systems
- **LAYOUT-019** Mutant vehicles
- **LAYOUT-020** Solar farms
- **LAYOUT-021** Generators
- **LAYOUT-022** Battery systems
- **LAYOUT-023** Water tanks
- **LAYOUT-024** Fire installations
- **LAYOUT-025** Gas-storage areas
- **LAYOUT-026** Waste areas
- **LAYOUT-027** Pedestrian pathways
- **LAYOUT-028** Emergency lanes
- **LAYOUT-029** Fire breaks
- **LAYOUT-030** Public frontage
- **LAYOUT-031** Private camping areas

Every object should have:

- **LAYOUT-032** Width
- **LAYOUT-033** Length
- **LAYOUT-034** Diameter, where relevant
- **LAYOUT-035** Rotation
- **LAYOUT-036** Clearance area
- **LAYOUT-037** Safety area
- **LAYOUT-038** Label
- **LAYOUT-039** Notes
- **LAYOUT-040** Ownership
- **LAYOUT-041** Power requirements
- **LAYOUT-042** Water requirements
- **LAYOUT-043** Public or private designation

---

# 12. Private Tent Placement Under Bedouin Tents ❌

❌ **Status:** Not implemented
📋 **Context:** Depends on the deferred layout-tool foundation.

The layout system must include a dedicated tool for placing different sizes of private tents underneath large Bedouin tents or other communal shade structures.

The user should be able to:

- **TENT-001** Select the Bedouin tent size
- **TENT-002** Define the usable covered area
- **TENT-003** Define support-pole positions
- **TENT-004** Define guy-rope and rigging exclusion zones
- **TENT-005** Define emergency walkways
- **TENT-006** Define entrances and exits
- **TENT-007** Select private tent sizes
- **TENT-008** Create custom tent sizes
- **TENT-009** Drag tents into the covered area
- **TENT-010** Rotate private tents
- **TENT-011** Automatically arrange tents
- **TENT-012** Set spacing between tents
- **TENT-013** Reserve access pathways
- **TENT-014** Reserve accessible camping spaces
- **TENT-015** Calculate how many tents can safely fit

Standard private tent objects could include:

- **TENT-016** Small one-person tent
- **TENT-017** Two-person tent
- **TENT-018** Three-person tent
- **TENT-019** Four-person tent
- **TENT-020** Large family tent
- **TENT-021** Bell tent
- **TENT-022** Rooftop tent footprint
- **TENT-023** Custom-sized tent

The system should warn users when:

- **TENT-024** Tents overlap
- **TENT-025** A tent blocks a pathway
- **TENT-026** A tent sits on a support-pole position
- **TENT-027** A tent intrudes into a rigging zone
- **TENT-028** Emergency access is inadequate
- **TENT-029** The selected tent arrangement exceeds the usable covered area

The automatic layout tool should prioritise:

1. **TENT-030** Emergency access
1. **TENT-031** Safe spacing
1. **TENT-032** Pole and rigging clearance
1. **TENT-033** Fair allocation of space
1. **TENT-034** Maximum practical tent capacity

---

# 13. AfrikaBurn Map and Erf Placement ⚠️

⚠️ **Status:** At risk
📋 **Context:** Not implemented and currently blocked on mapping-system alignment with AfrikaBurn stakeholders. Open decision: [Decision 012](decisions-record/decision-012-proposed-map-erf-integration-strategy-readiness-gate.md).

Where AfrikaBurn mapping data is available, the platform should allow the preferred camp layout to be placed on an actual allocated erf.

The system should assess:

- **ERF-001** Whether the camp fits
- **ERF-002** Erf dimensions
- **ERF-003** Road frontage
- **ERF-004** Public frontage
- **ERF-005** Emergency lanes
- **ERF-006** Fire access
- **ERF-007** Neighbouring camps
- **ERF-008** Sound orientation
- **ERF-009** Environmental restrictions
- **ERF-010** Vehicle access
- **ERF-011** Infrastructure conflicts

If the preferred layout does not fit, the system should be able to suggest:

- **ERF-012** Rotating the layout
- **ERF-013** Moving objects
- **ERF-014** Reducing private camping density
- **ERF-015** Reconfiguring public frontage
- **ERF-016** Sharing infrastructure
- **ERF-017** Assigning a more suitable erf
- **ERF-018** Producing a revised layout for camp approval

Theme-camp wranglers or placement staff should be able to send a proposed layout back to the camp through the platform.

The camp should then be able to:

- **ERF-019** Approve it
- **ERF-020** Reject it
- **ERF-021** Comment on it
- **ERF-022** Suggest revisions
- **ERF-023** Submit an updated version

Final placement decisions remain with AfrikaBurn.

---

# 14. Annual Registration and Placement Submission 🚧

🚧 **Status:** In progress
📋 **Context:** Core workflow is implemented in MVP (multi-section registration and review loop), but several listed artifacts depend on other unfinished modules.

The platform must allow a camp to submit its annual registration and placement application.

The submission may include:

- **REG-001** Camp profile
- **REG-002** Camp description
- **REG-003** Camper list
- **REG-004** Camp size
- **REG-005** Public offering
- **REG-006** Interactivity
- **REG-007** Participation plan
- **REG-008** Build plan
- **REG-009** Strike plan
- **REG-010** Budget
- **REG-011** External-service declaration
- **REG-012** Placement layout
- **REG-013** Power information
- **REG-014** Sound information
- **REG-015** Fire information
- **REG-016** Gas information
- **REG-017** Water requirements
- **REG-018** Work Access Pass requirements
- **REG-019** Ticket requirements
- **REG-020** Safety documentation
- **REG-021** Consent and policy confirmations

The platform should track:

- **REG-022** Draft
- **REG-023** Submitted
- **REG-024** Under review
- **REG-025** Changes requested
- **REG-026** Resubmitted
- **REG-027** Approved
- **REG-028** Declined
- **REG-029** Placement allocated
- **REG-030** Final layout approved

---

# 15. Previous-Year Submissions 🚧

🚧 **Status:** In progress
📋 **Context:** Edition-scoped foundation exists; duplication/carry-forward and comparison UX are not yet implemented.

The system must store previous registration and placement submissions.

A camp should be able to:

- **PREVYR-001** View all previous submissions
- **PREVYR-002** Duplicate the previous year’s submission
- **PREVYR-003** Carry previous camper data forward
- **PREVYR-004** Carry previous budget categories forward
- **PREVYR-005** Carry the previous layout forward
- **PREVYR-006** Carry previous infrastructure data forward
- **PREVYR-007** Carry safety information forward
- **PREVYR-008** Update only the sections that have changed
- **PREVYR-009** Compare the new submission against the previous year
- **PREVYR-010** Clearly identify changed and unchanged information
- **PREVYR-011** Archive each final submitted version

The system should not require camps to rebuild the same application every year where little has changed.

When starting a new event year, the camp should be offered:

- **PREVYR-012** Start a new submission
- **PREVYR-013** Duplicate last year’s submission
- **PREVYR-014** Duplicate another previous submission
- **PREVYR-015** Start from a template

Information that may have expired or requires annual confirmation should be flagged.

This could include:

- **PREVYR-016** Camper details
- **PREVYR-017** Safety certificates
- **PREVYR-018** Supplier information
- **PREVYR-019** Insurance
- **PREVYR-020** Fire documentation
- **PREVYR-021** Gas documentation
- **PREVYR-022** Work Access Pass requirements
- **PREVYR-023** Ticket numbers
- **PREVYR-024** Budget figures
- **PREVYR-025** Arrival and departure dates

---

# 16. Plug-and-Play and Turnkey Camp Prevention 🚧

🚧 **Status:** In progress
📋 **Context:** Baseline declarations are partly implemented; automated threshold triggers and risk-indicator dashboard are not yet implemented.

The platform should support AfrikaBurn’s efforts to discourage plug-and-play and turnkey camps.

## Mandatory Baseline Submission

Any theme camp or collective applying for placement should be required to submit:

- **PNP-001** A full camper list
- **PNP-002** A camp budget
- **PNP-003** Camp dues or participation charges
- **PNP-004** Build and strike arrangements
- **PNP-005** External services being used
- **PNP-006** The camp’s participant-contribution model
- **PNP-007** The camp’s public offering or interactivity

This creates a consistent baseline for all placed camps and avoids different rules being applied informally.

## Enhanced Disclosure Triggers

A more detailed disclosure or review should be triggered where a camp:

- **PNP-008** Uses substantial external or commercial services
- **PNP-009** Has more than 20 participants
- **PNP-010** Raises or collects more than R100,000 in camp or Village dues
- **PNP-011** Offers accommodation, catering or services that could resemble a turnkey experience
- **PNP-012** Has complaints or previous compliance concerns
- **PNP-013** Appears to be operating commercially
- **PNP-014** Has unusually high per-person charges
- **PNP-015** Outsources most build, strike or operational responsibilities

The R100,000 threshold should apply to the total amount raised or collected from participants for that event cycle.

## External-Service Disclosure

Relevant external services may include:

- **PNP-016** Full camp setup
- **PNP-017** Full camp strike
- **PNP-018** Pre-pitched accommodation
- **PNP-019** Commercial catering
- **PNP-020** Private chefs
- **PNP-021** Cleaning teams
- **PNP-022** Concierge services
- **PNP-023** Transported luggage services
- **PNP-024** Private security
- **PNP-025** Paid camp management
- **PNP-026** Commercial hospitality
- **PNP-027** Fully serviced showers or bathrooms
- **PNP-028** Paid participant support

The use of professional services should not automatically disqualify a camp.

Legitimate specialist services may be necessary, including:

- **PNP-029** Engineering
- **PNP-030** Electrical installation
- **PNP-031** Rigging
- **PNP-032** Plumbing
- **PNP-033** Transport
- **PNP-034** Heavy machinery
- **PNP-035** Fire compliance
- **PNP-036** Gas compliance
- **PNP-037** Medical support
- **PNP-038** Structural installation

The review should determine whether professional assistance supports participation or replaces participation.

## Organisation Review

AfrikaBurn should be able to:

- **PNP-039** Review submitted budgets
- **PNP-040** Review camper numbers
- **PNP-041** Review fees charged
- **PNP-042** Review external services
- **PNP-043** Request supporting documentation
- **PNP-044** Conduct random checks
- **PNP-045** Review camps where complaints arise
- **PNP-046** Flag unusual or inconsistent information
- **PNP-047** Request corrective measures
- **PNP-048** Record previous concerns
- **PNP-049** Compare submissions across years

The organisation dashboard should provide summaries and risk indicators without automatically exposing unnecessary personal or financial information.

---

# 17. Village Functionality ❌

❌ **Status:** Not implemented
📋 **Context:** Village-specific shared operational workflows are not yet in MVP.

Camps may operate independently or activate Village functionality.

Village tools should include:

- **VILLAGE-001** Shared camper lists where authorised
- **VILLAGE-002** Shared shifts
- **VILLAGE-003** Shared infrastructure
- **VILLAGE-004** Shared budgets
- **VILLAGE-005** Shared functional teams
- **VILLAGE-006** Shared announcements
- **VILLAGE-007** Shared placement planning
- **VILLAGE-008** Shared build and strike teams
- **VILLAGE-009** Shared power, water and waste planning
- **VILLAGE-010** Cross-camp reporting
- **VILLAGE-011** Village-level Work Access Pass planning
- **VILLAGE-012** Village-level ticket statistics

Each camp should control which information is shared with the Village.

A camp should be able to collaborate:

- **VILLAGE-013** Informally
- **VILLAGE-014** Through selected shared functions
- **VILLAGE-015** As a fully integrated Village

---

# 18. Creative Project Mode 🚧

🚧 **Status:** In progress
📋 **Context:** Foundational group types and some flows exist; full mode depends on other modules still not implemented.

The same platform should also support:

- **CREATIVE-001** Art projects
- **CREATIVE-002** Mutant vehicles
- **CREATIVE-003** Performance collectives
- **CREATIVE-004** Build crews
- **CREATIVE-005** Creative installations
- **CREATIVE-006** Fundraising initiatives

Creative Project Mode should use the same core systems:

- **CREATIVE-007** Team onboarding
- **CREATIVE-008** Participant database
- **CREATIVE-009** Roles
- **CREATIVE-010** Budgets
- **CREATIVE-011** Payments
- **CREATIVE-012** Shifts
- **CREATIVE-013** Build and strike planning
- **CREATIVE-014** Work Access Passes
- **CREATIVE-015** Ticket status
- **CREATIVE-016** Placement
- **CREATIVE-017** Safety documents
- **CREATIVE-018** Annual submissions
- **CREATIVE-019** Previous-year duplication

---

# 19. Permissions and Security ✅

✅ **Status:** Implemented
📋 **Context:** MVP implementation meets and materially exceeds baseline security/permissions requirements.

The platform must use role-based permissions.

Possible roles include:

- **SEC-001** Camp lead
- **SEC-002** Camp administrator
- **SEC-003** Village lead
- **SEC-004** Treasurer
- **SEC-005** Build captain
- **SEC-006** Strike captain
- **SEC-007** Functional lead
- **SEC-008** Shift lead
- **SEC-009** Placement coordinator
- **SEC-010** Camper
- **SEC-011** Organisation reviewer
- **SEC-012** Theme-camp wrangler

Each role must see only the information required to perform its function.

Security requirements should include:

- **SEC-013** POPIA-compliant data processing
- **SEC-014** Encryption
- **SEC-015** Multi-factor authentication
- **SEC-016** Audit logs
- **SEC-017** Masked identity numbers
- **SEC-018** Secure backups
- **SEC-019** Access expiration
- **SEC-020** Data-retention controls
- **SEC-021** Consent records
- **SEC-022** Payment security
- **SEC-023** Incident and breach procedures

---

# 20. Suggested First Development Release ⚠️

⚠️ **Status:** At risk
📋 **Context:** Useful as directional intent, but currently diverges from what the MVP has already delivered versus what remains incomplete. Open decision: [Decision 013](decisions-record/decision-013-proposed-rebaseline-first-release-phase-scope.md).

The first release should focus on the essential camp-management functions:

### Phase 1

- **RELEASE-001** Camp account creation
- **RELEASE-002** User roles
- **RELEASE-003** Camper onboarding
- **RELEASE-004** Camper database
- **RELEASE-005** Camper statistics
- **RELEASE-006** Shift management
- **RELEASE-007** Working budget
- **RELEASE-008** Camp-fee payments
- **RELEASE-009** Work Access Pass allocation
- **RELEASE-010** Ticket allocation
- **RELEASE-011** Camp-list export
- **RELEASE-012** Annual submission forms
- **RELEASE-013** Previous-year duplication
- **RELEASE-014** Basic placement-layout tool
- **RELEASE-015** Standard camp objects
- **RELEASE-016** Private tent placement under Bedouin tents

### Phase 2

- **RELEASE-017** Village functionality
- **RELEASE-018** Cross-camp shifts
- **RELEASE-019** Shared Village budgets
- **RELEASE-020** Advanced reporting
- **RELEASE-021** External-service declarations
- **RELEASE-022** Organisation review dashboard
- **RELEASE-023** AfrikaBurn ticketing integration
- **RELEASE-024** AfrikaBurn map integration
- **RELEASE-025** Automated erf-fit testing

### Phase 3

- **RELEASE-026** AI-assisted layout optimisation
- **RELEASE-027** Automated placement recommendations
- **RELEASE-028** AI budget analysis
- **RELEASE-029** AI shift scheduling
- **RELEASE-030** Resource sharing
- **RELEASE-031** Supplier management
- **RELEASE-032** Asset tracking
- **RELEASE-033** Creative Project Mode
- **RELEASE-034** Offline event functionality

---

# 21. Core Development Principle ✅

✅ **Status:** Implemented
📋 **Context:** Current MVP direction remains aligned with reducing repetitive admin and preserving participatory principles.

The platform should make genuine participation easier and administrative abuse harder.

It should reduce repetitive work without turning theme camps into commercial hospitality operations.

The product must strengthen:

- **PRINCIPLE-001** Participation
- **PRINCIPLE-002** Shared responsibility
- **PRINCIPLE-003** Transparency
- **PRINCIPLE-004** Collaboration
- **PRINCIPLE-005** Culture
- **PRINCIPLE-006** Creativity
- **PRINCIPLE-007** Community
- **PRINCIPLE-008** Accountability

The system should support camps and the organisation while preserving the voluntary, participatory and non-concierge nature of the Burn.
