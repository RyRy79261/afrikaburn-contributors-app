# Delegated identity — acting for a burner from outside the monorepo

How an app that does **not** live in this repo — Camp 404 first — reads AfrikaBurn data
on behalf of a burner who is logged into it, without ever exceeding what that burner may
do, and with every disclosing read recorded.

This supersedes the delegation design in [`../04-backend-work-required.md`](../04-backend-work-required.md)
§4.3.12, which took a bare `subjectUserId` and was found to be an impersonation primitive
over every burner ([`../06-review.md`](../06-review.md) finding C1). Everything else in
[`../`](../) still stands.

## Read in this order

| Document                                                                     | What it settles                                                                          |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`00-decision.md`](00-decision.md)                                           | The architecture and its decisions table                                                 |
| [`01-delegated-identity.md`](01-delegated-identity.md)                       | The flow, the ticket, the three-way intersection — **the load-bearing document**         |
| [`02-audit-and-the-medical-path.md`](02-audit-and-the-medical-path.md)       | The audit vocabulary, the medical path end to end, subject access                        |
| [`03-security-measures.md`](03-security-measures.md)                         | Defence in depth, each measure tied to the file that implements it                       |
| [`04-security-auditing-procedures.md`](04-security-auditing-procedures.md)   | The recurring human process, checklists and incident runbooks                            |
| [`05-docs-and-contribution-process.md`](05-docs-and-contribution-process.md) | ~42 literal, copy-paste-ready edits across 13 files — **applied, see Status**            |
| [`06-camp-404-integration.md`](06-camp-404-integration.md)                   | The retrofit guide, written for Camp 404's developer                                     |
| [`07-review.md`](07-review.md)                                               | Security (15 findings), implementability, completeness — F1/F2 now resolved in `01`/`03` |

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

## Three review findings, resolved in place

The review in `07-review.md` is kept verbatim, including the three findings below, which the
spec has since been amended to answer. The findings stand as the record of why the design
reads as it does.

1. **F1, critical — resolved.** The single-use disclosing ticket was burned _after_ the read,
   so it was not single-use under concurrency: N parallel requests all saw `consumed_at IS
NULL` and all disclosed. One consent click yielded a whole camp's medical notes. `01` §7.2.1
   now claims the ticket **before** the guard on the disclosing tier, accepting that a refusal
   costs the ticket, and records the pooled-transaction alternative
   (`packages/db/src/index.ts:37-39` — the pool _does_ support transactions) for anyone who
   judges the refusal-is-free property worth a pooled connection.
2. **F2, high — resolved.** "Revoke now" was specified as `previous_key_expires_at = now()`,
   which is only ever read in the `previous_key_hash` arm of the resolver and does nothing to
   the live key; and the containment runbook said to rotate, which moves the leaked key into
   the grace slot with a fresh seven days. `01` §3.2 and `03` §3.4/§12.1 now revoke by nulling
   **both** hashes and suspending in one statement, and forbid rotation as a containment step.
3. **The resource surface — resolved.** `camp:*` had guards and no endpoints. `01` §16.2 now
   maps every delegable scope to its routes and responses, reusing the DTOs already in
   `../02-core-api-reference.md` §9 and adding one, `MemberDetail`, defined by subtraction
   from the row so hard-locked fields and medical are absent rather than nulled.

## Status

Specification. None of the `/v1` surface is built. The implementability review puts it at
~88 engineer-days.

Two things from this work have already shipped:

- **The rank fix is done** — `apps/web/lib/medical-access.ts` no longer invents an `org_staff`
  rank when none resolves, and `strongestOrgRole` (`packages/core/src/medical-access.ts`)
  stops an ordinary org row from overwriting an `engineer` and erasing its carve-out. That was
  a live defect on a medical-notes path, independent of this spec, and it is the resolver
  every delegated medical read will call.
- **The doc and process edits in `05` are applied**, so the repo's contribution guidelines,
  security policy and review requirements already describe the rules a `/v1` contributor works
  under. They describe a surface that does not exist yet, and say so.
