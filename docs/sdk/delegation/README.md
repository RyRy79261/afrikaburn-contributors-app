# Delegated identity — acting for a burner from outside the monorepo

How an app that does **not** live in this repo — Camp 404 first — reads AfrikaBurn data
on behalf of a burner who is logged into it, without ever exceeding what that burner may
do, and with every disclosing read recorded.

This supersedes the delegation design in [`../04-backend-work-required.md`](../04-backend-work-required.md)
§4.3.12, which took a bare `subjectUserId` and was found to be an impersonation primitive
over every burner ([`../06-review.md`](../06-review.md) finding C1). Everything else in
[`../`](../) still stands.

## Read in this order

| Document                                                                     | What it settles                                                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`00-decision.md`](00-decision.md)                                           | The architecture and its decisions table                                         |
| [`01-delegated-identity.md`](01-delegated-identity.md)                       | The flow, the ticket, the three-way intersection — **the load-bearing document** |
| [`02-audit-and-the-medical-path.md`](02-audit-and-the-medical-path.md)       | The audit vocabulary, the medical path end to end, subject access                |
| [`03-security-measures.md`](03-security-measures.md)                         | Defence in depth, each measure tied to the file that implements it               |
| [`04-security-auditing-procedures.md`](04-security-auditing-procedures.md)   | The recurring human process, checklists and incident runbooks                    |
| [`05-docs-and-contribution-process.md`](05-docs-and-contribution-process.md) | ~42 literal, copy-paste-ready edits across 13 files — **not yet applied**        |
| [`06-camp-404-integration.md`](06-camp-404-integration.md)                   | The retrofit guide, written for Camp 404's developer                             |
| [`07-review.md`](07-review.md)                                               | Security (15 findings), implementability, completeness — **read F1 first**       |

## The design in one paragraph

An integrator holds one long-lived secret, `ab_ik_…`, which is **a ceiling with no
principal** and on its own reaches nothing but `public:*`. Any request that can name a
burner must also carry a **relay ticket** — not a credential, but a 256-bit pointer at a row
whose foreign key is that burner's live `session.id` (`packages/db/src/schema.ts:376-396`).
Tickets are minted only on our own origin, behind the existing `requireCampUser()`
(`apps/web/lib/session.ts:194`), by a click on a consent screen we render — so presence is
the browser's own httpOnly cookie reaching our own handler, never a string anyone can type.
On each `/v1` request one SQL statement joins ticket → consent → integration → `session` →
`users` **with the key hash inside the `WHERE` clause**, so a ticket minted for app A is
structurally invisible to app B and "wrong app" is indistinguishable from "no such ticket".
That join yields `ticket ∩ consent ∩ ceiling` — a set that can only ever _subtract_ — plus
the end user's id, which goes to the unchanged `@quagga/core` predicates, the only things in
the system that can _grant_. Revocation is a foreign key: sign-out and password reset delete
`session` rows, and `ON DELETE CASCADE` does the rest in the same statement.

## Why this shape

Ryan's law is _"the API key can only have as much access as its owner."_ The relay ticket
makes that structural rather than procedural: the key names no burner, so it cannot exceed
one. Three consequences worth stating up front.

- **`org:*` is not delegable at all.** `isDelegableScope` rejects the prefix, which deletes
  the service-user concept, both its invariants, and the insider-issues-themselves-a-key
  path in one stroke.
- **Medical is its own namespace and its own tier.** One new scope, `bio:medical:read`, in a
  fifth namespace with exactly one member (49 → 50 strings), so "medical is higher tier" is
  enforced structurally: 120-second single-use tickets, never renewable.
- **The API calls the app's own code.** `/v1` lives inside `apps/web` and calls
  `resolveMedicalNotesForViewer` (`apps/web/lib/medical-access.ts:37`) — the same function
  `apps/web/app/(app)/burners/[id]/page.tsx:69` calls — with one extra parameter flipping its
  `after()` fail-open audit into a blocking fail-closed one. One implementation of the
  sharpest read in the product; the API is a caller, not a peer.

## Before implementing: three things the review found

1. **F1, critical.** The single-use disclosing ticket is burned _after_ the read, so it is not
   single-use under concurrency — N parallel requests all see `consumed_at IS NULL` and all
   disclose. One consent click yields a whole camp's medical notes. The fix (claim the ticket
   before the guard, or use `createPooledDb()` in a transaction — `packages/db/src/index.ts:37-39`
   notes the pool _does_ support transactions) is in `07-review.md`.
2. **F2, high.** "Revoke now" as specified does not revoke the live key, and the documented
   containment order hands a leaked key a fresh seven-day grace window.
3. **The resource surface is under-specified.** Two shards specify the security model in
   exhaustive detail without the HTTP paths and DTOs it protects — `camp:*` has guards but no
   endpoints. An implementer reaching that stage designs an API from scratch.

## Status

Specification. Nothing here is built. The implementability review puts it at ~88 engineer-days,
and identifies one item that should ship immediately and separately regardless of any of this:
the `apps/web/lib/medical-access.ts:215` rank fail-closed fix, which is a live production
defect on a medical-notes path.

The doc and process edits in `05` are written as literal replacement text but have **not been
applied** — they describe a system that does not exist yet.
