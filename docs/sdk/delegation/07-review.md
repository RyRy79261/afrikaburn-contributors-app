# Delegated-identity spec — review

Three independent reviews, run against the working tree. Kept verbatim, including
where they contradict the spec they reviewed. **F1 in the security review is a
critical flaw in the medical path as specified** — read it before implementing
anything in `02`.

---

# 1. Adversarial security review — 15 findings

**ADVERSARIAL REVIEW — `sdk2` shards 01–06.** 15 findings, most severe first. Repo facts re-verified this round are cited with path+line; everything else is cited to shard+section.

---

## F1 — CRITICAL. The single-use disclosing ticket is burned _after_ the read, so it is not single-use under concurrency. One consent click yields a whole camp's medical notes.

**Where:** shard-01 §7.2 step 11 and the §7 sequence diagram (steps 20–22); shard-02 §4.2 diagram + the contractual paragraph _"The ticket is consumed after the predicate says yes and before the body is built."_

**Attack.** `resolveRelayCaller` (shard-01 §8.3) reads `t.consumed_at` as a **returned column**, not a `WHERE` term; `relayRefusal` is pure and evaluates the snapshot that join produced. The burn is a separate statement at the end. So: hold `ab_ik_…` plus one 120 s `abrt_…` medical ticket (the integrator holds both by construction; a compromised integrator server or a lifted ticket + key does too). Fire N parallel `GET /v1/burners/{id}/medical` with N different `{id}`. Every request's join sees `consumed_at IS NULL`, every `relayRefusal` returns `null`, every guard runs, every read runs, every audit row is written, every response carries notes. Exactly one wins the final CAS. **The spec defines no behaviour for the losers, and they have already disclosed.** N is bounded only by `v1_subject` at 60/60 s — which _fails open on a storage error by design_ (shard-03 §6.2), and which shard-01 §21 item 1 flags as possibly removable.

The burner read _"Access lasts two minutes, is good for one read"_ (shard-01 §5.2). She got one read per parallel connection.

**Why it was missed:** the design already knows the pattern — §10 rule 6 uses precisely `UPDATE … WHERE consumed_at IS NULL RETURNING id` as a compare-and-swap for the refresh path, and justifies it by _"`createHttpDb()` has no transactions."_ It then declines to apply it on the read path in order to preserve _"a refusal the burner did not cause never costs her the ticket."_ That preference is what creates the race. Note also that the no-transactions premise is only half the story — verified at `packages/db/src/index.ts:37-39`, the comment continues: _"`createPooledDb()` is a WebSocket pool (scripts, seeds) and **DOES** support transactions. Multi-statement atomic work must use the pool."_ No shard mentions this.

**Fix.** For `scopeTier(requiredScope) === "disclosing"`, claim the ticket **first** — immediately after `resolveRelayCaller`, before `GUARDS[...]`:
`UPDATE integration_tickets SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`; no row ⇒ `401 invalid_credentials`. Accept that a predicate refusal costs the ticket — that is what "one read" means, and the burner is one click from another. If the "a refusal must not cost her the ticket" property is genuinely required, run the disclosing path on `createPooledDb()` in a transaction with `SELECT … FOR UPDATE` on the ticket row; that is the only other atomicity available. New CI check `disclosing-ticket-claimed-before-predicate`; the existing `ticket-tier-invariant` only checks the mint and cannot see this.

---

## F2 — HIGH. "Revoke now" does not revoke the live key, and the documented containment order re-arms a leaked key for seven days.

**Where:** shard-01 §3.2 and §11 lever 4; shard-03 §3.4 and **§12.1 step 1**; shard-04 §6.3 row "Key".

**Attack.** The leaked key sits in `integrations.key_hash`. `relayRefusal` (shard-01 §8.2) can only ever return `key_revoked` inside `if (f.keyIsPrevious && …)`, and `keyIsPrevious` is `COALESCE(i.previous_key_hash = $keyHash, false)`. Setting `previous_key_expires_at = now()` therefore has **no effect whatsoever on the current key**: it still satisfies `i.key_hash = $keyHash` in the resolver's `WHERE`, `keyIsPrevious` is `false`, and every refusal arm passes. Yet shard-01 §11 lever 4 lists `previous_key_expires_at = now()` as _the_ mechanism for "Revoke the key", latency "next request".

Worse, shard-03 §12.1 step 1 reads literally: _"`previous_key_expires_at = now()` **and rotate**"_. Executed in that order, the rotate (shard-03 §3.4) does `previous_key_hash ← key_hash; previous_key_expires_at ← now() + 7 days`. The containment action moves the **leaked** key into the grace slot and hands it a fresh seven-day licence. shard-03 §3.4 itself says _"The grace window is the exposure."_

**Fix.** Make key containment a single indivisible console action and a single statement — `UPDATE integrations SET key_hash = $newHash, previous_key_hash = NULL, previous_key_expires_at = NULL WHERE id = $1` — and remove "revoke now" as a separately-clickable operation. Rewrite shard-01 §11 lever 4, shard-03 §3.4 and §12.1 step 1 to name rotate-and-revoke as one primitive, with `status = 'suspended'` as the first move when in doubt (it is the only lever that is unconditionally correct). Add a table test asserting `relayRefusal` can never return `key_revoked` for `keyIsPrevious: false` — i.e. that a live `key_hash` has no revocation arm at all — so `relay-refusal-exhaustive` (which only proves reachability) stops papering over it.

---

## F3 — HIGH. `POST /v1/tickets/refresh` can **widen** scopes: `effectiveScopes` has three inputs and the refresh path needs four.

**Where:** shard-01 §8.2 (`effectiveScopes({ceiling, consented, requested})`), §10 request body (`{"scopes":[…]}` — _"optional; narrowing only"_), §10 rule 7, §8.2 `renewalRefusal`.

**Attack.** Rule 7 asserts _"`effectiveScopes` intersects against the old ticket's scopes, the live consent and the live ceiling"_ — four sets. The function takes three, and in the read path (§8.3) `requested` **is** the ticket's scopes. An implementer wiring refresh follows the signature and passes `requested: body.scopes`. The old ticket's scope set is then never a term. Result: a ticket minted at `/connect` carrying only `self:profile:read` is re-minted carrying `camp:manage_roles` — anything in the live consent ∩ ceiling — **with no navigation, no consent screen, no click**, for up to 24 hours. §5.4 rule 4 ("re-consent replaces") and shard-03 §5.2 ("Widening requires a fresh screen") are enforced only at `/connect`; the re-mint routes around both. The consent row is the union of everything the burner ever approved for that app, so the widening set is large in practice.

`bio:medical:read` is saved by `isRenewableScope`, so this is not a medical bypass — it destroys the "the ticket is a subset of what was last shown on a screen" property for the other 17 strings.

**Second defect, same function.** `if (!f.requestedScopes.every(isRenewableScope)) return "renewal_window_closed";` is **vacuously true for `[]`**. Since the body field is optional, an implementer who defaults it to `[]` for the renewability gate but to the old ticket's scopes for the mint sends a disclosing ticket straight past this check. Only `renewable_until IS NULL` then stops it — one control doing the work of two, which is exactly the shape §17 rejects elsewhere.

**Fix.** `effectiveScopes({ ceiling, consented, granted, requested })` where `granted` is the old ticket's `scopes`; refresh passes all four. Add `currentTicketScopes` to `RenewalFacts` and assert `requestedScopes ⊆ currentTicketScopes` inside `renewalRefusal`. Reject an empty/absent `requestedScopes` explicitly rather than relying on `Array.every`. CI: `refresh-cannot-widen`, a table over (old-ticket scopes × requested scopes) asserting the result is always a subset of the old set.

---

## F4 — HIGH. "No caller-supplied subject" is true of the **actor** and false of the **target** — and the CI check that enforces it is a string scan the medical endpoint's own URL shape defeats.

**Where the claim is made:** shard-01 §4.4 ("Any request field naming a subject — refused"), §18 `no-subject-id-in-v1`, shard-03 §10.2 refusal 9 and §11 row 1, shard-04 §10.1, shard-05 §4.3 item 3 and §14.1 row 1, shard-06 §12.2 (_"no method in any namespace accepts a subject id"_).
**Where it is contradicted, in the same round:** shard-01 §16.1 `GET /v1/burners/{id}/medical`; shard-01 §8.5 `GuardTarget.subjectUserId` — _"Comes from the PATH"_; shard-06 §7.2, literally `const notes = await me.bio.medical({ userId });`; shard-03 §8.4 `MedicalNotesResponse.subjectUserId: z.uuid()`, returning the raw `users.id` to the integrator.

**Attack.** The integrator _does_ name the burner whose medical notes it wants. The only thing between that parameter and an IDOR is `canViewMedicalNotes` (verified `packages/core/src/medical-access.ts:112-122`). That is a sound boundary — the problem is the check built to guard it. `no-subject-id-in-v1` scans for the **identifier `subjectUserId`** in request-parsing position; the canonical route in §16.1 names its path parameter `id`, so the check passes while the handler does the exact thing it exists to forbid. A reviewer citing it (shard-05 §14.1 tells them to) will approve a target-taking handler believing C1 is structurally closed. It is closed for the actor only.

Secondary: handing every integrator the platform `users.id` of every burner it touches gives cross-integration correlation for free, and makes any future id-taking endpoint an enumeration surface by construction.

**Fix.** Split the invariant and say so in all six places. (a) `no-caller-supplied-ACTOR` — nothing but the relay ticket may determine `caller.endUserId`; that is the real C1 closure and it is genuinely structural. (b) For targets, replace the string scan with a positive check: every id-taking `/v1` route must reach a `GUARDS[scope]` entry whose `GuardTarget` was built from `params`, with the route list committed as a manifest (`id-taking-routes-are-guarded`) so adding one without a guard fails the build. Correct shard-06 §12.2 and shard-03 §10.2 refusal 9 to read "no caller-supplied **actor**". Strongly consider emitting a per-integration pairwise opaque id on the wire instead of `users.id`.

---

## F5 — HIGH. `self:*:write` ships in the vocabulary, is renewable for 24 h unattended, has no privacy floor for the opt-in publics, and is audited nowhere — while shard-03 explicitly forbids write scopes in v0.1.

**The contradiction.** shard-03 §10.2 refusal 12: _"**Never ship a write scope in v0.1.** `enforcePrivacyFlags` has no floor for the opt-in publics (§8.6); a write path would let a third party flip a stranger's `legalName`/`homeCity`/`contactEmail` public. That is C1's damage multiplier."_ Against: shard-01 §8.2 `SelfScope` (three `:write` members), `RENEWABLE_SCOPES` (all three included), `GUARDS` (`"self:profile:write": async () => ({ allow: true })`), and shard-01 §21 item 3, which treats `self:profile:write` in `RENEWABLE_SCOPES` as a tuning question rather than a thing another shard bans outright.

**Verified in the repo, and shard-03 is right.** `enforcePrivacyFlags` forces only `ALWAYS_PRIVATE_FIELDS` to `false` (`packages/core/src/privacy.ts:104-112`), and `ALWAYS_PRIVATE_FIELDS` is `HARD_LOCKED_PRIVATE_FIELDS ∪ SAFETY_VISIBLE_FIELDS` (`:64-69`). `legalName` and `homeCity` are ordinary bio fields with no floor at all — `homeCity` even carries `defaultPublic: true` (`packages/core/src/bio.ts:170,175`). So a `self:profile:write` holder can publish a burner's legal name and home city.

**Attack.** A rogue or compromised integrator holding `self:profile:write` in consent+ceiling re-mints tickets server-to-server for 24 h with the burner absent and flips the privacy flags of every consenting burner to public. `enforcePrivacyFlags` corrects nothing here by design. **No audit row is written** — shard-02 §2.1's seven new actions are all integration lifecycle and it says so explicitly (_"None of them is a read"_, and none is a write either), and `resolveMedicalNotesForViewer` is the only audited `/v1` path in the round. So the burner's `/account/medical-access` page and the console's trail both show nothing.

Note the guard shape is itself the tell: `self:*` are the only six entries in `GUARDS` that consult no `@quagga/core` predicate, so `guards-call-core-only` must be written to exempt the whole block — and the exemption is precisely where the privacy decision disappears.

**Fix.** Resolve in favour of shard-03: no `:write` scope in v0.1. Remove the three from the delegable union (the count moves; fix it in one place, since shard-05 §"Scope of this shard" already warns nine "49" sentences are stale). If a write scope is ever wanted: add a third privacy class — fields a _delegated_ caller may never set public — enforced in `enforcePrivacyFlags`, not in a handler; require every delegated write to write an `audit_events` row through the proposed `packages/db/src/audit.ts` (shard-02 §1.1) with the end user as actor; and keep every write scope out of `RENEWABLE_SCOPES` so a write always costs a fresh, present click.

---

## F6 — MEDIUM-HIGH. `GET /v1/me/capabilities` is an unscoped, unconsented, unauditable disclosure of camp membership, leadership and permission sets — including free camps that are undiscoverable by design.

**Where:** shard-01 §16.1 (`GET /v1/me/capabilities` — credentials "key + ticket", **no scope named**); shard-06 §5 renders `rights.granted.camps` from it and states outright _"There is no `self:camps:read` scope, and inventing one is the mistake to avoid here… 'Which camps am I in, and what may I do there?' is answered by the manifest"_, returning `CampGrant[] = {groupId, slug, kind, backstop, permissions, questionnaires}`.

**Attack.** An app whose ceiling is `["self:profile:read"]` — or `["public:camps:read"]` plus any ticket — calls `/v1/me/capabilities` and receives the burner's complete camp membership list, which camps they lead (`backstop`), and their full per-camp permission set. That includes **free camps**, which the platform treats as a privacy law, not a filter: `apps/web/lib/groups-store.ts:187` is verbatim `if (!registered && !viewerRole) continue;`. shard-01 §8.5 is careful to route `public:camps:read` through that predicate and then hands the same facts over unscoped through the manifest.

It also breaks shard-03 §9.1 minimisation rule 1 (`ceiling ⊇ consent ⊇ ticket ⊇ effective`): the manifest sits outside the intersection entirely, so there is nothing for the burner to consent to and nothing short of revoking the whole app to withdraw. And the standard-tier consent copy (shard-01 §5.1) promises only _"read your own profile and bio"_ and _"see the member details of camps you lead"_ — the membership list is not disclosed, so the consent is not informed for it.

**Fix.** Bring the manifest inside the vocabulary. Preferred: the manifest returns only what the app's _effective_ scopes can already reach — a `self:profile:read`-only app gets `granted.camps: []`, and `granted.camps` is populated only when `camp:*` is admissible. Alternatively add `self:camps:read` and require it (shard-06 argues against inventing scopes; an unscoped side channel is worse). Either way, filter `granted.camps` through the same `registered || viewerRole` predicate, and name the membership list in the §5.1 copy.

---

## F7 — MEDIUM-HIGH. The canonical `/connect` example requests a mixed-tier ticket that §9.2 forbids, and the DB `CHECK` written to catch it does not check for mixing.

**Where:** shard-01 §6.1's example request — `&scopes=camp:view_member_details%20bio:medical:read` — against §9.2: _"A ticket carrying a disclosing scope carries **only** disclosing scopes. Mixing tiers on one ticket would let a 900 s standard ticket smuggle a medical scope; the mint refuses it, and a DB `CHECK` refuses it again."_

**The CHECK does not do that.** As written:

```sql
CHECK ( NOT (scopes @> '["bio:medical:read"]'::jsonb)
     OR (single_use = true AND renewable_until IS NULL) )
```

A row with `scopes = ["camp:view_member_details","bio:medical:read"]`, `single_use = true`, `renewable_until = NULL` **satisfies it**. The constraint enforces the TTL/single-use consequences of carrying a bio scope; it says nothing about tier purity. The only thing enforcing the stated invariant is prose about "the mint" — and the spec's own worked example asks for the forbidden shape, so that is what an implementer builds against.

Consequent hazards: (a) the three consent-screen variants (§5.1/5.2/5.3) have no rule for a mixed request, so it is undefined which copy the burner reads; (b) a single-use 120 s ticket that also carries the roster scope means one medical read destroys the app's roster access, and the cheap fix an implementer reaches for is the 900 s variant — which is the smuggling §9.2 exists to prevent.

**Fix.** Refuse a mixed request at `/connect` explicitly (not silently drop the bio scope); require a separate visit per tier, or mint two tickets. Change §6.1's example to single-tier. Strengthen the constraint to enforce what the prose claims:

```sql
CHECK ( NOT (scopes @> '["bio:medical:read"]'::jsonb)
     OR (jsonb_array_length(scopes) = 1 AND single_use AND renewable_until IS NULL) )
```

---

## F8 — MEDIUM. §5.3's "reconnect" variant has no disclosing-tier carve-out, so every medical grant _after the first_ is a lighter screen than the one §5.2 pins.

**Where:** shard-01 §5.3 — _"Reconnect (the consent already exists and is unchanged): Same screen, headed 'Reconnect Camp 404', listing the scopes unchanged"_ — against §5.2's _"No shortcut of any kind exists for this tier — no silent path, no remembered approval, no 'don't ask again'."_

**Attack (consent decay, no code required).** Consent is durable and **survives sign-out** (§12.2, explicitly). `bio:medical:read` therefore stays in `integration_consents.scopes` until the burner revokes. Every subsequent `/connect` for a medical ticket matches "already exists and unchanged" and gets the reconnect screen — not §5.2's screen with `MEDICAL_AUDIENCE_NOTE` reproduced verbatim, the _"we record it against **your** name"_ sentence, and the _"Allow for two minutes"_ button. Since medical tickets are single-use and 120 s, the reconnect path is the path — the full disclosing screen is shown exactly once, ever.

shard-03 §5.4 pins the disclosing copy with a test, on the reasoning borrowed from `MEDICAL_AUDIENCE_NOTE` (_"if it stops doing so, the consent basis is gone"_). But a test that the string exists and is imported does not test that the screen is **rendered**, and §5.3 is the thing that stops rendering it.

**Fix.** Make the reconnect variant structurally unreachable for the disclosing tier: if any requested scope has `scopeTier(s) === "disclosing"`, §5.2's screen renders, every time, with its own button label. CI: `disclosing-consent-has-no-reconnect-variant`, plus upgrade the pinned-copy test to assert the full screen renders for a _repeat_ grant.

---

## F9 — MEDIUM. A predicate-true medical read of an **empty** field returns 200 and writes no audit row — a free, unrecorded has/has-not signpost, and it makes §5.2's promise false.

**Where:** shard-02 §4.3 table row — _"predicate true, field empty | `200`, `{notes: null, unreadable: false}` | **none** — an empty field discloses nothing"_; guard `if (!isSelf && (notes || unreadable))` (shard-02 §4.1). Current source verified: `apps/web/lib/medical-access.ts:79` is `if (!isSelf && notes)`.

**Attack.** `{notes: null, unreadable: false}` versus `{notes: "…"}` is exactly the has/has-not bit that the org roster's disclosure signpost was **built and then deleted** to remove (`docs/accounts-security-spec.md:235-245` — cited by shard-03 §10.1 refusal 2 and again in §8.2, which insists `medicalNotesUnreadable` stay forbidden with the words _"Do not drop it because it is 'only a flag'; the roster signpost that was deleted was also only a flag"_). shard-02 §4.6 makes precisely this argument to start auditing `unreadable` — and then leaves the empty case, which is the same disclosure with the bit inverted.

Composed with **F1**, one consent click yields the has/has-not map of an entire camp, and every "no" answer leaves **no row at all**. So the consent screen's _"Every time Camp 404 reads it, we record it against your name"_ is false for exactly those reads, and `/account/medical-access` under-reports in the direction that matters.

**Fix.** On the `via` path, audit every read where `canViewMedicalNotes` returned true and the subject is not the actor, whatever the field contains. Add `meta.result: "notes" | "empty" | "unreadable"` — a closed enum, not a count, so shard-02 §2.3's monitoring ban is untouched and the scrubber's three-key list is unaffected. Amend shard-02 §4.3's table row and the `medical-refusal-writes-nothing` test in §8, which currently asserts the wrong thing for the empty case. (Refused reads stay unaudited — §4.3's reasoning there is correct and should not move.)

---

## F10 — MEDIUM. `camp:manage_roles` / `manage_members` / `assign_roles` are delegable **and renewable**, land on write paths that write no audit row at all, and are the one delegated surface that can mutate structural rights.

**Where:** shard-01 §8.2 `RENEWABLE_SCOPES` (all five camp scopes), §8.5 `GUARDS` (all five wired), §20 stage 3 ("The five camp guards") whose proof exercises only the read case. Against shard-03 §10.2 refusal 12 ("Never ship a write scope in v0.1") and §10.2 refusal 15.

**Verified in the repo.** `apps/web/lib/roles-store.ts` — which owns `setMemberRoles`, `createRole`, `setRolePermissions`, `assignOfficer`, `removeRole` — contains **zero** `auditEvents` inserts (`grep -c auditEvents` → 0). The only `apps/web` audit writers are `medical-access.ts`, `account-actions.ts`, `account-sanitize.ts`, `session.ts`. So a delegated camp write is invisible to the console's Activity trail, to the burner, and to shard-04's monthly review.

**Escalation shape.** `hasProjectPermission` short-circuits on `isPermissionBackstop(m.structuralRole)` (`packages/core/src/project-permissions.ts:24-26,42-47`), and `canViewMedicalNotes` keys camp access on `actorLeadCampIds` = camps where the actor holds a **structural** lead/admin role (`packages/core/src/medical-access.ts:85-88,112-122`). Any delegated endpoint that can set `memberships.role` therefore mints permanent first-party medical access for an attacker-chosen account — obtained without ever holding `bio:medical:read`, with no `bio.medical.view` row at the moment of escalation, and inside a 24-hour unattended re-mint window.

This is **latent, not live**: shard-01 §16.1 specifies no camp endpoints. That is the argument for fixing it now rather than at stage 3, when the guards already exist and wiring a route looks like a small change.

**Fix.** Ship stage 3 read-only — `camp:view_member_details` alone. Before any camp write scope: (a) prove no delegated route can alter `memberships.role` (assert it, don't assume it); (b) build `packages/db/src/audit.ts` (shard-02 §1.1 already proposes it) and require every delegated write to go through it with the end user as `actorId`; (c) remove all write scopes from `RENEWABLE_SCOPES`. Add `delegated-writes-are-audited` to CI.

---

## F11 — MEDIUM. The stripper's forbidden set omits the snake_case column names for five of the seven hard-locked fields, in the same const whose comment says physical column names are included _because_ schemas key on either shape.

**Where:** shard-03 §8.2. `FORBIDDEN_COLUMN_NAMES` is commented _"Physical column names, because a schema may key on either shape"_ and then lists snake_case only for `medical_notes`, `medical_notes_unreadable`, `sa_id_encrypted`, `passport_encrypted`.

**Verified in the repo** (`packages/db/src/schema.ts`): the five plaintext hard-locked columns are `phone: text("phone")` (`:632`), `onsiteContactName: text("onsite_contact_name")`, `onsiteContactPhone: text("onsite_contact_phone")`, `offsiteContactName: text("offsite_contact_name")`, `offsiteContactPhone: text("offsite_contact_phone")` (`:637-640`). `RESPONSE_FORBIDDEN_KEYS` picks up only the camelCase forms via `HARD_LOCKED_PRIVATE_FIELDS` (`packages/core/src/privacy.ts:39-47`). `REGISTRATION_CONTACT_KEYS` (verified verbatim at `apps/org/lib/queries.ts:952-960`) likewise has no snake_case forms.

**Attack.** A response DTO built from a raw SQL projection — `sql\`select onsite_contact_phone …\``is the idiom already in use at`packages/db/src/rate-limit.ts:106-125`and reused by the resolver in shard-01 §8.3 — that names`onsite_contact_phone`passes the poison-and-parse walk and every source scan, and ships an emergency contact number to an integrator. §8.5's "deliberately red" proof plants`phone` (camelCase) and so cannot discover this.

**Fix.** Derive the snake_case forms mechanically rather than by hand: `RESPONSE_FORBIDDEN_KEYS` = the four lists ∪ their `camelToSnake` images, computed in `privacy.ts` so the two can never drift. Add the officer-contact release columns to the walk's awareness. Make §8.5's deliberately-red commit plant a **snake_case** field, since that is the case the hand-written list gets wrong.

---

## F12 — MEDIUM. Three mutually incompatible `MedicalNotesResponse` shapes across the round, and the one in shard-03 puts `basis` on the wire — an org-affiliation disclosure no scope authorises.

**Where:** shard-03 §8.4 — `{ subjectUserId, state, medical, basis: z.enum(["self","org_staff","camp_lead"]), readAt }`. shard-02 §4.4 — `{ subjectUserId, notes, unreadable }`, with the explicit ruling: _"`basis` is deliberately NOT on the wire… That tells an app holding only `bio:medical:read` whether its own end user is AfrikaBurn org staff — an org-affiliation disclosure no scope in the vocabulary authorises, arriving as a side effect of a bio read"_, pinned by `medical-response-has-no-basis` (shard-02 §8). shard-01 §8.6 has a third shape, `{visible, notes, unreadable}`. shard-06 §7.2 consumes a fourth, `notes.state ∈ {"notes","empty","unreadable"}`.

**Second-order failure.** shard-03 §8.4's `MEDICAL_EXEMPTION.allowedForbiddenKeys = ["medical"]` names the field `medical`. shard-02's DTO names it `notes`. Whichever ships, if the exemption and the field name disagree the poison-and-parse test fails on the medical schema's own legitimate field — and shard-03 §8.4 has already predicted the cheap resolution: _"C2 predicted the cheap resolution would be to add an allowlist entry or a `.passthrough()`."_ The shards have arranged for that test to fail on day one.

**Fix.** Adopt one DTO: `{ subjectUserId: z.uuid(), state: z.enum(["notes","empty","unreadable"]), notes: z.string().nullable() }`. No `basis`, no `readAt`. Set `MEDICAL_EXEMPTION.allowedForbiddenKeys` to the field name actually used and make the exemption test assert it matches a key present in the schema (so a rename fails loudly rather than silently disarming the walk). Keep `medical-response-has-no-basis`.

---

## F13 — MEDIUM. "There is no long-lived refresh credential to steal" is false: key + any standard ticket **is** a 24-hour delegated credential, and the compromised-server runbook is sized off the false claim.

**Where:** shard-04 §7.4's table row — _"A refresh credential | **none exists** | —"_ — and step 3, _"The line to hold. There are no long-lived refresh tokens to steal."_ shard-03 threat 10: _"There is no long-lived credential to hold. The longest-lived artifact is a 900 s ticket."_

**Reality.** shard-01 §10 gives the integrator's server a re-mint requiring exactly (key, ticket) and **no burner interaction**, bounded by `renewable_until = min(session.expires_at, granted_at + 24h)`. A thief holding both therefore holds up to 24 h of full delegated access per burner, silently and unattended. For an app the burner opens daily, the chain is re-armed daily, so the practical exposure is continuous rather than "≤900 s". shard-04 §7.4's own table row _"Standard tickets | ≤900 s"_ is the ticket's TTL, not the credential's lifetime, and the two are conflated in the sentence a responder reads under pressure.

The severity call in §7.4 (_"very little on their disk worth stealing"_), the POPIA s22 scoping in §7.5, and shard-03 threat 10's LOW-MEDIUM rating all flow from this.

**Fix.** Correct the table and threat 10 to: _"key + ticket ⇒ up to 24 h of delegated access per burner, re-mintable without the burner, per consent."_ Change §7.4's containment step from "tickets aged out" reasoning to: suspend, then enumerate every `integration_consents` row whose `granted_at` or `last_used_at` falls within the compromise window + 24 h — that is the notification list. Optionally write a `security_events` row on server re-mint so `/account/connected-apps` can show the burner the app acted while they were away; this is a self-service record of the same kind as the session list, with no threshold, no count and no alert, so it does not touch the `AGENTS.md:172-177` monitoring ban.

---

## F14 — LOW-MEDIUM. A valid standard ticket presented to the medical endpoint returns `401 invalid_credentials`, and the SDK contract turns that into "delete the ticket".

**Where:** shard-01 §8.2 `relayRefusal` orders `if (tier === "disclosing" && !f.ticketSingleUse) return "unknown_ticket";` **above** `if (f.admissibleScopeCount === 0) return "empty_intersection";`.

**Effect.** A perfectly good 900 s standard ticket sent to `/v1/burners/{id}/medical` produces `unknown_ticket` → `401 invalid_credentials` (§13.2) rather than the correct `403 insufficient_scope`. shard-06 §8.2's `isCredentialDead` → `dropStoredTicket()` then destroys the integrator's working ticket. Any server that probes for medical access without first consulting the local `me.tier()` hint self-inflicts a reconnect on every probe — and the local hint is explicitly _"DX, not the boundary"_, so servers are entitled to skip it.

**Fix.** Move the `admissibleScopeCount === 0` arm above the tier-invariant arm: "you do not hold this scope" is a scope answer and belongs in the 403 bucket. Keep the tier arm below it for the genuinely corrupt case — a ticket that _does_ carry `bio:medical:read` with `single_use = false`, which is the mint-invariant violation it was written for. Add a `relayRefusal` table case for (standard ticket, disclosing endpoint) asserting `empty_intersection`.

---

## F15 — LOW. Existence-opacity is claimed for bytes and silently assumed for time; the medical guard's work is subject-dependent.

**Where:** shard-01 §13.2 (_"Identical bytes for all three"_), shard-03 §10.3 refusal 20, shard-02 §4.3. CI pins the bytes (`refusals-are-two-bucket`, the 404 row). Nothing pins, or can pin, the timing.

**Channel.** `loadMedicalAccessContext` folds memberships for **both** parties before `canViewMedicalNotes` runs. For a non-existent subject the subject-side fold returns nothing; for a real burner in several camps it returns rows. Authorise-then-select means the `burner_bios` select and `decryptField` run only on success (verified `apps/web/lib/medical-access.ts:45-63`), so the 200 path is already distinguishable — but the two 404 _flavours_ differ by a membership fold, on a driver where a single statement is measurably expensive (`packages/db/src/index.ts` records 152 ms/statement over SQL-over-HTTP locally). Weak, remote, and I would not block a stage on it.

**Fix.** Stop claiming unqualified existence-opacity: add one sentence beside §13.2 — _"identical bytes; response time is not equalised"_ — so nobody builds a stronger claim on top of it. If it is judged to matter, resolve subject existence and the subject's camp set in a single statement whose row-shape does not vary with existence.

---

### Cross-cutting note on ordering

**F1, F3, F5, F10 are all the same failure mode: an intersection defended perfectly at the join and then left undefended at the second statement.** The resolver is one atomic query and is genuinely strong; every finding above lives in what happens _after_ it — the burn (F1), the re-mint (F3), the write (F5, F10). The design's own justification (_"`createHttpDb()` has no transactions, so every fact that must be mutually consistent is established in one statement"_) is correct and is exactly why the post-join statements need the compare-and-swap discipline §10 rule 6 already demonstrates, applied uniformly. `packages/db/src/index.ts:37-39` also offers a pooled, transactional path that no shard considers, and the disclosing tier — one read, 120 s, the sharpest data in the product — is the one place its latency cost is obviously worth paying.

---

# 2. Implementability review — build plan and risk register

# IMPLEMENTABILITY REVIEW — `@afrikaburn/sdk` / `/v1` delegated identity

**Verdict: buildable by one engineer, but not as one project.** The design has no invented protocol, no new crypto, no new dependency and no better-auth change — those are the three things that usually make a spec like this unbuildable, and all three are clean. What makes it hard is (a) roughly **85–95 engineer-days**, (b) a stage-0 that puts a _live-production console-gate refactor_ on the critical path of a green-field feature, and (c) **two of the six shards specify a security model in exhaustive detail and never specify the resource surface it protects** — no HTTP paths, no DTOs for `camp:*`, one prose mention of `GET /v1/self/profile`. An implementer reaching stage 3 has to design an API from scratch.

---

## 1. Ordered build plan

Effort is engineer-days for one experienced engineer including tests, the CI invariant checks each item owns, and the doc edits shard 05 attaches to it. It assumes this repo's actual standards (100/100/100/100 floors on `packages/core/vitest.config.ts` privacy files, adversarial red-proof per `AGENTS.md`, PR review by the same person).

| #     | Workstream                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Days    | Ships alone?                                                           | Blocks                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **A** | **`packages/db/src/tokens.ts` promotion.** Move `newToken`/`hashToken` out of `apps/web/lib/account-tokens.ts` (`:1` carries `import "server-only"`, and `apps/org` cannot import from a sibling app), re-export so no call site changes, add `server-only` to the new file.                                                                                                                                                                                                                          | **0.5** | **Yes**                                                                | B, D                                                                                           |
| **B** | **The response-schema stripper** (shard-03 §8). `packages/types/src/responses/**` + `*Sample` per schema + the poison/`keysDeep` behavioural test in `@quagga/core` + the six-ban source scan + `no-open-ended-zod`. Includes promoting `REGISTRATION_CONTACT_KEYS` out of `apps/org/lib/queries.ts:952-960` into `packages/core/src/privacy.ts` and rewiring `queries.ts`, and resolving the `@quagga/types` subpath (today `exports` is exactly `{".": "./src/index.ts"}` — verified).              | **4**   | **Yes** — it is a first-party privacy control on its own merits        | every endpoint                                                                                 |
| **C** | **`loadCampPermissions`** — move `getMemberPermissions` (`apps/web/lib/roles-store.ts:869-909`) into `packages/db/src/actors.ts`, collapse `ViewerPermissionMembership` (`:857-860`) into `PermissionMembership`. Mechanical, low risk.                                                                                                                                                                                                                                                               | **1.5** | **Yes**                                                                | stage 3                                                                                        |
| **D** | **Migration 0029 + the pure module + the wrapper.** `delegation.ts` (`effectiveScopes`/`relayRefusal`/`renewalRefusal`/`scopeTier`) at 100% floors; the three tables; the hand-written FK/CHECK migration; `apps/web/middleware.ts` (no `apps/*/middleware.ts` exists today — verified); `apps/web/lib/v1/relay.ts`; the two-bucket refusal writer; the four rate-limit budgets on `consumeRateLimit` (`packages/db/src/rate-limit.ts:82`).                                                           | **8**   | No — needs B                                                           | everything                                                                                     |
| **E** | **Issuance console** — `apps/org/.../integrations` behind `requireSystemManager`: create, ceiling edit with `{before,after}` audit (house pattern, `apps/org/lib/actions/org-roles.ts:337`), rotate, revoke-now, suspend, key-shown-once.                                                                                                                                                                                                                                                             | **5**   | No — needs D                                                           | stage 2                                                                                        |
| **F** | **`pnpm sdk:local`** — sibling of `scripts/e2e-local.sh`, plus the minter whose refusal to target anything but the compose stack is CI-pinned. `grep sdk:local package.json` = 0 hits today.                                                                                                                                                                                                                                                                                                          | **2**   | No — needs E                                                           | every doc edit that prints the command (shard 05 §15 flags this ordering constraint correctly) |
| **G** | **`/connect` + consent + tickets + refresh + disconnect + `/account/connected-apps`.** Includes the `security_event_kind` enum additions (**a second migration**, see §2) and the mirrored `SecurityEventLogKind` zod enum + `describeSecurityEvent`.                                                                                                                                                                                                                                                 | **9**   | No                                                                     | all delegated scopes                                                                           |
| **H** | **`self:profile:read` + `GET /v1/me/capabilities`.** The manifest is the only thing that answers "which camps am I in" — there is deliberately no `self:camps:read` (shard-06 §5).                                                                                                                                                                                                                                                                                                                    | **4**   | No                                                                     | first useful slice                                                                             |
| **I** | **`public:*`** — six endpoints, six DTOs, the free-camp predicate wired through (`apps/web/lib/groups-store.ts:187`).                                                                                                                                                                                                                                                                                                                                                                                 | **4**   | Yes, once D lands                                                      | —                                                                                              |
| **J** | **The org-rank fail-closed fix** — `apps/web/lib/medical-access.ts:215` `?? "org_staff"` and the rank-blind fold at `:141-146`; `loadOrgActor` in `packages/db/src/actors.ts`; rewire `apps/org/lib/session.ts:216-235`. **This is a live production defect fix and should ship as its own PR regardless of the SDK.**                                                                                                                                                                                | **5**   | **Yes — and should**                                                   | stages 3 & 5 only                                                                              |
| **K** | **`camp:*`** — five guards + the member-list/detail endpoints and DTOs that **do not exist in any shard** (see §4.1). Effort is dominated by designing the surface, not the guards.                                                                                                                                                                                                                                                                                                                   | **7**   | No                                                                     | —                                                                                              |
| **L** | **Reading surfaces** — `/account/medical-access` (unbounded; `audit_events_subject_idx` and `audit_events_action_idx` already exist, `packages/db/src/schema.ts:1721,1735` — **no new index needed**), `viaIntegration` on `MedicalReadRow` (`apps/org/lib/medical-audit.ts:38-50`).                                                                                                                                                                                                                  | **5**   | **Yes — and should ship before any medical scope**, per shard-01 §14.4 | stage 5                                                                                        |
| **M** | **`bio:medical:read`** — the `via?` diff to `resolveMedicalNotesForViewer`, blocking audit, 503-no-body, 120 s single-use, the one-key exemption, the divergence paragraph in `docs/accounts-security-spec.md`.                                                                                                                                                                                                                                                                                       | **6**   | No                                                                     | —                                                                                              |
| **N** | **`@afrikaburn/sdk` publish** — client, `./browser`, `./testing`, `./errors`, generated stubs, manifest evaluator, licence walls, provenance. Shard-06 §1.2 lists **four places its API contradicts the accepted `docs/sdk/02`** (`createServerClient` returning a Promise at `02:266-268`; four published subpaths at `02:1485-1506`; `burners` on the key-only client at `02:422`; no `AuthenticationError.reason` at `02:1040`), so this is partly a rewrite of 02/03, not just an implementation. | **13**  | No                                                                     | —                                                                                              |
| **O** | **Docs & process** (shard 05): ~42 edits across 13 files, `commitlint.config.mjs` scope-enum, CODEOWNERS, PR template, `.github/dependabot.yml` (**does not exist** — verified), `apps/web/public/.well-known/security.txt` (**does not exist** — verified), branch protection.                                                                                                                                                                                                                       | **4**   | **Yes**                                                                | CODEOWNERS entries are inert until branch protection is on (`AGENTS.md:331-333`)               |

**Total ≈ 78 days of build + ~10 days of e2e/spec work (§3) ≈ 88 engineer-days ≈ 18 full-time weeks.** For a sole maintainer this is a 6–9 month elapsed project.

### The order that lands value earliest

```
A → B ─┬→ D → E → F ─┬→ G → H   ← FIRST USEFUL SLICE (§5)
       │              └→ I
       └→ (J in parallel, own PR)
                              → C → K → L → M → N
                    O trickles alongside; item O-1 (commitlint) first of all
```

**One correction to the spec's own staging.** Shard-01 §20 makes stage 0 — including the org-rank fix (J) — block _everything_. That is wrong for the first slice: `self:*` guards are `async () => ({ allow: true })` (shard-01 §8.5) because the subject _is_ `caller.endUserId` resolved from the session row; no `OrgActor`, no `MedicalAccessContext`, no `loadOrgActor` is on that path. J genuinely blocks `camp:*` and `bio:*` and nothing else. Keeping J on the critical path couples the riskiest production refactor in the plan to the least risky feature increment, for no security benefit. Ship J first _by preference_ (it is a live defect), not _by dependency_.

---

## 2. Migration sequence and its risk

Latest is `0028_questionnaire_responses_group_scope.sql` (verified). `packages/db/src/migrate.ts` runs the committed chain automatically on every Vercel build, under a session advisory lock on the **unpooled** endpoint. There is no staging. Three migrations are needed, not one.

**0029 — the three tables.** `integrations`, `integration_consents`, `integration_tickets`. Purely additive: three `CREATE TABLE`s, their indexes, one `CHECK`. The only outbound FK into existing data is `integration_tickets.session_id → "session"(id)` (`session.id` is `text` PK, `packages/db/src/schema.ts:378`) and `integration_consents.user_id → users(id)`. **Risk: low-and-catastrophic-if-wrong.** Nothing can break an existing query; the single failure mode is `ON DELETE SET NULL` instead of `CASCADE` on `session_id`, which silently deletes the entire revocation property. Shard-01 §19 item 3 and shard-04 §10.4 `session-fk-is-cascade` are the right mitigation, and the test must query `information_schema.referential_constraints`, not the Drizzle source — a Drizzle-source assertion passes if `schema.ts` says cascade and the _generated SQL_ says otherwise.

**Sequencing detail the spec gets right and an implementer will get wrong:** generate 0029 with `db:generate` and then **hand-edit before commit is not allowed** (append-only applies at merge, not at generation — you may edit a migration you have not yet committed). Write `schema.ts` with `references(() => session.id, { onDelete: "cascade" })`, generate, then _read the emitted SQL line by line_ and regenerate if it is wrong. Do not hand-write the file and skip the generator, or `meta/_journal.json` and the snapshot drift from the SQL and 0030 generates against a false baseline.

**0030 — `ALTER TYPE "security_event_kind" ADD VALUE 'app_connected'/'app_disconnected'`.** Needed by G, not by D — do not fold it into 0029. Shard-01 §21 item 4 flags the in-transaction semantics as version-dependent; that resolves cleanly: **PostgreSQL ≥ 12 permits `ADD VALUE` inside a transaction block provided the new value is not _used_ in the same transaction**, the local stack is `postgres:16-alpine` (`docker-compose.local.yml:24`) and Neon is 16/17. Nothing in 0030 inserts a row using either value, so this is safe. Confirm the Neon server version once; do not treat it as an open blocker.

**0031 (stage 5, optional) — none required.** `audit_events` already indexes `subject` and `action` (0024). `meta` is `jsonb`, so `via`/`integrationId`/`ticketId` need no DDL.

**The append-only risk that is actually live:** `SANITIZATION_PURGED_TABLES` (`packages/core/src/account-sanitization.ts:188-192`) is a _constant that nothing iterates_. `apps/web/lib/account-sanitize.ts:203-210` hard-codes three `delete()` calls. Adding `integration_consents`/`integration_tickets` to the constant satisfies shard-04's `consent-tables-in-erasure` check **and does nothing at runtime**. The purge code must be written too, and the CI check as specified would go green on a build that leaves live authorisations on erased accounts. Flag this to the implementer explicitly.

---

## 3. better-auth 1.6.25

**Nothing in this design requires bumping the pin, and I could not find a single point of contact with better-auth's own code.** Verified: `packages/auth/package.json` pins `better-auth` and `@better-auth/passkey` at exactly `1.6.25`. The design touches better-auth only through data it already owns:

- presence is `JOIN "session" s ON s.id = t.session_id` against a table declared in **our** `schema.ts:376-396`, not through any better-auth API;
- revocation rides `ON DELETE CASCADE` from `session` — a Postgres property, not a plugin behaviour;
- `revokeSessionsOnPasswordReset: true` is already set explicitly (`packages/auth/src/config.ts:96`);
- POPIA erasure already hard-deletes `session` rows (`SANITIZATION_IDENTITY_TABLES`, `account-sanitization.ts:211-215`);
- every rejected alternative that _would_ have needed a plugin (`oauth-provider`, `oidcProvider`, `bearer()`, `oneTimeToken`) is rejected.

**Two unverifiable claims, and what to do about them.** `node_modules` is absent here (verified — `ls node_modules` fails), so I could not confirm either of these and neither should be presented as fact:

1. **Does better-auth `UPDATE` the session row at `updateAge`, or delete-and-recreate it?** `AUTH_SESSION.updateAgeSeconds = 86400` (`packages/auth/src/env.ts:58`). If the refresh rotates `session.id`, `ON DELETE CASCADE` silently kills every outstanding ticket once a day and the 24-hour `renewable_until` window becomes unreliable in a way that looks like a random integrator bug. **This is a one-line experiment against the compose stack (insert a ticket, advance the clock past updateAge, re-request, check the row) and it must be run before 0029 is written**, because the answer changes the FK design.
2. Shard-01 §17's own provenance note already concedes the `oauth-provider` / `bearer()` / `oneTimeToken` internals are carried forward unverified. Re-confirm against the published 1.6.25 dist before stage 1, as it says.

**If a bump ever becomes necessary** (it will not for this feature; only a critical CVE justifies it per `AGENTS.md` rule 3): it is a standalone PR, the full gate re-greened, `pnpm e2e:local` run in full, and `session`-row semantics re-tested — never bundled with an SDK change.

---

## 4. Where the spec is under-specified enough that an implementer must guess

Ordered by how much damage the guess does.

**4.1 The entire resource surface for `camp:*` and `self:*` is missing.** Across all six shards, exactly four HTTP paths are specified: `GET /v1/burners/{id}/medical`, `GET /v1/me/capabilities`, `POST /v1/tickets/refresh`, `DELETE /v1/consent` (shard-01 §16.1). `GET /v1/self/profile` appears once, in a curl snippet at shard-06:1083, with no DTO. The camp roster — the actual Camp 404 screen, shard-06 §6 — exists only as an SDK method name, `me.camps.members.list({campId})`. No path, no pagination contract beyond "`nextCursor` with no `total`", no member DTO, no statement of whether the roster carries `contactEmail`. **An implementer will invent all of it, and inventing a member DTO is exactly where a `REGISTRATION_CONTACT_KEYS` field leaks.** This is ~4 days of design that must happen before K starts and it is not in anyone's estimate.

**4.2 `self:*` write scopes: the two shards flatly contradict each other.** Shard-01 §2 puts all six `self:*` strings in the vocabulary, `RENEWABLE_SCOPES` (§8.2) and `GUARDS` (§8.5) with `async () => ({allow:true})`. Shard-03 §10.1 refusal 12 is _"Never ship a write scope in v0.1"_, with a real reason: `enforcePrivacyFlags` (`packages/core/src/privacy.ts:108-116`) has no floor for the opt-in publics, so a write path lets a third party flip a stranger's `legalName`/`homeCity`/`contactEmail` to public. Shard-01 §21 item 3 half-acknowledges this for `self:profile:write` only. **Decision needed:** either the three `write` strings are absent from `DelegableScope` in v0.1 (my recommendation — it costs one line and closes the C1 damage multiplier), or shard-03's refusal 12 is struck. Shipping both documents as written produces a build where a CI table test and a documented refusal disagree.

**4.3 Where the key-rotation grace clock is evaluated.** Shard-01 §3.2/§8.3 puts `(i.key_hash = $ OR i.previous_key_hash = $)` in the `WHERE` and evaluates `previous_key_expires_at` in the pure `relayRefusal`, _specifically so `key_revoked` is reachable and testable with no database_. Shard-03 §3.4 puts the whole thing in SQL: `OR (i.previous_key_hash = $ AND i.previous_key_expires_at > now())`. **Shard-03's version makes `key_revoked` unreachable** — an expired previous key returns zero rows and collapses to `unknown_ticket` — which fails shard-04's own `relay-refusal-exhaustive` check. Shard-01 is correct; say so before someone copies the SQL from shard-03.

**4.4 Whether the consent screen sits inside the onboarding gate.** `/connect` is specified as `apps/web/app/(app)/connect/page.tsx` (shard-01 §5). `apps/web/app/(app)/layout.tsx` renders `AppShell` with `gatedNav`, and pages under it call `enforceGate` individually. A burner who has not completed their Burner Bio is _gated_. Does `/connect` gate them (they cannot connect Camp 404 until onboarding is done) or exempt itself? Nobody says. Both are defensible; picking silently means the first Camp 404 user with an incomplete bio hits an unexplained redirect loop through `/onboarding`.

**4.5 `packages/scopes` vs `packages/core/src/delegation.ts`.** `docs/sdk/00-decision.md:64` puts the vocabulary in a private `packages/scopes` workspace; shard-01 §8.2 puts it in `packages/core/src/delegation.ts`. Shard-01 wins for delegation, so core — but if anyone creates the workspace instead, `commitlint.config.mjs` `SCOPES` (ten entries, verified) rejects every commit touching it, and the coverage matrix's explicit `include:` list silently never runs its floors.

**4.6 `actors.ts` vs `actor.ts`.** Shard-01 §8.4 flags this itself. It is cosmetic and it is exactly the kind of thing that produces two half-done extractions. Pick before J starts.

**4.7 `ab_ik_` vs `ab_sk_`.** Shard-01 §9.1 changes an inherited decision (`06-review.md` A8 settled on `ab_sk_`) and says so honestly. Ryan picks; the only hard requirement is one prefix per credential class and no both-in-the-tree.

**4.8 Not under-specified but _unflagged_, and the highest-risk item in the plan:** `apps/org/lib/session.ts:216-231` resolves the console gate from **one** org group (`eq(memberships.groupId, orgGroup.id)`, `.limit(1)`). `apps/web/lib/medical-access.ts:108-118` deliberately resolves **every** `kind: 'org'` group, with a written-out reason ("more than one `kind:'org'` row is permitted… picking a single row failed OPEN"). Shard-01's `loadOrgActor` uses the multi-group, rank-strength form and instructs `apps/org/lib/session.ts` to adopt it. **That is a change to who can open the org console, applied at deploy against production, with no staging** — and the spec's own stage-0 proof fixture ("an `engineer` plus a later `member` row on a second org group") presupposes multi-org-group is real. Nobody names this. Before J merges: query production for `SELECT count(*) FROM groups WHERE kind='org'`. If it is 1, the change is a no-op and safe. If it is >1, the console's admission set changes and that needs a deliberate decision, not a refactor.

---

## 5. What cannot be tested without a browser → `pnpm e2e:local` specs

`apps/web/vitest.config.ts` has `include: ["lib/**/__tests__/**/*.test.ts"]` — **route handlers under `app/api/v1/**` are invisible to vitest.\*\* Two consequences an implementer must know up front:

- **All `/v1` logic must live in `apps/web/lib/v1/*`** (`relay.ts`, `guards.ts`, the refusal writer) so vitest can reach it; the `route.ts` files stay as thin as possible.
- **`e2e/fixtures.ts` exposes only `makeAppPage`/`webPage`/`orgPage`/`suppliersPage`** — there is no `APIRequestContext` fixture. One must be added (with the Vercel protection-bypass headers already handled in `e2e/lib/env.ts`) before any `/v1` spec can be written. ~0.5 d.
- **CI's e2e job matrix is persona-keyed with an explicit `include:` list** (`.github/workflows/ci.yml`). A new `e2e/specs/integration/` directory that is not added as a matrix row **never runs** — the same silent-green failure mode `scripts/e2e-local.sh` documents at length for the god persona.

Specs that must exist because no unit test can prove them (~10 days total):

| Spec                                 | Why only a browser                                                                                                                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connect-happy-path`                 | httpOnly apex cookie on a top-level navigation into `requireCampUser()`, consent server action, `302` to a **fragment**, `history.replaceState` clearing it. Every leg is browser behaviour.                                                    |
| `connect-refuses-iframe`             | `frame-ancestors 'none'` + `X-Frame-Options: DENY` (`config/security-headers.mjs:18-19`) is enforced by the browser, not the server.                                                                                                            |
| `redirect-uri-exact-match`           | a registered `https://x/cb` must refuse `https://x/cb?a=1`, `https://x/cb/`, `https://evil/cb`. Source-scanning `===` proves the operator, not the behaviour.                                                                                   |
| **`signout-cascades-tickets`**       | the single highest-value spec in the suite. Real sign-out through better-auth → real `DELETE FROM session` → ticket row gone → next `/v1` call `401`, **with no wait for expiry**. This is the only test that would catch `ON DELETE SET NULL`. |
| `password-reset-cascades`            | same, via `revokeSessionsOnPasswordReset` — exercises a code path only better-auth drives.                                                                                                                                                      |
| `disconnect-is-live`                 | burner disconnects at `/account/connected-apps`; the very next API call refuses. Proves "no cache, no sweep".                                                                                                                                   |
| `wrong-app-ticket-is-byte-identical` | app A's ticket + app B's key vs a bogus ticket — compare response bytes.                                                                                                                                                                        |
| `refresh-rotates-without-navigation` | the CAS re-mint, and the losing concurrent refresh getting `401`.                                                                                                                                                                               |
| `medical-single-use` (stage 5)       | ticket dead on second use; forced audit failure returns `503` **with an empty body**; the read then appears on the subject's own `/account/medical-access` page rendered as _"…through Camp 404"_.                                              |
| `cookie-is-ignored-on-v1`            | send a valid session cookie **and** a ticket for a _different_ burner; the answer must be the ticket's subject. This is finding C3, and it is invisible in every other test because the two subjects are normally the same person.              |

---

## 6. Risk register

| #   | Risk                                                                                                                                                                                          | Likelihood                                                    | Impact                                                     | Mitigation                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `ON DELETE SET NULL` on `integration_tickets.session_id` reaches production. Happy path byte-identical; revocation silently becomes TTL-only.                                                 | Medium (it is what a generator emits)                         | **Catastrophic, permanent — append-only chain**            | `session-fk-is-cascade` querying `information_schema.referential_constraints`; the `signout-cascades-tickets` spec; read 0029's emitted SQL line by line before commit |
| R2  | **The org-rank extraction (J) changes the console's admission set in production.** §4.8.                                                                                                      | Medium                                                        | High — lockout or silent elevation of console users        | Count `groups WHERE kind='org'` on production first; ship J as its own PR; both-row-order fixtures per shard-01 §8.4                                                   |
| R3  | The extraction copies `?? "org_staff"` instead of fixing it. Shard-01 §19 item 1. Failure is silent: console keeps refusing, API keeps allowing, the audit row honestly records a false rank. | Medium                                                        | High — widens the _only_ term that can grant               | `org-actor-fails-closed-on-non-rank` source scan; the `engineer` + later-`member` fixture that goes red on current code                                                |
| R4  | The blocking medical audit gets reverted as "removing an inconsistency" at 3am. Shard-01 §19 item 2.                                                                                          | Medium-high over time                                         | High — removes the entire basis for third-party disclosure | The divergence paragraph must live in `docs/accounts-security-spec.md` _immediately beside_ the fail-open paragraph, plus `medical-api-audits-before-response`         |
| R5  | `consent-tables-in-erasure` passes while erasure leaks. The constant is not iterated — `apps/web/lib/account-sanitize.ts:203-210` hard-codes deletes.                                         | **High** — the check as specified genuinely does not catch it | High — live authorisation survives a POPIA erasure         | Extend the check to assert an actual `delete(schema.integrationConsents)` call exists; add an integration test that erases an account holding a consent                |
| R6  | better-auth rotates `session.id` at `updateAge` (86400 s), cascading tickets away daily. **Unverified — `node_modules` absent.**                                                              | Unknown                                                       | Medium — looks like a random integrator bug                | Empirical test against the compose stack **before 0029 is written**                                                                                                    |
| R7  | The `camp:*` DTO is invented under time pressure and carries a `REGISTRATION_CONTACT_KEYS` field. §4.1.                                                                                       | Medium                                                        | High                                                       | Ship B (the stripper) before any endpoint — the poison test catches exactly this; design the surface as a written artefact before K                                    |
| R8  | `pnpm sdk:local` never lands, and the doc edits that print it ship anyway. Shard-05 §15 names this.                                                                                           | Medium                                                        | Low-medium — documents that lie                            | Land F in the same commit as its documentation, or write the future tense                                                                                              |
| R9  | Two credential prefixes (`ab_ik_` and `ab_sk_`) both end up in the tree; secret-scanning patterns registered for one.                                                                         | Low                                                           | Medium                                                     | Ryan decides §4.7 before D; register both regexes with GitHub push protection on day one regardless                                                                    |
| R10 | The `v1_subject` rate limiter is judged to violate the emergency rule (`docs/accounts-security-spec.md:313-314`) and is _removed_ rather than raised. Shard-01 §21 item 1.                    | Medium                                                        | Medium — a machine enumerating burners is nobody's job     | Ryan's decision, recorded; the fix is a bigger budget, never no counter                                                                                                |
| R11 | A new `e2e/specs/integration/` directory is added without a CI matrix row and never runs.                                                                                                     | Medium                                                        | Medium — a gate that cannot fail                           | Add the matrix row in the same PR as the first spec                                                                                                                    |
| R12 | Preview deployments expose `/v1`. `docs/deploy.md` is silent (shard-05 §16 item 2).                                                                                                           | Medium                                                        | Medium — a per-PR host with a live key surface             | Decide before the first preview after D; simplest answer is to refuse `/v1` when `VERCEL_ENV !== "production"`                                                         |
| R13 | The SDK's published API (shard-06) diverges from the accepted `docs/sdk/02` in four named places; both ship and teach different clients.                                                      | High if N starts before 02 is amended                         | Medium — irrevocable once published under Apache-2.0       | Amend 02/03 in the same commit as the guide, per shard-06 §1.2                                                                                                         |

---

## 7. The first slice

**Definition: `A + B + D + E + F + G + H` — key issuance, the connect/consent flow, tickets, and exactly two read endpoints: `GET /v1/self/profile` and `GET /v1/me/capabilities`. One scope, `self:profile:read`. ≈ 33 engineer-days.**

Why this is the smallest thing that is _coherent_:

- **It exercises the whole intersection.** Presence (cookie → session row → join), key ceiling, live consent, ticket scopes, refresh, the two-bucket refusals, disconnect, and cascade-on-signout are all fully in play. Everything after this slice adds resources, not mechanism.
- **It requires no `@quagga/core` rights predicate**, so it does not depend on J, the one production-refactor risk. The `self:*` guard is `allow: true` by construction because the subject _is_ the session's subject.
- **It is genuinely useful to Camp 404 on day one**, which `public:*` alone is not. `public:camps:read` returns registered camps and Camp 404 already knows its own camp; the free-camp rule (`apps/web/lib/groups-store.ts:187`) means it cannot even see itself if unregistered. What Camp 404 actually gets from this slice is (a) _"sign in with AfrikaBurn"_ identity linking, and (b) `me.rights.manifest()` → `granted.camps: CampGrant[]` (`docs/sdk/00-decision.md:128-135`), which answers _"which camps is this person in and what may they do there"_ — the exact question that lets Camp 404 start **deleting** its duplicated burner-profile store, which shard-06 §11 names as the whole point of the integration.
- **Its blast radius is the lowest available.** The only personal data crossing the boundary is a burner's own profile, to an app that burner clicked Approve for, through a schema that strips by construction.

**What is deliberately _not_ in the first slice:** every `write` scope (§4.2), all of `camp:*` (its surface does not exist yet), all of `bio:*` (L must ship first per shard-01 §14.4), and the published npm package — Camp 404 can integrate against raw `fetch` plus the discovery document while N is built. Publishing under Apache-2.0 is the one irrevocable act in the plan and should be the last thing that happens, not the first.

**Definition of done for the slice:** `pnpm sdk:local` mints a key against the compose stack and refuses anything else; a local burner completes consent in a real browser; Camp 404 reads that burner's profile and camp grants server-side; the burner signs out and the very next call `401`s with no expiry wait; the burner disconnects and the same happens; `pnpm turbo run lint typecheck test build` is green including the new invariant checks; and the commit hash where a planted `phone` field in a response schema failed CI is recorded in the README.

---

**Files that will change most, for reference:** `packages/db/src/schema.ts`, `packages/db/src/actors.ts` (new), `packages/db/src/tokens.ts` (new), `packages/db/migrations/0029_*.sql` + `0030_*.sql` (new), `packages/core/src/delegation.ts` (new), `packages/core/src/privacy.ts`, `packages/types/src/responses/**` (new) + `packages/types/package.json`, `apps/web/middleware.ts` (new), `apps/web/lib/v1/**` (new), `apps/web/app/api/v1/**` (new), `apps/web/app/(app)/connect/**` (new), `apps/web/lib/medical-access.ts`, `apps/web/lib/roles-store.ts`, `apps/web/lib/account-sanitize.ts`, `apps/org/lib/session.ts`, `apps/org/lib/queries.ts`, `apps/org/lib/medical-audit.ts`, `e2e/fixtures.ts`, `.github/workflows/ci.yml`, `commitlint.config.mjs`.

---

# 3. Completeness and coherence review

# Coherence and completeness audit — `sdk2` shards 01–06

Read: all six shards (8,252 lines) and `docs/sdk/{README,00-decision,01,02,04,05,06-review}.md`. Repo facts re-verified this session where cited.

---

# PART 1 — CONTRADICTIONS

## §1.1 Cross-shard contradictions

### X1 (P0, security) — `self:*` write scopes: shipped by shard-01, forbidden by shard-03

`shard-03:1090-1093` refusal 12: _"**Never ship a write scope in v0.1.** `enforcePrivacyFlags` has no floor for the opt-in publics (§8.6); a write path would let a third party flip a stranger's `legalName`/`homeCity`/`contactEmail` public. That is C1's damage multiplier."_ `shard-01:504-509` puts three write strings in `SelfScope`; `:549-567` puts all three in `RENEWABLE_SCOPES`; `:1201-1206` gives them unconditional `async () => ({ allow: true })` guards; `:1964` ships "`self:*`" as stage 2. `shard-01:1980-1983` (open item 3) asks Ryan only whether `self:profile:write` should be _renewable_, never whether it should exist.

**Owner: shard-01 §2.** This is the one contradiction that is a live hole rather than a naming clash. `enforcePrivacyFlags` (`packages/core/src/privacy.ts:108-116`) forces only `ALWAYS_PRIVATE_FIELDS` false — the opt-in publics have no floor, so a 24-hour renewable write ticket lets an integrator make a stranger's legal name public and then read it back through `public:profiles:read`. Resolution sketch: cut the three `self:*:write` strings from the delegable set for stage 2 (vocabulary stays 50 — they remain _scopes_, just not _delegable_ ones, exactly as `org:*` is), or build the missing opt-in-public floor in `privacy.ts` first and make that a stage-0 item. Do not resolve it by leaving both sentences in the tree; `shard-05:743` already tells reviewers to refuse `.passthrough()` on the grounds that C1's multiplier is closed, which will read as licence to assume this one is too.

### X2 (P0) — `MedicalNotesResponse` is defined three incompatible ways, and one definition kills the other's CI test

- `shard-02:634-638`: `z.object({ subjectUserId: z.string().uuid(), notes: z.string().nullable(), unreadable: z.boolean() })`, plus `shard-02:644-649` arguing at length that `basis` on the wire is an org-affiliation disclosure no scope authorises, pinned by `medical-response-has-no-basis` (`shard-02:905`).
- `shard-03:879-890`: `z.object({ subjectUserId: z.uuid(), state: z.enum(["notes","none","unreadable"]), medical: z.string().nullable(), basis: z.enum(["self","org_staff","camp_lead"]), readAt: z.iso.datetime() })`.
- `shard-06:685`: _"`notes.state` is `"notes" | "empty" | "unreadable"`"_ — a third enum member name.

**Owner: shard-03 §8.4 owns the schema mechanism; shard-02 §4.4 owns the disclosure argument.** Three consequences, not one. (i) shard-03's `basis` field goes red on shard-02's own test. (ii) shard-03's entire `MEDICAL_EXEMPTION` apparatus (`shard-03:868-874`, `allowedForbiddenKeys: ["medical"]`, plus the "exemption never widens" test at `:855-857`) is keyed on a field literally named `medical`, which is in `SAFETY_VISIBLE_FIELDS` (`packages/core/src/privacy.ts:57`, verified). Under shard-02's DTO the field is `notes`, which is in no forbidden list — so the exemption becomes dead code, the poison-and-parse test never exercises the one path it was built for, and shard-03 §8.5's deliberately-red proof has nothing to prove. (iii) `z.string().uuid()` vs `z.uuid()` contradicts shard-03's own repo-idiom note at `:781` and `:896`. Sketch: adopt shard-03's field names (`state` + `medical`) so the exemption stays live, adopt shard-02's exclusion of `basis`, use `"none"` not `"empty"`, and fix shard-06 §7.2's enum. Then `medical-response-has-no-basis` and `the medical exemption never widens` can both be written.

### X3 (P0) — Where the scope vocabulary lives, and under which licence — reopens `06-review` A3

`shard-01:490-529` declares `OrgScope`, `CampScope`, `SelfScope`, `PublicScope`, `BioScope` and the `Scope` union **inside `packages/core/src/delegation.ts`**. `shard-03:929-937` says the opposite in terms: _"The closed vocabulary is `@quagga/scopes` … that is where `bio:medical:read` and the `Scope` union must be added … `packages/core/src/delegation.ts` holds the delegation **rules** over that vocabulary — not the vocabulary … Adding `bio:medical:read` to `delegation.ts` alone would give the SDK a scope it cannot name and re-create the second-source-of-truth the whole design refuses."_

Licence, same package: `shard-03:930` calls it "PRIVATE, FSL, zero runtime deps" citing `00-decision.md:266`; `shard-05:180` and `:280-285` call it Apache-2.0-and-private citing `05-publishing-and-licensing.md:21, :653`. `05:653` does say `"license": "Apache-2.0"` alongside `"private": true`, and `05:678` makes the codegen boundary legal _only because_ "its OUTPUT is Apache-2.0 because its INPUT is". `06-review.md:353-359` (A3) already adjudicated this — ratify Apache-2.0-at-birth, correct the other shards in the same PR — and this round reproduces the error verbatim.

**Owner: shard-03 §9.1 for the location, shard-05 §2.12 for the licence.** Verified: `packages/scopes` does not exist (`ls packages/` → `auth core db eslint-config types typescript-config ui`). Sketch: shard-01 §8.2's code block keeps `ScopeTier`, `RENEWABLE_SCOPES`, `isDelegableScope`, `effectiveScopes`, `relayRefusal`, `renewalRefusal` and takes `import type { Scope } from "@quagga/scopes"`; the five type aliases move to `packages/scopes/src/`, which is Apache-2.0 at birth and `private: true`. Also implement `06-review` A1's actual fix while there: two tuples, `ORG_CAPABILITIES` (5) and `SDK_ORG_CAPABILITIES` (4), with a test asserting the difference is exactly `personal_information`. `shard-01:498-501` currently solves the 4-vs-5 problem by hand-writing the four capabilities into a template literal with a comment — which is the duplicate tuple A1 exists to prevent.

### X4 (P1) — The rotation grace clock: in the `WHERE` or in the pure function? `key_revoked` becomes unreachable

`shard-01:128-135` and the resolver at `shard-01:810` put only `(i.key_hash = $ OR i.previous_key_hash = $)` in SQL and evaluate the clock in `relayRefusal` (`shard-01:635-639`), _"so `key_revoked` is reachable and testable with no database"_. `shard-03:216-217` puts the clock in the join: `OR ( i.previous_key_hash = $keyHash AND i.previous_key_expires_at > now() )`.

**Owner: shard-01 §8.3.** Under shard-03's query an expired previous key returns zero rows, the resolver answers `unknown_ticket`, and the `key_revoked` arm of `RelayRefusal` is dead — which fails `relay-refusal-exhaustive` (`shard-01:1897`, `shard-04:1028`) and the 100/100/100/100 branch floor on `delegation.ts` (`shard-04:1066-1074`). Both wire to the same `401 invalid_credentials` bucket, so the divergence is invisible in behaviour and only detectable by the test — which is precisely why it will ship broken. Take shard-01's version and say why in the SQL comment.

### X5 (P1) — The medical resolver: four incompatible specifications of one 60-line function

Verified today: `apps/web/lib/medical-access.ts:37` exports `resolveMedicalNotesForViewer` and nothing else; `:79` is `if (!isSelf && notes)`; the `after()` block is `:81-92`.

|               | shard-01 §8.6                                                                         | shard-02 §4.1/§4.6                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| audit guard   | `if (!isSelf && notes)` (`:1281`) — unchanged                                         | `if (!isSelf && (notes \|\| unreadable))` (`:493`), + `meta.unreadable: true`, pinned by `medical-unreadable-is-audited-on-api` (`:898`)        |
| failure field | `auditUnavailable?: boolean` (`:1243`)                                                | `auditFailed` as a discriminated union (`:479-485`)                                                                                             |
| failure value | `{ visible: false, … }` (`:1309`)                                                     | `{ visible: true, notes: null, … }` (`:518`)                                                                                                    |
| `meta`        | `{ basis, via, integrationId, consentId, ticketId, scope, requestId }` (`:1290-1300`) | same **plus `groupId: string \| null`**, mandatory on all three writers (`:151-153`, `:501`), pinned by `medical-audit-meta-is-closed` (`:893`) |
| null `basis`  | not handled                                                                           | **503** (`:182-186`, `:518`), pinned by `medical-basis-union-is-three` (`:896`)                                                                 |
| `ctx?` param  | absent                                                                                | present (`:475-477`), threading one snapshot so guard and resolver do not race                                                                  |

**Owner: shard-02.** shard-01 §8.6's code block, as written, fails two of shard-02's own CI tests. Sketch: delete shard-01 §8.6's diff and replace it with a pointer to shard-02 §4.1. Note the `ctx?` parameter is not cosmetic — shard-01 §8.5's guard calls `loadMedicalAccessContext(db(), …)` and then `resolveMedicalNotesForViewer` calls the module-private `buildMedicalAccessContext` again, so the three-query context build runs twice per medical read and a membership change landing between them 404s a read the guard allowed (shard-02 §9 item 2 raises this; nothing resolves it).

### X6 (P1) — `packages/db/src/actor.ts` vs `actors.ts`, and two `loadCampPermissions` signatures

Plural: `shard-01:863`, `:940`; `shard-02:415`; `shard-04:441`, `:745`. Singular: `shard-03:25-27` and its §1 flowchart at `:58`; `shard-05:578` (_"singular, as `docs/sdk/04-backend-work-required.md:935` and `:1422` name it"_) and `:1174`. Verified: `ls packages/db/src/` contains neither, and `grep -rn "loadOrgActor|loadCampPermissions|loadMedicalAccessContext" apps packages` → 0.

Signature, separately: `shard-01:1081` is single-group `(db, dbUserId, groupId) => Promise<PermissionMembership | null>`; `shard-02:418` is `(db, dbUserId, groupIds?) => Promise<…>`, keeping the inherited plural shape from `04:942-946`.

**Owner: shard-01 §8.4** — it raised the flag (`shard-01:927-937`: _"Pick one filename before stage 0 starts"_) and nobody picked. It matters more than a filename because `shard-05:578` writes the singular into `CONTRIBUTING.md` item 6 as the _only sanctioned way_ to turn a `users.id` into an actor, and `shard-05:1174` writes it into `docs/roadmap.md`. Sketch: choose `actors.ts` (the file holds three loaders), choose the single-group return because it is exactly `hasProjectPermission`'s input and matches `getMemberPermissions` at `apps/web/lib/roles-store.ts:869`, and amend both shard-05 edits in the same commit.

### X7 (P1) — "The four blocking prerequisites" names two different sets of four

`shard-01:1962` (stage 0): (a) the `medical-access.ts:215` rank coercion fails closed, (b) extract the actor loaders, (c) build the PII stripper, (d) branch protection. `shard-04:440-442` (the `bio:medical:read` issuance gate): _"`packages/db/src/actors.ts` extracted and failing closed; `stripHardLocked` built; `/account/medical-access` live; branch protection."_ shard-04 swaps the rank fix out and the burner-facing reader in — which shard-01 puts at stage 4. `shard-05:1172-1176` copies shard-01's four verbatim into `docs/roadmap.md`.

**Owner: shard-01 §20.** Both lists are individually right about their own gate and wrong as a shared phrase. Sketch: rename them — "stage 0 (four first-party fixes)" vs "the medical issuance gate (stage 0 complete **plus** `/account/medical-access` and `viaIntegration` shipped)" — and make shard-04 §5.5 say "all four stage-0 items, plus stage 4". As written, an implementer reading shard-04 §5.5 alone can issue a medical ceiling with `apps/web/lib/medical-access.ts:215` still coercing `null → "org_staff"` (verified present today), which is the exact fail-open shard-02 §3 calls _"stage 0. Nothing in the SDK workstream starts before it is green."_

### X8 (P1) — Who mints `state`, and is it a CSRF control?

`shard-01:321-326`: _"`startConnect()` persists whatever the caller wants to carry in the caller's own `sessionStorage`, keyed by `state`; we echo `state` and nothing else"_ — leaving `state`'s origin unstated and implying browser-side. `shard-06:258-262` mints it server-side with `randomBytes(32)` into an `abConnectAttempts` row bound to the Camp 404 session, and `shard-06:340-343` flags the conflict itself: _"Both cannot ship — if `state` is browser-minted it is not a CSRF control and must be documented as decorative."_

**Owner: shard-01 §6.1.** shard-06 is right, and the failure is concrete: `shard-06:399-402` records that without the session predicate on the state row, _"an attacker who obtains a state value can bind their own AfrikaBurn account to someone else's Camp 404 account."_ Sketch: shard-01 §6.1 states that `state` is server-minted and session-bound on the integrator side, that `startConnect`'s default `startPath` posts to the integrator's own origin to obtain it, and that the platform treats `state` purely as an opaque echo (which it already does — the charset/length bound at `shard-01:318` stands).

### X9 (P2) — `integration.key.rotated`: folded or not

`shard-02:88`, `:97`: folded into `integration.key.created` with `{ rotatedFrom }`, on the reasoning that _"two actions for one event doubles the `ACTIVITY_LABELS` surface and splits the answer to 'when was this key last changed'."_ `shard-03:226-228`: _"Every one of the three writes an `audit_events` row: `integration.key.rotated`, `integration.key.revoked`, `integration.suspended`."_ `shard-04:123-126` notices the split and defers (_"Read whichever the implementation lands on"_), which is the one thing a monthly-review procedure cannot do — its query is `WHERE action = …`.

**Owner: shard-02 §2.1** (it holds the superseding vocabulary table against `04` §4.3.10). `shard-02:904`'s `every-integration-action-has-a-label` cannot be written against two lists.

### X10 (P2) — Rate-limit budgets: two tables, different keys, different numbers, and one wrong ordering

`shard-01:1810-1815`: four keys — `v1_ip` 600/60 s, `v1_key` 300/60 s, `v1_subject` 60/60 s, `connect_mint:<endUserId>` 30/300 s. `shard-03:557-563`: five keys — the same first three, plus `v1_mint:<integrationId>` 60/60 s for the server re-mint and `connect:<userId>` 20/60 s. So the `/connect` budget differs in name, key and number, and shard-01's §10 refresh endpoint has **no limiter at all** under shard-01's own table.

Separately, ordering: `shard-01:403-406` is explicit that `v1_subject` _cannot_ be pre-join because its key contains `endUserId`, an output of the join, and consumes it at step 5. `shard-03:48` draws `W3["3 rate-limit budgets ip · integration · integration:subject"] --> W4["ONE join…"]`.

**Owner: shard-03 §6.2** (it holds the fuller table and the open decision at `shard-03:1272`). Adopt shard-03's five keys, adopt shard-01's ordering, redraw the §1 flowchart. Note both shards correctly record that `consumeRateLimit` fails **open** (`packages/db/src/rate-limit.ts:75-77`) — that property must survive into shard-04 §7's incident sizing, which `shard-03:578-582` says out loud and shard-04 does not.

### X11 (P3) — Public-tier ticket TTL

`shard-01:1379`: public tier — "no ticket required", TTL "—". `shard-03:292-296`: `TICKET_TTL_SECONDS: { readonly [T in ScopeTier]: number } = { public: 900, standard: 900, disclosing: 120 }` — a total mapped type, so `public` must carry a number. Owner: shard-03. One comment saying the `public` entry exists only for totality and is unreachable.

### X12 (P3) — A stale open item that is already answered

`shard-02:111-117` and `shard-02:943-945` (open item 9) assert _"shard-01 specifies `integration_consents` with `revoked_at` only (`shard-01:299, :468`) and no revoker column … If shard-01 declines the column, `revokedBy` must be dropped."_ It does not decline: `shard-01:1493`, `:1543` and the state machine at `:1730-1733` all carry `revoked_by`, and `shard-03:385-387`, `:403` define `consentRevokerEnum` as a four-value `pgEnum`. **Owner: shard-02** — delete open item 9. Left in, it invites an implementer to drop a column three other shards and shard-04 §7.2 step 4 depend on.

---

## §1.2 Contradictions with the inherited `docs/sdk/` spec

### Y1 (P1) — Camp probes: `00-decision.md:255` says **200 with empty permissions**, every shard says 404

Verbatim at `00:255`: _"Camp probes return **200 with empty permissions** for 'no such camp' / 'free camp you cannot see' / 'camp exists, key holds nothing' — same bytes, same latency budget, closing the timing channel as well as the status channel."_ Decision 18 (`00:38`) makes the mode server-authored. Every shard this round returns 404 with identical bytes instead: `shard-01:1627`, `shard-02:615`, `shard-03:1120`, `shard-06:751`, `shard-06:1129-1134`.

**Owner: shard-03** — it maintains the named-supersessions table at `shard-03:11-19` and this row is missing from it. Both designs are defensible, but 00's also closed a **timing** channel that no shard discusses: a 404 that runs the free-camp predicate takes measurably longer than a 404 that finds no row. Sketch: add the row, state the supersession, and add one sentence on timing (or a constant-work note) so the deletion of that property is deliberate.

### Y2 (P1) — The three-code refusal taxonomy and the `Refusal` union

`00:253`: _"Ceiling first (`insufficient_scope`, key-level), then the live guard (`insufficient_rights`, subject-level), then `rank_ceiling` reported first among refusals … Three codes, three different people to go ask."_ The new design has no `insufficient_rights` — the rights gate is a 404 (`shard-01:464`, `shard-03:74`). `00:136-149`'s `Refusal` union still carries `rank_ceiling`, `not_delegated`, `key_ceiling`, `wrong_department`, `unowned_domain`, and `mode: "explain" | "notFound"`. Nothing in the round says what becomes of it. **Owner: shard-03** — one row in the supersessions table, plus a decision on whether `Refusal` survives at all (it is the manifest's, and the manifest is unspecified — see Z2).

### Y3 (P0) — `06-review` C2 is still open, and stage 2 walks into it

C2 (`06:152-166`) is CRITICAL and unresolved: `self:profile:read` was wired to `getBio` (`apps/web/lib/bio-store.ts:52`), which `db().select()`s every column of `burner_bios` — all seven `HARD_LOCKED_PRIVATE_FIELDS` plus `medical` — and **`SelfProfile` is defined nowhere in the spec**. shard-01 §20 stage 2 ships `self:*`; `shard-01:1797` re-asserts that `04:415` ("anything selecting `HARD_LOCKED_PRIVATE_FIELDS`") stands verbatim. No shard writes `SelfProfile`; `shard-06:489` calls `me.self.profile()` as if it existed. **Owner: shard-03 §8** (response schemas) plus whoever owns the endpoint list. Sketch: `SelfProfileResponse` is `PublicBio`'s field set plus the burner's own non-locked extras, with the seven hard-locked names and `medical` absent from the type, added to the deliberately-red set (`shard-03:904-910`) so a commit adding `phone` goes red. Ship it in the same commit as the `self:*` guards or stage 2 reintroduces C2 in production.

### Y4 (P1) — `@quagga/types/responses` does not resolve, and shard-03's own samples use a two-level subpath

`shard-03:686-695` correctly flags that `packages/types/package.json` declares exactly one export path (verified: `"exports": { ".": "./src/index.ts" }`) so `@quagga/types/responses` is unresolvable, and asks for a decision — _"Pick one before writing a handler; a spec that ships unresolvable import specifiers gets 'fixed' by whoever hits it first, at speed."_ Then `shard-03:805` imports `@quagga/types/responses` and `shard-03:871` sets `MEDICAL_EXEMPTION.module = "@quagga/types/responses/medical"`, a **two-level** subpath nobody proposes adding. `shard-05:179`, `:495` tell contributors DTOs live in `packages/types` without naming a specifier. **Owner: shard-03 §8.1** — make the decision, then make the three samples agree with it.

### Y5 (P2) — Two `.well-known` discovery documents, neither specified

`shard-01:1780` adds `GET /.well-known/afrikaburn-integration` (_"Discovery, so an integrator who is not on Node is not stranded on our SDK"_) with no contents. `00:306` §5 item 16 schedules `/.well-known/afrikaburn-scopes` for v1.0. Separately `shard-04:235` and `shard-04:1063` require `apps/web/public/.well-known/security.txt` and ship `security-txt-not-expiring` as a CI check — verified `apps/web/public/.well-known/` does not exist, so that check is red on day one (which `shard-04:1064` says is the point for `dependabot.yml`, but does not say for `security.txt`). **Owner: shard-01 §16.1.** Name one path, specify its JSON, and say whether `security.txt` ships in the same directory.

---

# PART 2 — SPECIFIED NOWHERE

### Z1 (P0 — highest-consequence gap in the round) — the migration 0029 DDL

Three tables land: `integrations`, `integration_consents`, `integration_tickets`. Only **one** is written out: `shard-03:389-408` gives `integration_consents` in full. `integrations` gets three key columns (`shard-03:208-210`) and a prose field list (`shard-01:112-118`); `integration_tickets` gets one FK (`shard-01:170-172`) and one CHECK (`shard-01:1388-1392`). Never specified anywhere: `integration_tickets`' full column set, its indexes, the uniqueness of `token_hash`, `integrations`' PK/slug uniqueness/status enum/`redirect_uris` shape, and the delete rules on `integration_tickets.consent_id`.

Verified: migrations are append-only, latest is `0028_questionnaire_responses_group_scope.sql`, applied at deploy against production with no staging. `shard-01:1942-1952` and `shard-05:1410-1416` both say every FK must be _"written by hand with its reason in the migration file"_ and read _"line by line before approving"_ — and then no shard supplies the lines. **Owner: shard-03 §5** (it holds the only DDL that exists). Sketch: one section carrying all three `CREATE TABLE` statements with a one-line reason comment per constraint, the two `ALTER TYPE security_event_kind ADD VALUE` statements, the disclosing-policy CHECK, and the FK delete rules spelled out — `session_id → session(id) ON DELETE CASCADE`, `consent_id → integration_consents(id) ON DELETE CASCADE`, `integration_id → integrations(id) ON DELETE RESTRICT`, `user_id → users(id) ON DELETE CASCADE`. Then `session-fk-is-cascade` (`shard-01:1907`, `shard-04:1054`) has something to assert against.

### Z2 (P0) — The capability manifest has no type under the new identity model

`00:93-120` defines `Manifest` with `subject: { kind: "service"; id; rank }` and `key: { id, prefix, name, integrationSlug }`. The service user is abolished (`shard-01:66-67`, `shard-01:1910-1917` deletes its three invariant tests, and `users.kind` is verified absent from `packages/db/src/schema.ts:283-306`). `shard-01:1778` lists `GET /v1/me/capabilities` with one note (_"H1 fix mandatory"_) and no shape. `shard-06:489`, `:578-580` consume `me.rights.manifest()`, `rights.granted.camps` and `rights.can("camp:view_member_details", { campId })` — `can()` is not on `00`'s `Manifest` either.

**Owner: needs a home; nearest is shard-01 §16.1 or a dedicated section of the new `07`.** Sketch: `subject` becomes `{ id, kind: "burner" }` resolved from the ticket (never a rank label — `00:104`'s _"'god' never crosses"_ now extends to every org rank, since `org:*` is not delegable); `key` becomes `{ integrationSlug }` only; `granted.org` is removed entirely; `granted.camps` keeps `CampGrant` (`00:128-135`) with `manage_roles ⇒ assign_roles` still materialised server-side per decision 20; `routes` is **deleted**, not fixed — H1 (`06:195-206`) is a credential-exfiltration primitive and `shard-01:1778` already mandates the SDK hardcode its base URL, so the field has no remaining consumer. Say what `expiresAt`/TTL means when the ticket is the authority and there is no cache (`shard-01:1871` forbids caching rights at all — a manifest with a 300 s TTL and that rule cannot both be true).

### Z3 (P1) — `integration_consents.last_used_at` has a column and no writer

It exists at `shard-03:404`. It is the **sole input** to shard-04 monthly item 2 (`shard-04:87-100`) and to §6.1's standing rule _"A key with no request in 60 days has its integration suspended. Not warned about. Suspended."_ No shard specifies where it is written. Under shard-01's design that is a real decision, not an oversight: `shard-01:749-757` makes the resolver **one statement** on a driver with no transactions (`packages/db/src/index.ts:37-39`), so an extra `UPDATE` per request is either a second round trip or it does not happen. **Owner: shard-03 §5.1** (it owns the column) with shard-01 §7.2 stating where in the order it runs. Sketch: write it on the consent row from the wrapper after the guard says yes, coalesced to at most once per hour per consent (`WHERE last_used_at IS NULL OR last_used_at < now() - interval '1 hour'`), so a busy integration does not pay a write per read. Note it is a timestamp about a person's activity in a table shard-03 §5.6 correctly purges at erasure — so the hour-granularity is also a minimisation choice worth writing down.

### Z4 (P1) — `pnpm sdk:local` is described four different ways and specified by nobody

Verified: `grep -n sdk:local package.json` → 0; the root has only `"e2e:local": "./scripts/e2e-local.sh"` at `:15`. Yet it is a gate in `shard-05:149` (README), `:337` (AGENTS), `:704` (CONTRIBUTING), `:1496` (PR template checkbox), a stage-1 proof at `shard-01:1963`, a CI check `sdk-local-refuses-non-local` at `shard-04:1062`, a SECURITY.md instruction at `shard-05:840`, and an integrator instruction at `shard-06:839`. The script's identity: `shard-05:1386` names `scripts/sdk-local.sh` and admits at `:1426-1431` that it is _"this shard's own coinage … not named anywhere else in the round"_; `shard-03:1003-1007` calls it the prior spec's `mint-local-key.mts`; `shard-06:848-856` gives the most detailed behaviour spec of the four (checks `NODE_ENV`, `NEON_LOCAL_PROXY=1`, a DB-host allowlist, and the URL against `neon.tech|vercel|amazonaws`, and takes the redirect URI as an argument).

**Owner: shard-05 §15** already states the ordering constraint correctly (_"Either those edits ride in the same commit as the runner, or the first pass writes the command in the future tense"_). What is missing is the runner itself. Sketch: promote shard-06 §9.1's behaviour list into a specification, settle the filename, and make `sdk-local-refuses-non-local` assert against those four checks by name.

### Z5 (P1) — The SDK client surface shard-06 is written against is scheduled by nobody

`shard-06:61-81` lists seven names as _this round's_ and not in the accepted core reference: synchronous `createClient`, `.as(ticket)`, `ab.connect.url()`, `ab.tickets.remint()`, `me.rights.manifest()`, `me.tier(scope)`, `AuthenticationError.reason`, plus the `@afrikaburn/sdk/browser` and `/testing` subpaths. It correctly names the four places `02-core-api-reference.md` says the opposite (`02:266-268` returns a `Promise`; `02:1485-1506` publishes four subpaths, neither `./browser` nor `./testing`; `02:422` puts `burners` on the key-only client; `02:1040` has no `reason` discriminant) and says _"all four must move in the same commit as this guide or the two will teach different clients."_

**Nobody owns that commit.** `shard-05:11-15` enumerates thirteen files it changes plus one it creates; `docs/sdk/02` and `03` are not among them. Additionally: `06-review` C1 (`06:490-500`) already recorded that `@afrikaburn/sdk/testing` is imported and never built, and `shard-06:901-954` builds a whole test section on `createMockClient` / `mockAb.expire()` / `InsufficientScopeError` / `AuthenticationError.reason` with no specification behind any of them. `me.tier(scope)` at `shard-06:679` has no stated return type at all — from usage it is truthy-when-the-ticket-carries-that-tier, which is a fifth thing a ticket knows. **Owner: shard-05 must add `docs/sdk/02` and `03` to its file list, or a seventh shard must own the client surface.** Without it, shard-06 is a contract against an API that does not exist and is not scheduled.

### Z6 (P2) — Endpoints an integrator calls, absent from the endpoint table

`shard-01:1772-1780` lists seven surfaces. `shard-06` calls, in code: `ab.editions.active()` (`:532`), `ab.camps.list({ editionId, limit })` (`:533`), `me.self.profile()` (`:489`), `me.camps.members.list({ campId, limit })` (`:580`), `me.bio.medical({ userId })` (`:683`). None appears in shard-01's table. Note also that shard-06 addresses medical by `{campId, userId}` while the only specified route is `GET /v1/burners/{id}/medical` (`shard-01:1779`) — and `shard-01:1123-1125` says the subject "comes from the PATH, resolved from a public identifier", which for a burner is presumably the username, unspecified. `06-review` B1 (`06:458-463`) additionally records that camp/org **writes** — the brief's headline verb — are specified nowhere and that no `camp:` permission exists for _creating_ a group; this round does not touch that.

### Z7 (P2) — `DELETE /v1/consent` and `approveConnection` have no contracts

`shard-01:1777` lists `DELETE /v1/consent` (key + ticket). No body, no response, no scope requirement, no statement of what it does to outstanding tickets beyond "same as row 1", and shard-06 — the consumer guide — never mentions it. `shard-01:1775` lists the server action `approveConnection` with no signature; the reconnect variant at `shard-01:257-260` must render "when they were first granted", so it needs `granted_at` in its loader. **Owner: shard-01 §16.1.**

### Z8 (P2) — Action strings used by the procedures and absent from the vocabulary

- **`integration.call.refused`** — shard-04 monthly item 6 (`:143-159`) and runbook §7.1 step 2 (`:622-625`) both query it. shard-02 §2.1 enumerates **seven** lifecycle actions and states _"none of them is a read"_, so the action is outside the superseding vocabulary. shard-04 flags this itself and offers a fallback ("structured server logs") without specifying the log line. **Owner: shard-02 §2.1** — adopt it with `actor_id = NULL`, ids/enums/`requestId` only, and **no `subject`** (shard-04's own constraint at `:151-154`), or delete monthly item 6 and specify the log format instead.
- **`integration.resumed`** — `shard-02:90` notes shard-01 defines `status: active | suspended` only and says _"if a resume control ships, it needs a row and a label; flagged in §9"_ — §9 does not carry it. It does ship: `shard-04:507` (_"reversible in one row"_) and `shard-04:92` (_"Re-activation is one row and one audit event"_). Action string and `ACTIVITY_LABELS` entry both unspecified.
- **`ACTIVITY_LABELS` strings** — `shard-02:904` requires `every-integration-action-has-a-label` (`apps/org/lib/status-board-format.ts:10-47`). No shard writes the display strings, and `shard-02:118-120` warns _"Adding the action without the label is half the change."_
- **`securityEventKindEnum` labels** — verified nine members at `packages/db/src/schema.ts:212-222`, with the comment at `:208-211` stating they mirror `SecurityEventLogKind` in `@quagga/types` and `describeSecurityEvent` in `@quagga/core`. Three shards require `app_connected`/`app_disconnected` (`shard-01:1543-1549`, `shard-03:461-468`, `shard-04:693-696`); shard-01 correctly notes the zod-enum edit is also required. **Nobody writes the two display titles**, and `shard-04:695` says out loud _"Writing the row without the title renders nothing."_

### Z9 (P3) — Error codes the consumer guide does not carry

`shard-01:1622-1631` has eight wire rows. `shard-06:747-753` gives Camp 404 six — omitting `400 invalid_request` and `503 no_active_edition`. `X-AfrikaBurn-Accepted-Scopes` (`shard-01:1626`) has no specified format and, inherited from `00:257`, used to be on _every_ response including 200s; the change is unremarked. **Owner: shard-06 §8.1.**

### Z10 (P3) — `REGISTRATION_CONTACT_KEYS`: promoted, but nobody schedules the import-back

`shard-03:722-738` promotes the seven keys from `apps/org/lib/queries.ts:952-960` (verified module-private) into `packages/core/src/privacy.ts`, correctly noting `@quagga/core` exports only `"."` and `"./report-server"` so it must go in the barrel. No shard schedules the corresponding edit to `queries.ts` to import it back. Two copies of a seven-name PII list is the failure the promotion exists to prevent, and `04:1216-1223` already carried the import-back as part of the task.

---

# PART 3 — REQUIREMENT COVERAGE

| #     | Requirement                          | Fully answered?                            | By                                                                                                                                                                                                                                                                                                                                                                                        | What is missing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | ------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **a** | key ≤ owner                          | **Yes**                                    | shard-01 §1, §8.0–8.5; shard-03 §1, §9.1; restated as law in shard-05 §3.8 (AGENTS rule 9) and §4.3 item 5                                                                                                                                                                                                                                                                                | Nothing structural. The set-intersection framing (`effectiveScopes` cannot say yes; every 200 needs a `@quagga/core` predicate) is the strongest work in the round. Sole residue: **X1**.                                                                                                                                                                                                                                                                                                                                                                    |
| **b** | out-of-monorepo apps, Camp 404       | **Mostly**                                 | shard-06 end to end; shard-05 §7.1 (roadmap), §2.8/§6.1 (diagrams)                                                                                                                                                                                                                                                                                                                        | **Z5** — the client API shard-06 is written against contradicts `docs/sdk/02` in four places and no shard is scheduled to edit `02`/`03`. Also shard-06 §11 is explicitly inference (`:16-22`, `:980-986`: Camp 404's repo could not be attached), which is honest but means the migration inventory is unverified.                                                                                                                                                                                                                                          |
| **c** | presence proven + DB-resolved rights | **Yes**                                    | shard-01 §4 (four mint legs, `JOIN "session"` per request, `u.auth_user_id = s.user_id` as a join term, cookie stripped twice), §8.0–8.4; shard-03 §4                                                                                                                                                                                                                                     | Verified the schema supports it: `session.user_id → user.id ON DELETE CASCADE` (`schema.ts:389-391`), `users.auth_user_id` unique (`schema.ts:287`), no `apps/*/middleware.ts` today. Missing: **Z1** (the ticket DDL that makes it true), and shard-01 §4.5's honest limit (_"does not prove a human is at the keyboard"_) appears in shard-01 and shard-03 but **not in shard-06**, the one document an integrator reads.                                                                                                                                  |
| **d** | API medical access recorded          | **Yes in substance, incoherent in detail** | shard-02 end to end; shard-01 §14; shard-04 §8                                                                                                                                                                                                                                                                                                                                            | The actor-is-the-human/app-is-the-basis decision, the unchanged action string with its four-filter argument (`shard-02:246-263`), the blocking fail-closed divergence, `/account/medical-access` as a blocking prerequisite, and the closed `meta` shape are all right and well-argued. But **X2, X5** put five contradictions inside one 60-line function. Resolve by adopting shard-02 wholesale.                                                                                                                                                          |
| **e** | link the docs                        | **Yes**                                    | shard-05 §§1–13                                                                                                                                                                                                                                                                                                                                                                           | Verified the premise: `docs/sdk/` has zero inbound links from outside itself. Missing: (i) shard-05's own file list excludes `docs/sdk/{00,01,02,03,04,05}`, and `shard-05:28-33` notes nine stale "49" sentences in those files _"whoever owns those documents moves them in the same commit"_ — **nobody owns them**; (ii) `docs/sdk/07-consent-and-delegation.md` is created by shard-05 §8.2 and **no shard says which shards compose it** — shard-01 opens as if it were the file, but shards 02, 03 and 04 are equally `docs/sdk/`-shaped and unhomed. |
| **f** | contribution guidelines              | **Yes**                                    | shard-05 §4 (twelve-item endpoint checklist, scope vocabulary, forbidden table, review asks), §9 (commitlint — correctly identified as a **hard blocker**: `scope-enum` severity 2 and CI lints the PR title, so `feat(sdk):` fails before review), §11 (PR template), §14 (reviewer refusals)                                                                                            | Two of the twelve checklist items point at unsettled artefacts: item 2 draws scopes from `packages/scopes` (**X3**) and item 6 hard-codes `packages/db/src/actor.ts` (**X6**). Also `shard-05:1386` owns `scripts/sdk-local.sh` in CODEOWNERS while admitting the filename is its own coinage (**Z4**).                                                                                                                                                                                                                                                      |
| **g** | security auditing procedures         | **Yes**                                    | shard-04 end to end — calendar, twelve monthly items, per-edition ceiling re-justification with a mandatory second person, evidence capture, out-of-band triggers, issuance + the separate medical gate, five revocation levels, four runbooks + one shared POPIA s22 step, subject access, the honest automated/manual split, the exact CI table with a stated failure condition per row | Three queries depend on artefacts nobody specifies: `integration.call.refused` (**Z8**), `last_used_at`'s writer (**Z3**), `integration.key.created` vs `.rotated` (**X9**). §2.2 item 12 and §5.7 both need a `security.txt` mailbox left open at §12.6, while §10.5 ships `security-txt-not-expiring` as a check that is red until the file exists (verified `apps/web/public/.well-known/` absent). §11's refusal list and the "record not monitoring" discipline are the best-argued parts.                                                              |
| **h** | security measures                    | **Yes**                                    | shard-03 end to end — threat actors 7–16 continuing `auth-platform-spec.md` §9.1, credential lifecycle, presence, consent/withdrawal + the deletion undertaking, five rate-limit budgets, no-CORS, §8's stripper, §9 scope minimisation, §10's 28 refusals, §11's threat→control→test matrix, §12 runbooks, §14 verification notes                                                        | §8 is a stage-0 blocker whose test imports an unresolvable specifier (**Y4**) and whose exemption is keyed to a DTO shape shard-02 contradicts (**X2**). **Y3** (C2) is still open. **Z10**. Its §14 verification discipline — including self-correcting the earlier "zero hits repo-wide" `stripHardLocked` claim at `:1292-1296` — is the model the other shards should follow.                                                                                                                                                                            |

---

## Recommended resolution order

1. **Z1** — write the 0029 DDL. Nothing else in the round is permanent; this is.
2. **X1, Y3** — the two live PII paths (`self:*:write`, `SelfProfile`/`getBio`). Both are `06-review` C1/C2 damage multipliers reopening.
3. **X2, X5** — collapse the medical resolver and its DTO onto shard-02, keeping shard-03's field names so the exemption stays live.
4. **X3, X6, X7** — settle three names (`@quagga/scopes` location + licence, `actors.ts` + signature, "the four prerequisites") before stage 0 starts. All three are cheap now and expensive after code exists.
5. **X4, X8, X9, X10** — one-paragraph fixes each, but X4 and X8 are silent-failure shaped.
6. **Z2, Z5** — the manifest type and the client surface. Both need an owner assigned before either shard-06 or `GET /v1/me/capabilities` can be implemented.
7. **Y1, Y2, Y5, Z6–Z10** — supersession rows, endpoint contracts, action strings and labels.
