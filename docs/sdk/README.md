# Quagga Portal SDK — specification

A proposal for `@afrikaburn/sdk`: a published npm package that lets third-party projects
talk to the Quagga Portal backend, where **the API key's rights decide which of the SDK's
methods work**.

**Status: specification. Nothing here is built.** The consumer is
[Camp 404](https://github.com/ryry79261/camp-404) and other apps outside this monorepo.

`06-review.md` contains a review arguing this was too early. **That question is closed** —
the maintainer has since named the consumer and asked for it. The review is kept for its
technical findings, which stand; its scheduling verdict does not.

## Read in this order

| Document                                                                     | What it settles                                                                                       |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`00-decision.md`](00-decision.md)                                           | The architecture, the decisions table, and what each rejected alternative cost                        |
| [`01-overview-and-capability-model.md`](01-overview-and-capability-model.md) | What the SDK is, the naming scheme, and the capability model — **the load-bearing document**          |
| [`02-core-api-reference.md`](02-core-api-reference.md)                       | The core package: client construction, method surface, error taxonomy, transport                      |
| [`03-react-reference.md`](03-react-reference.md)                             | The React package: provider, hooks, permission-gating components, RSC and key placement               |
| [`04-backend-work-required.md`](04-backend-work-required.md)                 | The HTTP API, the API-key system, and the ordered implementation plan — **none of this exists today** |
| [`05-publishing-and-licensing.md`](05-publishing-and-licensing.md)           | Package layout, build, the Apache-2.0 licence boundary and how CI enforces it                         |
| [`06-review.md`](06-review.md)                                               | Three independent reviews: pragmatism, adversarial security, completeness                             |
| [**`delegation/`**](delegation/README.md)                                    | **How an outside app acts for a logged-in burner** — supersedes `04` §4.3.12                          |

## Delegation

The hard problem is not what a key may do; it is proving the **burner is actually there**
when an app outside this repo acts for them. `04-backend-work-required.md` §4.3.12 took a
bare `subjectUserId` and was found to be an impersonation primitive over every burner
(`06-review.md`, C1). [`delegation/`](delegation/README.md) replaces it with a relay ticket
that points at the burner's live session row, and covers the audit, security measures,
auditing procedures, doc/process edits and the Camp 404 retrofit.

## The one-paragraph version

An API key is a **ceiling, never a principal**: it is bound to a synthetic service user, and
its effective rights are recomputed per request as `resolve(serviceUser) ∩ key.permissions`,
so a demoted membership collapses its keys with no sweep job. Rights reach the client as a
**server-issued capability manifest** — a document produced by the predicates that already
exist in `@quagga/core`, never a copy of those predicates. The published package therefore
contains **no authorisation logic at all**: 49 closed scope strings, generated method stubs,
a manifest evaluator and response DTOs. `org-permissions.ts`, `project-permissions.ts` and
`privacy.ts` stay here, stay FSL-1.1-ALv2, and are never published — because
`org-permissions.ts:22-25` already records what a second source of truth for permissions
costs. The local gate is developer experience; the server's 403 is the boundary.

## Provenance, and what has actually been verified

This spec was produced by a 27-agent investigation. Two honesty notes belong on the front page.

**An earlier run of the same investigation was discarded in full.** A harness fault rejected
all 312 of its tool calls, so 27 agents produced a confident, detailed and entirely ungrounded
architecture without reading a single file. None of it survives here. The re-run made a
successful read of a known file each agent's mandatory first action, with instructions to
abort rather than reason from priors — it landed 942 tool calls with 3 errors.

**Verified by hand** (not merely asserted by an agent):

- `packages/core/src/privacy.ts:39-47` — `HARD_LOCKED_PRIVATE_FIELDS`, exactly 7 fields.
- `packages/core/src/project-permissions.ts:53` — the `manage_roles ⇒ assign_roles` implication.
- `packages/core/src/org-permissions.ts:178-182`, `:438-440`, `:521`, `:621`, `:809` —
  `orgRankFromRole`, `isSystemManager`, `orgCanInDomain`, `orgCapabilityRefusal`, `summarizeOrgActor`.
- `apps/web/lib/groups-store.ts:187` — the free-camp law, literally `if (!registered && !viewerRole) continue;`.
- `apps/org/lib/queries.ts:952-960` — `REGISTRATION_CONTACT_KEYS`, 7 contact columns that sit
  **outside** `HARD_LOCKED_PRIVATE_FIELDS` and are guarded today by a module-private `const`.
- `grep -rn stripHardLocked` returns **zero hits** — the PII stripper that
  `docs/auth-platform-spec.md` §9.4 decision 2 committed to was never built.

**Not verified, and flagged in place:** every claim about `better-auth`'s api-key plugin
(`node_modules` is absent from this environment), the exact store line counts, and the
prior-art citations in the external research. Treat those as leads.

## What this investigation found that has nothing to do with the SDK

The most valuable output is arguably a set of first-party defects the sweep turned up. They
are listed in `06-review.md`; the sharpest is `apps/web/lib/medical-access.ts:215`, where
`orgRankFromRole(actorOrgRole) ?? "org_staff"` fabricates a rank that
`apps/org/lib/session.ts:230-234` treats as forbidden — two apps, one input, two answers, on
a medical-notes path. Fixing that does not depend on any of this spec.
