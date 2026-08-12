# Decisions Record

| Field | Value |
| --- | --- |
| **Category** | Planning |
| **Doc status** | Active |
| **Normative language** | Descriptive only |
| **Requirement IDs** | References App Spec IDs; defines none |
| **Owner / Updated** | Repo maintainers, 2026-08-12 |

The repo's record of the architectural and scope decisions the
[App Specification](../sources/app-specification/app-specification.md) marks as open.

## Why this directory exists

The App Spec's own change record says decision records 007–013 were drafted on
29/07/2026, and seven at-risk spec sections link to them. **None of those files
were part of the 06/08/2026 export**, so every one of those links resolved to
nothing — seven sections' worth of requirements frozen pending documents nobody
in this repo could read.

These files are **reconstructions, not the originals.** Each is built from the
context the App Spec itself states inline (the divergence, the group-chat
references, the open question) plus what the codebase actually does. The
canonical versions live in Coda; where the two disagree, Coda wins for anything
predating 2026-08-12, and this directory wins for anything decided since — those
entries record decisions made here, in this repo, by the person who owns them.

Nothing in `docs/sources/` was edited to produce these. That directory is
verbatim primary source and stays that way.

## The decisions

| # | Decision | Status | Spec section |
| --- | --- | --- | --- |
| [007](decision-007-application-boundary.md) | Application boundary: org vs camp flows | Open | §1 Development Direction |
| [008](decision-008-camper-data-model.md) | Canonical camper data model | Open | §4 Camper Database |
| [009](decision-009-payment-direction.md) | Payment direction: tracking vs gateway | **Resolved 2026-08-12** | §8 Camp Fees and Payment Gateway |
| [010](decision-010-ticketing-scope.md) | Ticketing scope: Quicket vs camp module | Open | §10 Ticket Allocation |
| [011](decision-011-layout-tool-strategy.md) | Theme-camp layout tool strategy | Open — deferred | §11 Layout Tool |
| [012](decision-012-map-erf-readiness.md) | Map / erf integration readiness gate | Open — partially routed around | §13 Map and Erf Placement |
| [013](decision-013-release-rebaseline.md) | Re-baseline the first release scope | Open | §20 First Development Release |
| [014](decision-014-questionnaire-engine-over-google-forms.md) | Registration intake: own questionnaire engine, not Google Forms | **Resolved 2026-08-12** | §14 Annual Registration |

## Status vocabulary

- **Open** — nobody has decided. The spec section stays at risk.
- **Resolved** — decided, dated, and attributed. The spec section and the roadmap
  are updated to match, and the code either already reflects it or has a task.
- **Deferred** — deliberately not being decided yet, with a stated trigger for
  revisiting.
