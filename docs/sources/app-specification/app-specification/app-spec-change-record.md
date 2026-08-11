# App Spec Change Record

Parent page: [App Specification](../app-specification.md)

> **Keep entries to the point.** State what changed, why, and what it affects — skip narration of how the change was made (sync mechanics, tooling steps, export artifacts). Mechanics that need recording belong in the sync manifest or tooling notes, not here.

| Date | Description of Change |
| --- | --- |
| 29/07/2026 | Initial Spec provided |
| 29/07/2026 | Kick-off alignment updates (development direction, offline scope, open architecture question) |
| 29/07/2026 | MVP gap-analysis reconciliation: implementation-status section, group-chat annotations, decisions 005–006, task board updates |
| 29/07/2026 | Spec-wide implementation weaving: per-feature status labels (implemented / in progress / not implemented / at risk) embedded in every major feature section |
| 29/07/2026 | Drafted pending decision records for every at-risk section (Decisions 007–013) |
| 05/08/2026 | Introduced requirement ID system: every specification bullet tagged with a stable `PREFIX-NNN` ID; added Requirement ID Conventions section and companion Requirement Index |
| 10/08/2026 | Pulled new "4a. Camper Communications" section from Superhuman (untagged narrative idea, no requirement IDs yet) |
| 10/08/2026 | Cleaned up spelling/grammar in "4a. Camper Communications" (meaning unchanged) |
| 10/08/2026 | Formalized "4a. Camper Communications" into grouped requirements with new `COMM` prefix (COMM-001–020); added to Requirement Index |
| 11/08/2026 | Corrected Requirement ID Conventions prefix rule to cover lettered subsections (e.g. 4a), per PR #25 review |
| 11/08/2026 | Flagged unresolved visibility/permission ambiguity between COMM-001, COMM-002, COMM-017–COMM-019, and COMM-020 with inline cross-references; no decision recorded, detail to follow later |

## 2026-07-29 - Kick-off Alignment Updates
Owner: Beyers Nel
Type: spec-change
Status: active
Related: [app-specification.md](../app-specification.md), [decisions-record.md](../decisions-record.md), [task-assignment.md](../task-assignment.md)

### What changed
- Added a development-direction section that distinguishes core camp-management features from optional community-led extensions.
- Captured the current implementation focus on placement tools and container-related management.
- Recorded the architecture integration question as open pending AfrikaBurn feedback.
- Restricted offline functionality to the container, gas, and water organization projects.
- Noted the need for a simplified fallback path for minimum mandatory flows.

### Why it changed
- The kick-off meeting established a practical early demo scope and clarified which parts of the platform should remain universally available versus optional.

### Impact
- Affected features: core camp management, placement, container management, offline support, fallback onboarding/submission flows
- Affected decisions: architecture strategy, offline-scope decision, presentation strategy
- Affected tasks: project links, org contact, scoping, demo pitch, deployment, ticketing research

### Validation / Gap Analysis
- Expected outcome: the baseline spec reflects the agreed early direction without pretending the architecture question is settled.
- Drift risk addressed: prevents later implementation work from treating the early demo scope as the full product boundary.
- Follow-up checks: confirm the decision records and task board stay aligned with any org feedback that changes the open architecture question.

## 2026-07-29 - MVP Gap-Analysis Reconciliation
Owner: Beyers Nel
Type: spec-change
Status: active
Related: [app-specification.md](../app-specification.md), [decisions-record.md](../decisions-record.md), [task-assignment.md](../task-assignment.md), [2026-07-28 kick-off minutes](../meeting-minutes/2026-07-28-theme-camp-app-kick-off.md)

### What changed
- Added an "MVP Implementation Status (as of 2026-07-29)" section to the spec, recording: what the MVP has built and we are aligned on; what the MVP contains that the original spec did not; what the spec requires that the MVP lacks; and what remains open or unresolved.
- Added inline notes to the affected spec sections (camper database, working budget, camp fees and payment gateway, ticket allocation, theme-camp layout tool) so readers see implementation reality and open questions in context.
- Annotated the spec with group-chat references (dates and senders) wherever chat discussion had a bearing on scope, direction or ownership.
- Created [Decision 005](../decisions-record/decision-005-proposed-backend-first-platform-api-mcp-sdk-no-community-plugins.md) (backend-first platform: user-scoped API, MCP server, SDK; no community plugins) and [Decision 006](../decisions-record/decision-006-accepted-shadcn-tailwind-versioned-pen-design-workflow.md) (frontend and design tooling: shadcn/Tailwind, versioned pen.dev design files) from directions set in the group chat.
- Updated the task board with statuses evidenced in the group chat and new assignments (budgeting, module scope docs, spec enhancement, budget walkthrough).

### Why it changed
- A gap analysis (2026-07-29) between this spec and the MVP codebase (`afrikaburn-contributors-app`) surfaced contradictions of direction. Group-chat review and the kick-off minutes resolved or reframed several of them; the spec is updated so it stops silently disagreeing with the implementation.

### Impact
- Affected features: camper database model, budgets, payments, ticketing, WAPs, layout/placement tooling, shifts, villages, suppliers, questionnaires, notifications.
- Affected decisions: Decision 002 (architecture open), Decision 004 (first slice), new Decisions 005 and 006.
- Affected tasks: budgeting ownership (Ruchir), module scope docs (Finlay), mapping meeting (Graeme), ticketing research (Ryan), spec enhancement (Ryan).

### Validation / Gap Analysis
- Expected outcome: the spec presents a truthful, annotated picture of build state and open questions, so stakeholder reporting matches reality.
- Drift risk addressed: the spec and the MVP repository no longer both claim unqualified authority over contradictory directions (ticketing, payments, camper-data model, placement).
- Follow-up checks: revisit Sections 11–13 after the mapping meeting with Roger van Wyk; confirm ticketing direction after Ryan's research; record an explicit decision on the camper-data model once AfrikaBurn's data posture is known.

## 2026-07-29 - Spec-wide Per-Feature Status Weaving
Owner: Beyers Nel
Type: spec-change
Status: active
Related: [app-specification.md](../app-specification.md), [app-spec-change-record.md](./app-spec-change-record.md), [decisions-record.md](../decisions-record.md), [task-assignment.md](../task-assignment.md)

### What changed
- Removed dependence on a single centralized MVP status section.
- Embedded explicit status labels into each major product section in the specification: `Implemented`, `In progress`, `Not implemented`, or `At risk`.
- Added section-level context statements directly under headings so divergence, blockers, and active work are visible at point of use.
- Kept and expanded group-chat-derived context in sections where it materially affects direction (budgeting, ticketing, layout/mapping, architecture).

### Why it changed
- The team requested that implementation reality be visible where each feature is specified, rather than requiring readers to cross-reference a standalone summary section.

### Impact
- Affected features: all major feature modules and release sections in the master specification.
- Affected process: review and prioritization can now happen section-by-section with immediate status visibility.
- Affected risk tracking: directional divergence is now explicitly marked as `At risk` where applicable.

### Validation / Gap Analysis
- Expected outcome: clearer product alignment by making status and risk explicit at every feature definition.
- Drift risk addressed: reduces the chance of teams treating unsupported sections as implicitly delivered.
- Follow-up checks: update section statuses continuously as work lands, and escalate any `At risk` section that remains unresolved through decision records.

## 2026-07-29 - Pending Decision Drafts for At-Risk Sections
Owner: Beyers Nel
Type: spec-change
Status: active
Related: [app-specification.md](../app-specification.md), [decisions-record.md](../decisions-record.md)

### What changed
- Added proposed decision records for each feature section currently marked `Status: At risk`:
  - [Decision 007](../decisions-record/decision-007-proposed-application-boundary-strategy-org-vs-camp-flows.md) — Development direction and app-boundary strategy.
  - [Decision 008](../decisions-record/decision-008-proposed-canonical-camper-data-model.md) — Camper data model (admin-managed vs self-owned profile model).
  - [Decision 009](../decisions-record/decision-009-proposed-payment-direction-tracking-vs-gateway.md) — Payment direction (tracking vs gateway).
  - [Decision 010](../decisions-record/decision-010-proposed-ticketing-scope-quicket-vs-camp-module.md) — Ticketing scope and ownership boundary.
  - [Decision 011](../decisions-record/decision-011-proposed-theme-camp-layout-tool-strategy.md) — Theme-camp layout tool strategy.
  - [Decision 012](../decisions-record/decision-012-proposed-map-erf-integration-strategy-readiness-gate.md) — Map/erf integration readiness strategy.
  - [Decision 013](../decisions-record/decision-013-proposed-rebaseline-first-release-phase-scope.md) — First-release phase rebaseline.
- Updated the decisions index to include Decisions 007–013.

### Why it changed
- The team requested complete pending-decision coverage for all currently at-risk features so context and options are ready for alignment.

### Impact
- Affected decisions: adds a structured review queue for unresolved directional risks.
- Affected planning: provides concrete option sets for upcoming alignment sessions.

### Validation / Gap Analysis
- Expected outcome: no at-risk feature remains undocumented from a decision perspective.
- Follow-up checks: move each decision from proposed to accepted/rejected as outcomes are agreed.

## 2026-08-05 - Requirement ID System Introduced
Owner: Beyers Nel
Type: spec-change
Status: active
Related: [app-specification.md](../app-specification.md), [requirement-index.md](./requirement-index.md)

### What changed
- Tagged all 564 substantive specification bullets across Sections 1–21 with a stable, section-scoped ID (`PREFIX-NNN`, e.g. `WAP-003`), bolded inline immediately before the requirement text. Status-legend, document-structure, cross-reference, and per-section "Context" commentary bullets were deliberately left untagged (not requirements).
- Added a "Requirement ID Conventions" section to the spec (under Implementation Status Tracking) documenting the prefix-per-section table and the append-only / never-renumber / strike-through-on-removal rules.
- Added a new companion page, [Requirement Index](./requirement-index.md), listing every ID grouped by section with its requirement text and a "Last Changed" column, and linked it from Document Structure and Cross-references.
- No requirement wording was altered — verified programmatically that every changed line differs only by the inserted `**PREFIX-NNN** ` marker.

### Why it changed
- The spec previously had no way to reliably reference an individual requirement (only section numbers), making it hard to track implementation against a specific line item from `task-assignment.md`, a decision record, or code, and making additions/removals invisible unless read as a full-document diff.

### Impact
- Affected features: every section of the specification (Sections 1–21).
- Affected process: future spec edits should cite affected `PREFIX-NNN` IDs in this Change Record (see Requirement ID Conventions) and update the Requirement Index's "Last Changed" column; this is a documented convention, not an enforced checklist.
- Affected tooling: none — IDs are plain bolded text, safe to round-trip through the Superhuman/Coda markdown export used by the sync scripts.

### Validation / Gap Analysis
- Expected outcome: any future reference to a requirement (in task assignment, decisions, or code) can cite a `PREFIX-NNN` ID that stays valid indefinitely, and the Requirement Index makes drift (additions/removals) visible without reading the full spec.
- Drift risk addressed: previously, inserting, removing, or reordering a bullet was indistinguishable from a passive rewrite unless someone diffed the whole document.
- Follow-up checks: as sections are revised, confirm new bullets get the next sequential ID for that section's prefix (never inserted mid-sequence) and that removed requirements are struck through with a Change Record reference rather than deleted outright.

## 2026-08-10 - Pulled New "Camper Communications" Section from Superhuman
Owner: Beyers Nel
Type: spec-change
Status: active
Related: [app-specification.md](../app-specification.md#4a-camper-communications)

### What changed
- Added new section "4a. Camper Communications" between Section 4 (Camper Database and Camp List) and Section 5 (Camper Statistics): a proposed camper directory/profile feature (photo tiles, self-managed shared profile, in-app contact/messaging, per-camper sharing permissions, Village-level camper discovery). Pulled verbatim from Superhuman, no other section changed.

### Why it changed
- New content authored directly in Superhuman; pulled into the spec so it doesn't sit undiscovered outside the source of truth.

### Impact
- Affected features: Section 4 area gains an adjacent, not-yet-scoped idea. No requirement IDs assigned yet (pure narrative, no bulleted items) and no task owner assigned.

### Validation / Gap Analysis
- Follow-up: the section's status marker (`✅ New`) doesn't match the doc's status legend (Implemented/In progress/Not implemented/At risk) — needs the author to clarify intended status. Also needs a decision on whether this becomes a formal numbered section with its own requirement prefix.

## 2026-08-10 - Copyedited "Camper Communications" Section
Owner: Beyers Nel
Type: spec-change
Status: active
Related: [app-specification.md](../app-specification.md#4a-camper-communications)

### What changed
- Fixed spelling and grammar in the "4a. Camper Communications" section (source text had typos from an informal draft). Meaning is unchanged.

### Why it changed
- The section was pulled verbatim from source; readability needed a pass before it's usable as a spec reference.

### Impact
- Affected features: none — wording only, no requirement change.

## 2026-08-10 - Formalized "Camper Communications" into Grouped Requirements
Owner: Beyers Nel
Type: spec-change
Status: active
Related: [app-specification.md](../app-specification.md#4a-camper-communications), [requirement-index.md](./requirement-index.md)

### What changed
- Rewrote "4a. Camper Communications" from prose into six thematic groups (directory & discovery, profile content, communication & contact, group formation, privacy & permissions, Village integration), each with a bolded `COMM-NNN` ID — 20 requirements total (COMM-001–020).
- Added `COMM` to the Prefix reference table and added the section to the [Requirement Index](./requirement-index.md) (total tracked requirements: 564 → 584).
- Changed the section's status marker from `✅ New` (not a legend value) to `❌ Not implemented`, since nothing is built — resolves the mismatch flagged in the 2026-08-10 pull entry above.

### Why it changed
- Every other section uses tagged, grouped requirements rather than free narrative; formalizing makes this section referenceable from tasks, decisions, and code like the rest of the spec.

### Impact
- Affected features: Section 4a now has citable requirement IDs.
- Affected tooling: Requirement Index total updated to 584.

## 2026-08-11 - PR #25 Review Follow-Ups: Prefix Rule Fix and Ambiguity Cross-References
Owner: Beyers Nel
Type: spec-change
Status: active
Related: [app-specification.md](../app-specification.md#4a-camper-communications), [requirement-index.md](./requirement-index.md)

### What changed
- Corrected the "Prefix per section" rule in [Requirement ID Conventions](../app-specification.md#requirement-id-conventions) to explicitly cover lettered subsections (e.g. `4a`), which the wording didn't account for when `COMM` was added.
- Added inline `(⚠️ ambiguity — see COMM-NNN)` cross-references to COMM-001, COMM-002, COMM-017, COMM-018, COMM-019, and COMM-020, plus a summary note under Section 4a's Context, flagging that camper-controlled visibility/contact permissions (COMM-017–019) and cross-camp Village discovery (COMM-020) don't yet state whether they constrain directory listing (COMM-001–002).
- Updated the Requirement Index "Last Changed" date to 2026-08-11 for the six flagged IDs.

### Why it changed
- Addressing valid findings from the CodeRabbit review on PR #25: the prefix rule was inconsistent with its own new usage, and the directory-vs-permissions requirements as written don't state which one wins.

### Impact
- Affected features: none — no new capability or behavior specified, only a conventions-doc correction and inline pointers marking where detail is still needed.
- Not addressed: the review's requests for a full profile-data lifecycle contract (COMM-004–007) and a bounded external-integration contract (COMM-009–010) were assessed as out of scope for this spec's current level of detail (no other section defines either) and are intentionally left as-is.
- Follow-up: the flagged ambiguity needs its actual resolution (does opt-out override directory/Village listing, and how) filled in later; this change only marks where that answer belongs.
