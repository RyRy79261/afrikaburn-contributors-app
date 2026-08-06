## Audit, disclosure and the medical path

This shard is the contract for one thing: **what gets written down when data leaves the
platform to a party that holds no membership, and how a burner finds out.**

It is binding on `/v1`, on `packages/core/src/medical-access.ts`, on
`apps/web/lib/medical-access.ts`, on `apps/org/lib/medical-audit.ts`, and on migration 0029.
Where it diverges from first-party behaviour it says so explicitly and says why, because an
undocumented divergence gets "fixed" by the next reader in the wrong direction.

Three settled decisions it inherits and does not re-open:

- The audit **actor is the end user**. The integrating app is the **basis**, not the actor.
  `audit_events.actor_id` is `uuid REFERENCES users(id) ON DELETE SET NULL`
  (`packages/db/src/schema.ts:1712-1714`) — the column type already enforces it.
- The action string stays **`bio.medical.view`**. No variant, no suffix.
- The row is a **record, not monitoring** (AGENTS.md:172-177). Nothing in this document may be
  read as licence to add a threshold, a profile, a rate, a score or an alert.

---

## 1. The audit vocabulary today, and where the API attaches to it

### 1.1 Four writers, no shared module

| Writer                                                                | Path                                                                                   | `actorId`                          |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| `writeAuditEvent(db, {actorId, action, subject?, meta?})`             | `apps/org/lib/audit.ts:11-26`                                                          | console staff (`session.dbUserId`) |
| `writeAuditEvent(db, …)` — identical body, different handle type      | `apps/suppliers/lib/audit.ts`                                                          | linked supplier user               |
| direct `db.insert(schema.auditEvents)` — **`apps/web` has no helper** | `apps/web/lib/medical-access.ts:83`, `apps/web/lib/account-sanitize.ts:376` and `:391` | the subject themselves             |
| direct insert in the package                                          | `packages/db/src/deletion.ts`                                                          | the departing user                 |

The table is `packages/db/src/schema.ts:1708-1737`: `id`, `actorId`, `action` (**`text`, not an
enum — the vocabulary is convention, not a constraint**), `subject` (`text`, polymorphic across
several row kinds), `meta` (`jsonb`), `createdAt`. Indexes `actor_idx`, `action_idx`,
`subject_idx`, `created_at DESC` — the last two added in migration 0024, and the comment at
`:1723-1733` records why: `audit_events` is **append-only and never pruned**, so it is the one
table here that only ever grows.

`/v1` gets **no fifth writer.** The medical path calls `resolveMedicalNotesForViewer` (§4), which
already owns the insert. Any other `/v1` audit write goes through a new
`packages/db/src/audit.ts` exporting the same three-field signature the two app helpers already
have, and `apps/org/lib/audit.ts` / `apps/suppliers/lib/audit.ts` become thin re-exports.
_(Spec author's call: consolidating the two identical helpers is not required by this shard, but
adding a fifth copy for `/v1` is refused.)_

### 1.2 Two first-party writers of `bio.medical.view`, and they disagree

```ts
// apps/web/lib/medical-access.ts:83-88
await db().insert(schema.auditEvents).values({
  actorId: viewerUserId,
  action: MEDICAL_VIEW_AUDIT_ACTION,
  subject: subjectUserId,
  meta: { basis },
});
```

```ts
// apps/org/app/(console)/registrations/[id]/members/[userId]/page.tsx:113-118
await writeAuditEvent(getDb(), {
  actorId: guard.session.dbUserId,
  action: MEDICAL_VIEW_AUDIT_ACTION,
  subject: userId,
  meta: { basis, groupId: detail.group.id },
});
```

Same action, two `meta` shapes. `getMedicalAccessLog` reads only `basis`
(`apps/org/lib/medical-audit.ts:180` → `parseBasis` at `:59-66`), so `groupId` is written and
never read. **Normalise before adding a third shape** (§2.2): both writers emit the full key set,
absent facts as `null`.

---

## 2. The vocabulary, extended

### 2.1 New action strings

Seven, all integration lifecycle. None of them is a read.

**This table SUPERSEDES the inherited lifecycle vocabulary at `docs/sdk/04-backend-work-required.md`
§4.3.10 (`:995-1002`), and the divergences are deliberate, not oversights:**

| Inherited (§4.3.10)                                             | Here                                                           | Why                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subject = "integration:<id>"` (prefixed)                       | **the prefixed form is KEPT** — `subject = "integration:<id>"` | `audit_events.subject` is polymorphic `text` and `/account/medical-access` queries it as `subject = <users.id>`. A bare integration uuid in the same column is a needless collision surface.                                                                                                                                  |
| `integration.key.rotated` as its own action                     | folded into `integration.key.created` with `{rotatedFrom}`     | a rotation IS a key creation; two actions for one event doubles the `ACTIVITY_LABELS` surface and splits the answer to "when was this key last changed".                                                                                                                                                                      |
| `integration.scope.granted` / `.revoked`, **one row per scope** | one `integration.ceiling.changed` with `{before, after}`       | §4.3.10's stated reason for row-per-scope was "never a diff blob". That is right for a _grant to a principal_; a ceiling is a set, and the repo's own house pattern for a permission-set change is a diff (`apps/org/lib/actions/org-roles.ts:335-344`). Row-per-scope also makes "who widened this" an N-row reconstruction. |
| `integration.resumed`                                           | not specified here                                             | shard-01 defines `status: active \| suspended` only. If a resume control ships, it needs a row and a label; flagged in §9.                                                                                                                                                                                                    |
| `key_prefix` in `meta`                                          | **forbidden** (§2.3)                                           | §4.3.10 predates this shard's `meta` analysis. `audit_events` is a PRESERVED table with a three-key scrubber; a credential prefix in permanent storage is a search key against a log corpus. This is a deliberate tightening of an inherited decision.                                                                        |

| Action                        | Written when                              | `subject`                          | `meta`                                                                     |
| ----------------------------- | ----------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| `integration.created`         | a System manager registers an integration | `"integration:" + integrations.id` | `{ slug, sponsorUserId }`                                                  |
| `integration.ceiling.changed` | the ceiling is edited                     | `"integration:" + integrations.id` | `{ before: string[], after: string[] }`                                    |
| `integration.key.created`     | a key is minted or rotated                | `"integration:" + integrations.id` | `{ rotatedFrom: string \| null }`                                          |
| `integration.key.revoked`     | a key is revoked; grace cut to zero       | `"integration:" + integrations.id` | `{ reason: "rotation" \| "revoked" }`                                      |
| `integration.suspended`       | `status → 'suspended'`                    | `"integration:" + integrations.id` | `{ reason: string \| null }`                                               |
| `integration.consent.granted` | a burner clicks Approve on `/connect`     | `"integration:" + integrations.id` | `{ consentId, scopes: string[] }`                                          |
| `integration.consent.revoked` | consent withdrawn                         | `"integration:" + integrations.id` | `{ consentId, revokedBy: "subject" \| "org" \| "integrator" \| "system" }` |

Notes that are load-bearing:

- `{before, after}` on the ceiling copies the `before`/`after` keys of `org.department.domains`
  (`apps/org/lib/actions/org-roles.ts:335-344`). It is the house pattern for "a permission
  set changed" and it is why a row-per-scope table is not needed to answer _who widened this
  and when_. **Only those two keys are copied**: the existing row also carries
  `name: department.name` (`:340`), and a department name in `meta` is exactly what §2.3
  forbids for `/v1`. The house pattern is the diff, not the whole row.
- On `integration.consent.granted` the **actor is the burner**, not the System manager. The
  burner performed the act. Same law as the medical row.
- `revokedBy` is **NEW and this shard's proposal**: shard-01 specifies `integration_consents`
  with `revoked_at` only (`shard-01:299, :468`) and no revoker column. Adding one is required
  because _"you disconnected this"_ and _"AfrikaBurn suspended this app"_ are different
  sentences and the burner-facing card must render either. If shard-01 declines the column,
  `revokedBy` must be dropped from the `meta` here rather than inferred.
- Every one of these needs an entry in `ACTIVITY_LABELS`
  (`apps/org/lib/status-board-format.ts:10-47`) or the trail renders the raw dotted key
  (`activityLabel` at `:49-51`). Adding the action without the label is half the change.

### 2.2 `bio.medical.view` — the one `meta` shape, for all three writers

**`bio:medical:read` is a NEW scope string, and it is new against the inherited spec, not
merely against the code.** It is owned by shard-01 (`shard-01:58, :69, :504` — a fifth
namespace `BioScope`, taking the closed vocabulary from **49 to 50**), and it **supersedes two
inherited decisions**, on Ryan's explicit instruction that medical access be reachable:

- `docs/sdk/01-overview-and-capability-model.md:334` lists `medical` (`SAFETY_VISIBLE_FIELDS`)
  under _"What can never be a scope"_, on the grounds that _"an integrator is neither"_ camp
  lead nor safety staff. **That objection is answered, not waived**: the integrator still is
  neither, and still holds nothing. The end user is one of those two, the app is a channel
  (§2.2 rule 2), and the intersection in §4 is what makes the sentence true again.
- `docs/sdk/04-backend-work-required.md:1016` — _"`bio.medical.view` is untouched and
  unreachable: no scope reaches medical notes."_ Superseded. The first half survives: the
  action string is untouched (§2.4). The second half does not.

Everything below assumes that supersession. Nothing else in `docs/sdk/01` §1.6 moves — the 7
`HARD_LOCKED_PRIVATE_FIELDS`, officer contact release, the medical access log itself, `god`,
the engineer ceiling, the lead/admin backstop, free-camp discoverability, questionnaire
result-scope crossing and money all stay off the vocabulary.

```ts
/** packages/core/src/medical-access.ts — the closed meta shape for a disclosing read. */
export interface MedicalViewAuditMeta {
  /** WHY the human was allowed. Unchanged closed union. NULLABLE, because the
   *  first-party writers already write null when `medicalAccessBasis` returns
   *  null (rule 3 below) and historical rows cannot be rewritten. The API path
   *  refuses rather than writing null — the nullability is inherited, not new. */
  basis: MedicalAccessBasis | null;
  /** The camp the read was framed by, when there was one. null in apps/web. */
  groupId: string | null;
  /** HOW the read reached us. The channel, not the authority. */
  via: "app" | "console" | "integration";
  /** Present only when via === "integration". Ids only, never names. */
  integrationId?: string;
  consentId?: string;
  ticketId?: string;
  /** Which of the closed scope strings authorised it. Exactly one. */
  scope?: "bio:medical:read";
  /** The X-Request-Id echoed on the response, so a burner's complaint and a
   *  server log line can be tied together without storing request context. */
  requestId?: string;
  /** True when the row records a disclosure of EXISTENCE only — ciphertext we
   *  could not decrypt. See §4.6. */
  unreadable?: true;
}
```

Rules:

1. **`basis` keeps its three values.** `MedicalAccessBasis = "self" | "org_staff" | "camp_lead"`
   (`packages/core/src/medical-access.ts:126`). `parseBasis`
   (`apps/org/lib/medical-audit.ts:59-66`) hard-codes those three strings and returns `null`
   for anything else, and `MedicalReadRow.basis` renders from it (`:48`). A fourth value like
   `"api"` blanks the basis column on exactly the rows most in need of explanation. **The app is
   a channel, not an authority.**
2. **`via` is the discriminator**, and it is a separate axis from `basis`. This is the whole
   reason the intersection is defensible: the answer to _"would this person have been allowed to
   see it in the web app too?"_ must stay recoverable from the row, and collapsing channel into
   authority destroys it.
3. **`basis` may never be written `null` on the API path.** `medicalAccessBasis` returns
   `MedicalAccessBasis | null` (`:128-135`); a `null` here means `canViewMedicalNotes` said yes
   and `medicalAccessBasis` said nothing, i.e. the two disagree. On the first-party path that
   writes a row the console cannot label. On the API path it is a **`503`** — the audit is the
   basis for disclosure, and an audit row that cannot say why is not a basis.
4. **Ids, enums, `requestId`. Nothing else.** See §2.3.

### 2.3 What must NEVER be recorded

The rule is not decorative and it is not in AGENTS.md — `grep -n meta AGENTS.md` is zero hits.
It is enforced in exactly one place, `apps/web/lib/account-sanitize.ts:349-355`:

```sql
UPDATE audit_events
   SET meta = meta - 'email' - 'contactEmail' - 'primaryEmail'
 WHERE (actor_id = ${userId} OR subject = ${userId})
```

**That is the entire POPIA scrubber: a literal three-key subtraction.** The comment above it
(`:338-348`) records why it exists — _"some writers put the person's EMAIL ADDRESS in `meta` …
and that address survived erasure verbatim — 32 such rows on the live database at the time this
was found — while the farewell email told them nothing identifying remained."_ And
`audit_events` is in `SANITIZATION_PRESERVED_TABLES`
(`packages/core/src/account-sanitization.ts:167-178`), so **anything in `meta` that is not one of
those three keys is permanent and survives erasure verbatim.**

Therefore, for any `/v1` audit row:

**Personal information — forbidden**

| Forbidden                                                                                    | Reason                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| email, username, display name, legal name, of actor or subject                               | the 32-row incident; only three keys are ever scrubbed                                                                                                                                                                                                                          |
| the notes themselves, an excerpt, a length, a hash, a `hasNotes` boolean                     | the column is encrypted at rest precisely so it is not sitting in plaintext `jsonb`; a length is a fingerprint                                                                                                                                                                  |
| IP address, user-agent, any request context beyond `requestId`                               | these are POPIA personal data and belong in `security_events`, which is a **purged** table (`packages/core/src/account-sanitization.ts:188-192`). `audit_events` is a **preserved** table. Putting request context in preserved storage inverts a deliberate retention decision |
| the request URL or referer with its query string                                             | carries subject ids, and can carry more                                                                                                                                                                                                                                         |
| the integration's **name**, the sponsoring **department name**, an `ORG_DOMAIN_LABELS` value | department names are the org chart; ids resolve to names at read time through tables erasure controls, names in `meta` do not                                                                                                                                                   |

**Credentials — forbidden**

| Forbidden                                                          | Reason                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| the integration key, the relay ticket, or **any prefix of either** | a prefix is a search key against a log corpus                                     |
| any hash of either                                                 | equality-testable against a stolen credential                                     |
| any integrator-supplied JSON passed through                        | an inbound path from a third party into permanent, un-scrubbed, preserved storage |

**Monitoring — forbidden, and this is the sharp one**

| Forbidden                                                                                  | Reason                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a count, a rate, a running total, a sequence number, an "nth read this hour"               | AGENTS.md:172-177                                                                                                                                                          |
| a risk score, a severity, an anomaly flag, a `suspicious: true`                            | same                                                                                                                                                                       |
| a threshold marker, per-actor or per-integration                                           | same                                                                                                                                                                       |
| anything that lets a reader conclude the system was **watching** rather than **recording** | an enumeration detector was built and deliberately removed (`docs/accounts-security-spec.md`, the "no volume threshold, no per-actor profiling and no alerting" paragraph) |

**Structural — forbidden**

| Forbidden                                                         | Reason                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| a fourth `basis` value                                            | breaks `parseBasis` (`apps/org/lib/medical-audit.ts:59-66`) |
| a second action string, e.g. `bio.medical.view.api`               | §2.4                                                        |
| an open-ended `meta` — spreading a caller-supplied object into it | the shape above is closed; build it field by field          |

### 2.4 Why there is no `bio.medical.view.api`

A variant action string would, silently and all at once:

1. drop out of `getMedicalAccessLog`'s filter — `eq(action, MEDICAL_VIEW_AUDIT_ACTION)`,
   `apps/org/lib/medical-audit.ts:141`;
2. drop out of `FEED_EXCLUDED_ACTIONS` (`apps/org/lib/status-board-format.ts:79-81`), so API
   medical reads would flood the six-row overview card the exclusion exists to protect;
3. render as a raw dotted key, because `ACTIVITY_LABELS` (`:10-47`) keys on the exact string and
   `activityLabel` falls back to `action` (`:49-51`);
4. and — worst — fall **back into** `getAuditTrail` for actors _without_ `personal_information`
   in the `audit` domain, because that filter is a single
   `ne(action, MEDICAL_VIEW_AUDIT_ACTION)` (`apps/org/lib/medical-audit.ts:230`).

Item 4 creates an unfiltered disclosure census for the one rank that must not have one: an
`engineer` never resolves `personal_information` at all
(`ENGINEER_RANK_CARVE_OUTS`, `packages/core/src/org-permissions.ts:300-303`;
`isRankCarveOut` at `:312-317`), which is precisely why the medical rows are withheld from their
trail. One action string. Discriminate in `meta`.

### 2.5 Record, not monitoring — restated as a constraint on implementers

AGENTS.md:172-177 and `docs/accounts-security-spec.md` are unusually explicit, and the reasoning
matters more than the rule: _reading a lot of medical notes in one sitting is what the job looks
like._ A safety lead working out what to prepare for on site goes through every member of a camp
in one pass. Flagging that reports ordinary care as an incident, buries any real signal, and
teaches the people we most need reading this information that the tool watches them.

**The API does not change this.** Concretely, an implementer may not:

- add a per-integration or per-actor read counter, in `meta`, in a column, or in a cache;
- add a rate limit **on the medical read itself** — the no-rate-limit rule
  (`docs/accounts-security-spec.md`, _"A throttle on this path fails closed in an emergency"_)
  survives. The `integration:subject` budget in `action_rate_limit` sits in front of the `/v1`
  wrapper, not in front of the predicate, and if it is ever judged to conflict the resolution is
  **raise the budget, never remove the counter** — this is a named tension, not a silent choice;
- add alerting, paging, webhooks or emails on medical reads, to anyone;
- add a "medical reads today" tile to the console, the status board, or the System panel;
- add a `hasMedicalNotes` boolean or a disclosure count to any list, roster, card, export or
  response DTO (AGENTS.md product laws; the org roster's has/has-not signpost was built and
  deleted for exactly this).

**One clarification, because the boundary is real.** A _monthly human review of an
integration's_ distinct-subject count is a different object from a _detector on a human actor_.
If it is ever built: it filters on `meta.via = 'integration'` so it can never surface a human's
activity, it has no threshold and no alert wired to it, and a person reads it. Anything beyond
that is a product decision with a stated threat model, not a refactor.

**Stale comment to fix in the same PR.** `apps/org/lib/status-board-format.ts:76` still says
medical reads get _"`/audit`, with the enumeration alerts"_. Those alerts do not exist and must
not; the comment describes a control AGENTS.md forbids and will be read as permission.

---

## 3. The `medical-access.ts:215` divergence — the fix, precisely

Ryan's requirement runs straight through this. The three-way intersection is
`resolve(END USER, live) ∩ ceiling ∩ consent`, and **`resolve(END USER)` is the only term that
can grant anything.** Today the function that computes it in `apps/web` widens it.

### 3.1 The two defects

**Defect A — the rank fallback fails open.**

```ts
// apps/web/lib/medical-access.ts:215
rank: orgRankFromRole(actorOrgRole) ?? "org_staff",
```

`orgRankFromRole` returns non-null only for `engineer | org_staff | god`
(`packages/core/src/org-permissions.ts:178-181`, over `ORG_RANKS` at `:150`) and its own doc
comment (`:173-177`) says _"THIS IS THE CONSOLE GATE"_. `apps/org/lib/session.ts:234` treats
`null` as **forbidden** (`:281`, `kind: "forbidden"`). `apps/web` coerces it to `org_staff` —
the rank with **no carve-outs**. `ENGINEER_RANK_CARVE_OUTS = ["personal_information", "delete"]`
(`org-permissions.ts:300-303`) is bypassed by the coercion, in the app the console's own
comment (`:296-299`) promises it is not.

**Defect B — the strongest-role fold is not rank-aware.**

```ts
// apps/web/lib/medical-access.ts:141-145
// "…so the outcome does not depend on row order."   ← the comment
if (isOrgStaffRole(actorOrgRole)) {
  /* keep */
} else actorOrgRole = row.role;
```

`isOrgStaffRole` is backed by `ORG_STAFF_ROLES = {god, org_staff}`
(`packages/core/src/medical-access.ts:56-59`) — **`engineer` is deliberately absent**, per the
doc comment at `:47-54`. So an `engineer` row _is_ overwritten by a later `member` row. The
comment at `:141-143` is false for `engineer`, and the regression test that exists for it
(`apps/web/lib/__tests__/medical-access-resolver.test.ts:227`, _"keeps the STRONGEST org role,
so the answer does not depend on row order"_) uses `god` — so it **structurally cannot fail on
this**.

Chained: an engineer with a second org-group row of `member`/`lead`/`admin` folds to `member`
→ `orgRankFromRole("member")` is `null` → coerced to `org_staff` → carve-out gone → and
`actorOrgMembershipIds` still carries the _engineer_ membership, so that membership's role
grants are evaluated with no ceiling (`:173-190`).

The console refuses them. `apps/web` hands over every burner's medical notes. And the audit row
honestly records `basis: "org_staff"` — a true description of what the code decided and a false
description of who the person is.

### 3.2 The fix

Both defects, in `packages/core` and one call site.

```ts
// packages/core/src/org-permissions.ts — NEW, exported.
/**
 * Which of two org membership roles carries the stronger console rank.
 *
 * `isOrgStaffRole` cannot answer this: `engineer` is deliberately absent from
 * ORG_STAFF_ROLES (medical-access.ts:47-54), so folding with it silently demotes
 * an engineer to whatever a later row says. Rank strength is the ORG_RANKS order
 * — god > org_staff > engineer > (not an org rank at all).
 */
const RANK_STRENGTH: Record<OrgRank, number> = {
  god: 3,
  org_staff: 2,
  engineer: 1,
};

export function strongerOrgRole(
  a: MembershipRole | null,
  b: MembershipRole | null,
): MembershipRole | null {
  const ra = orgRankFromRole(a);
  const rb = orgRankFromRole(b);
  if (!ra) return rb ? b : a; // neither is a rank → keep whatever we had
  if (!rb) return a;
  return RANK_STRENGTH[rb] > RANK_STRENGTH[ra] ? b : a;
}
```

```ts
// apps/web/lib/medical-access.ts — the fold, replacing :144-146
if (isOrgGroup) {
  actorOrgRole = strongerOrgRole(actorOrgRole, row.role);
  actorOrgMembershipIds.push(row.id);
}
```

```ts
// apps/web/lib/medical-access.ts — the rank, replacing :172-228
// (the whole `let actorOrgPersonalInformation = false;` + `if (…) { … }` block,
//  NOT only the canReadPersonalInformationIn call at :206-227 — the guard moves too)
// FAIL CLOSED. A role that is not an org rank is not an org actor: apps/org
// refuses the session outright (apps/org/lib/session.ts:234, :281) and this app
// must agree, or the participant app becomes a second, wider answer to the same
// question. The old `?? "org_staff"` coerced a non-rank to the rank with NO
// carve-outs, which is exactly how ENGINEER_RANK_CARVE_OUTS got bypassed here
// while the console enforced it.
const rank = orgRankFromRole(actorOrgRole);
let actorOrgPersonalInformation = false;
if (rank && actorOrgMembershipIds.length > 0) {
  const [grants, owners] = await Promise.all([
    /* unchanged */
  ]);
  actorOrgPersonalInformation = canReadPersonalInformationIn(
    {
      rank,
      domains: buildDomainOwnership(owners),
      roles: grants.map(/* unchanged */),
    },
    "registrations",
  );
}
```

The `"registrations"` domain argument is **unchanged and non-negotiable**. The comment at
`:162-169` records that flattening it to `departmentId: null` was a live hole — a Suppliers lead
would have read any burner's medical notes in the participant app that the console refused them.

### 3.3 The extraction — `packages/db/src/actors.ts`

Three call sites want an `OrgActor` from a `users.id`, and two of them disagree today.
`packages/db` already imports `@quagga/core` and the reverse is forbidden, so `packages/db` is
the one place all three apps and `/v1` can share:

```ts
// packages/db/src/actors.ts
/** NULL when orgRankFromRole is null. FAILS CLOSED. There is no fallback rank. */
export function loadOrgActor(db: DbHandle, dbUserId: string): Promise<OrgActor | null>;
export function loadCampPermissions(db: DbHandle, dbUserId: string, groupIds?: string[]): Promise<…>;
/** Domain-scoping to "registrations" INTACT. */
export function loadMedicalAccessContext(
  db: DbHandle, viewerUserId: string, subjectUserId: string,
): Promise<MedicalAccessContext>;
```

`resolveOrgSession` (`apps/org/lib/session.ts:135`; its org-actor resolution is the
`:234-277` block), `buildMedicalAccessContext` (`apps/web/lib/medical-access.ts:103-237`) and
`/v1` all call these.

**Fix, do not copy.** The fastest way to write `actors.ts` is to paste the `apps/web` org branch
— `?? "org_staff"` and all. If the extraction preserves the coercion, every other control in the
SDK spec is a fence around an open gate, and the failure is silent: the console keeps refusing,
the API keeps allowing.

### 3.4 Proof

| Test                                                                                                                                                                                                                                         | Asserts                                                             | Goes red on                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `apps/web/lib/__tests__/medical-access-resolver.test.ts` — new fixture: an `engineer` row on org group A plus a `member` row on org group B, **asserted in both row orders**, with a `personal_information` grant on the engineer membership | refused, both orders                                                | current `main`; the existing `god` test at `:227` cannot |
| `org-actor-fails-closed-on-non-rank` (`packages/db`)                                                                                                                                                                                         | `loadOrgActor` returns `null` for a `member`/`lead`/`admin` org row | any reintroduced fallback                                |
| `strongerOrgRole` table test over `MembershipRole × MembershipRole`                                                                                                                                                                          | `engineer` beats `member`; `god` beats `engineer`; symmetric        | a fold written with `isOrgStaffRole`                     |
| `packages/core/vitest.config.ts` per-file floor                                                                                                                                                                                              | `medical-access.ts` stays 100/100/100/100                           | a new branch with no test                                |

**This is stage 0. Nothing in the SDK workstream starts before it is green.**

---

## 4. The medical path, end to end

### 4.1 The shape of the change

`/v1` lives inside `apps/web`, so the medical endpoint **calls**
`resolveMedicalNotesForViewer` — the same exported function
`apps/web/app/(app)/burners/[id]/page.tsx:69` calls. One implementation of the sharpest read in
the product; the API is a caller of it, not a peer. Rejected alternative:
reimplementing decrypt + three-state + audit in a route handler — one implementation cannot drift
from itself, and no anti-drift test is then needed.

The diff is one optional parameter and one branch:

```ts
// apps/web/lib/medical-access.ts
export interface MedicalReadVia {
  integrationId: string;
  consentId: string;
  ticketId: string;
  requestId: string;
}

export async function resolveMedicalNotesForViewer(input: {
  viewerUserId: string;
  subjectUserId: string;
  editionId: string;
  /** Present ONLY on the /v1 path. Flips the audit from fail-open to fail-closed. */
  via?: MedicalReadVia;
  /** The context the caller already resolved, so the guard and the resolver
   *  agree on one snapshot instead of racing two. Omitted → built here. */
  ctx?: MedicalAccessContext;
}): Promise<
  // `auditFailed?: false` on the first arm is load-bearing, not decoration:
  // without it the second arm is a structural SUBTYPE of the first, the union
  // collapses for assignability, and the handler's `if ("auditFailed" in r)`
  // narrows a shape TypeScript never had to distinguish. Discriminate it.
  | {
      visible: boolean;
      notes: string | null;
      unreadable: boolean;
      auditFailed?: false;
    }
  | { visible: true; notes: null; unreadable: false; auditFailed: true }
>;
```

Inside, everything up to the audit is **unchanged**: build the context, `canViewMedicalNotes`,
authorise-then-select (`:46-47` — on a refusal no `burner_bios` query runs at all), decrypt,
three-state.

```ts
if (!isSelf && (notes || unreadable)) {
  const basis = medicalAccessBasis(ctx);
  const row = {
    actorId: viewerUserId, // THE HUMAN. Always.
    action: MEDICAL_VIEW_AUDIT_ACTION, // unchanged string
    subject: subjectUserId,
    meta: {
      basis,
      groupId: null,
      via: input.via ? ("integration" as const) : ("app" as const),
      ...(input.via
        ? {
            integrationId: input.via.integrationId,
            consentId: input.via.consentId,
            ticketId: input.via.ticketId,
            scope: "bio:medical:read" as const,
            requestId: input.via.requestId,
          }
        : {}),
      ...(unreadable ? { unreadable: true as const } : {}),
    },
  };

  if (input.via) {
    // BLOCKING, FAIL-CLOSED. No row, no body. The whole basis on which we
    // disclose to a party holding no membership is that it is recorded, and an
    // HTTP round trip is retryable in 40ms. See §4.5 for why this diverges.
    if (!basis)
      return {
        visible: true,
        notes: null,
        unreadable: false,
        auditFailed: true,
      };
    try {
      await db().insert(schema.auditEvents).values(row);
    } catch (err) {
      console.error("[medical-access] api audit write failed", err);
      return {
        visible: true,
        notes: null,
        unreadable: false,
        auditFailed: true,
      };
    }
  } else {
    // UNCHANGED. Fail-open, off the critical path. apps/web/lib/medical-access.ts:70-78
    // is the reasoning and it stands: "nobody should wait on a log row to find
    // out someone is diabetic."
    after(async () => {
      try {
        await db().insert(schema.auditEvents).values(row);
      } catch (err) {
        console.error("[medical-access] audit write failed", err);
      }
    });
  }
}
```

`await`ed, and it **precedes** the response. The handler maps `auditFailed` to
`503 audit_unavailable` with no body.

### 4.2 The sequence

```mermaid
sequenceDiagram
    autonumber
    participant N as Nomsa (camp lead)
    participant C as Camp 404 client
    participant CS as Camp 404 server
    participant W as /connect (apps/web)
    participant V as /v1 wrapper
    participant R as resolveMedicalNotesForViewer
    participant DB as Neon

    Note over N,C: A member collapses. The client's ticket carries camp:* only.
    C->>W: top-level nav /connect?scopes=bio:medical:read
    W->>W: requireCampUser() — her own httpOnly cookie, our origin
    W-->>N: consent screen: registered app name + MEDICAL_AUDIENCE_NOTE
    N->>W: Approve (server action — never a GET)
    W->>DB: upsert integration_consents; insert integration_tickets<br/>(session_id, single_use, expires_at = now+120s)
    W->>DB: audit_events integration.consent.granted (actor = Nomsa)
    W-->>C: 302 redirect_uri#ticket=abrt_…
    C->>CS: POST ticket (page clears location.hash)

    CS->>V: GET /v1/burners/{id}/medical<br/>Bearer ab_ik_… + X-AfrikaBurn-User: abrt_…
    V->>V: strip Cookie (2nd time; middleware did it first)
    V->>DB: ONE join: ticket → consent → integration → session → users<br/>(key_hash inside the WHERE)
    DB-->>V: end_user_id + scopes + session.expires_at
    V->>V: relayRefusal(facts, "disclosing", now) → null
    V->>V: effectiveScopes = ticket ∩ consent ∩ ceiling = {bio:medical:read}

    V->>DB: loadMedicalAccessContext(Nomsa, member)
    V->>V: canViewMedicalNotes(ctx) → true, basis = camp_lead
    V->>R: resolve({viewer: Nomsa, subject: member, via, ctx})
    R->>R: re-check predicate (authorise-then-select)
    R->>DB: SELECT burner_bios.medical_notes  ← only now
    R->>R: decryptField → notes | null | unreadable

    rect rgba(200,60,60,0.14)
    R->>DB: INSERT audit_events bio.medical.view<br/>actor = Nomsa · subject = member<br/>meta {basis, via:"integration", integrationId, consentId, ticketId, scope, requestId}
    Note over R,DB: AWAITED. Insert throws → 503 audit_unavailable, NO BODY.
    end

    R-->>V: notes
    V->>DB: UPDATE integration_tickets SET consumed_at = now()<br/>WHERE consumed_at IS NULL RETURNING id
    V-->>CS: 200 MedicalNotesResponse.parse(...) — closed z.object()
    Note over N,CS: Two minutes later the ticket is dead and cannot be re-minted.
```

Two orderings in that diagram are contractual:

- **The `burner_bios` select happens after the predicate.** Authorise-then-select
  (`apps/web/lib/medical-access.ts:46-58`; `docs/accounts-security-spec.md` — _"On a refusal the
  ciphertext is never loaded, so there is no plaintext in render scope"_). Deciding after the
  decrypt would leave correctness resting on a conditional.
- **The ticket is consumed after the predicate says yes and before the body is built.** A
  refusal Nomsa did not cause must not cost her a 120-second ticket in an emergency. One
  `UPDATE … WHERE consumed_at IS NULL RETURNING id`, so two concurrent requests cannot both win.

### 4.3 When the read is refused

**No audit row is written on a refusal, and that is unchanged.** `canViewMedicalNotes` returning
false exits before any insert (`apps/web/lib/medical-access.ts:46-47`); likewise a self-read and
an empty field (`:79`). `audit_events` therefore contains **only successful disclosures** — which
is exactly why `getMedicalAccessLog`'s output is a census of who has disclosed a health condition
and why it is gated on `canReadPersonalInformationIn(actor, "audit")`
(`apps/org/lib/medical-audit.ts:91-93`).

Adding refusal rows would be a bigger leak than the reads: a refusal names a subject who _may_
have notes, is unbounded in volume, and is trivially generated by anyone with a ticket.
**Refused reads are not audited. Do not "improve" this.**

| Condition                                                                                                    | Response                                                                                                                           | Audit row                                   |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `canViewMedicalNotes` false                                                                                  | `404 not_found`                                                                                                                    | none                                        |
| no such burner                                                                                               | `404 not_found` — identical bytes                                                                                                  | none                                        |
| a burner she may not see (free camp)                                                                         | `404 not_found` — identical bytes; the API face of `apps/web/lib/groups-store.ts:187`, `if (!registered && !viewerRole) continue;` | none                                        |
| `bio:medical:read` outside ticket ∩ consent ∩ ceiling                                                        | `403 insufficient_scope`, naming the scope string and nothing else                                                                 | none                                        |
| ticket expired · session ended · consent revoked                                                             | `401 reconnect_required`                                                                                                           | none                                        |
| unknown ticket · wrong app's key · key revoked · integration suspended · account sanitized · ticket consumed | `401 invalid_credentials` — byte-identical across all six                                                                          | none                                        |
| predicate true, field empty                                                                                  | `200`, `{notes: null, unreadable: false}`                                                                                          | **none** — an empty field discloses nothing |
| predicate true, ciphertext undecryptable                                                                     | `200`, `{notes: null, unreadable: true}`                                                                                           | **yes** — see §4.6                          |
| predicate true, notes present, audit insert threw                                                            | `503 audit_unavailable`, **no body**                                                                                               | none (that is the point)                    |
| no active edition                                                                                            | `503`                                                                                                                              | none                                        |

### 4.4 The three-state survives the wire

`resolveMedicalNotesForViewer:59-64` produces three states, not two, and the comment records why:
_"ciphertext we cannot decrypt must not present as 'this burner recorded nothing'. Silently
hiding the section from a camp lead in an emergency is the same failure as the console's false
all-clear."_

The response DTO carries all three, as a closed `z.object()`:

```ts
export const MedicalNotesResponse = z.object({
  subjectUserId: z.string().uuid(),
  notes: z.string().nullable(),
  unreadable: z.boolean(),
});
```

Collapsing `unreadable` into `notes: null` would ship the false all-clear the first-party code
was specifically written to avoid.

**`basis` is deliberately NOT on the wire.** An earlier draft of this section put
`basis: z.enum(["org_staff", "camp_lead"])` in the response. That tells an app holding only
`bio:medical:read` whether its own end user is AfrikaBurn org staff — an org-affiliation
disclosure no scope in the vocabulary authorises, arriving as a side effect of a bio read.
`basis` belongs on the audit row and on `/account/medical-access`, where the burner is the
audience. If an integrator ever needs it, it is a scope, not a free field.

### 4.5 The fail-open / fail-closed divergence, and where it must be written down

The first-party path fails **open** and that is correct. `apps/web/lib/medical-access.ts:70-78`,
verbatim: _"nobody should wait on a log row to find out someone is diabetic. No rate limit gates
this path either, for the same reason."_ `docs/accounts-security-spec.md` states it as policy
and `apps/web/lib/__tests__/medical-access-resolver.test.ts:181` pins it (_"returns the notes
even when the audit write fails"_).

**That justification does not transfer.** It is a medic at a screen in an emergency. An HTTP
round trip from an integrator's server is retryable in 40 ms, and the whole basis on which we
disclose to a party with no membership is that it is recorded. So the API path fails **closed**.

This is now two paths writing the same action with opposite failure semantics, one of which
carries a long persuasive comment explaining why fail-open is right. **The divergence paragraph
must be added to `docs/accounts-security-spec.md` immediately beside the fail-open paragraph** —
not in a spec nobody opens — or a camp lead on one bar of signal at 3 a.m. getting a `503` will
produce a sympathetic, correct-looking PR that makes the API path match, framed as removing an
inconsistency. It removes the entire basis for third-party disclosure.

Pinned by `medical-api-audits-before-response`: no `after(` in the `via` branch; the insert is
`await`ed and precedes the response.

**Practical note:** `after` is a Next request-lifecycle API (`import { after } from "next/server"`,
`apps/web/lib/medical-access.ts:3`). A silently-absent `after()` is a silently-absent audit
trail, which is a second reason the API path does not use it.

### 4.6 `unreadable` is a disclosure and must be audited

Undecryptable ciphertext yields `visible: true, notes: null, unreadable: true`. Today no audit
row is written, because the guard is `if (!isSelf && notes)` (`:79`) and `notes` is `null`.

First-party that is defensible — the viewer is authorised and nothing was disclosed but the
_existence_ of a record. **On the API path it is not.** `unreadable: true` tells a third party
that this burner has a medical record, which is exactly the has/has-not signpost the org roster
had removed, and it currently leaves no trace at all. So on the `via` path the guard becomes
`if (!isSelf && (notes || unreadable))` and the row carries `meta.unreadable: true`.

_(Spec author's call: I have written the same widened guard into the first-party branch above,
because the asymmetry is harder to defend than the extra row and the row is `after()`-cheap. If
the architect prefers to leave the first-party guard at `if (!isSelf && notes)`, the `via` branch
must still widen — and the two guards then need a comment saying which is which and why.)_

---

## 5. Subject access — "who has seen my medical notes?"

### 5.1 What exists today, verified

- `bio.medical.view` rows: actor, action, subject, `meta.basis`, timestamp
  (`packages/db/src/schema.ts:1708-1719`).
- **One reader, org-only**: `getMedicalAccessLog` (`apps/org/lib/medical-audit.ts:112-189`) —
  30-day window (`MEDICAL_AUDIT_LOOKBACK_DAYS = 30`, `:29`), 500-row cap (`:32`), gated on
  `canReadPersonalInformationIn(actor, "audit")` (`:91-93`), surfaced at
  `apps/org/app/(console)/audit/page.tsx`.
- **`apps/web` has no reader.** `apps/web/app/(app)/account/` contains `page.tsx`, `security/`,
  `delete/`, `error.tsx` and `loading.tsx` — nothing medical. A burner asking today gets an
  answer only if a volunteer runs a query by hand.

**Opening a third-party disclosure channel while the burner can only find out by emailing a
volunteer is not shippable.** `/account/medical-access` is a **blocking prerequisite** of
`bio:medical:read`, shipped and proven with a _first-party_ read before any medical scope exists
(stage 4 before stage 5).

### 5.2 `/account/medical-access` — the specification

Sits beside `/account/security`, same page family, same mental model as the active-session list.

**Query.** `audit_events WHERE action = 'bio.medical.view' AND subject = <me>`, newest first,
**unbounded in time**. The console's 30-day window and 500-row cap are page ergonomics for a busy
edition; they are not a legal answer to _"who has ever seen this?"_. Paginate, do not truncate.
Reads the `subject_idx` added in migration 0024 (`schema.ts:1734`) — the index whose comment
already names POPIA erasure as the second half of the `OR` it was added for.

**Row shape.**

```ts
interface MyMedicalRead {
  at: Date;
  /** The person. Display name, resolved live — never stored in meta. */
  actorName: string | null;
  /** meta.basis rendered as English. NULLABLE: `parseBasis`
   *  (`apps/org/lib/medical-audit.ts:59-66`) returns null for a malformed or absent
   *  basis, and pre-fix first-party rows can carry `basis: null` (§2.2 rule 3).
   *  Render null as "AfrikaBurn staff or one of your camp leads" — vaguer, and
   *  honest — never as a blank cell. */
  reason: "one of your camp leads" | "AfrikaBurn's safety team" | null;
  /** meta.integrationId resolved to integrations.name at READ time. */
  viaIntegration: string | null;
}
```

**Rendered.**

> **Nomsa Dlamini** · one of your camp leads · 4 Aug, 19:42 · **through Camp 404**

Not _"Camp 404 read your medical notes."_ A **person** read them, **through an app**, and both
facts are on the page. Attributing it to the app would be a true sentence about the machine and a
useless one about the person; attributing it only to the person would be technically true and
practically false, and is the exact failure this round exists to fix.

**Reading this page is not a disclosure and writes no audit row** — same rule as the console's
`/audit` page. It shows who looked, never the notes.

**The honest caveat, on the page:**

> Reads inside AfrikaBurn's own apps are recorded on a best-effort basis. Reads through a
> connected app are recorded **before** the information is released.

That sentence is the fail-open (`§4.5`) stated to the person it affects. A subject-access answer
that overstates its own completeness is worse than one that admits its bound.

**Also on the page:** the burner's live consents — which apps currently hold which scopes, from
`integration_consents` — and a revoke control. Plus the retention truth the platform cannot
enforce: _disconnecting stops new access; it cannot delete what an app already copied._

**No counts, no "3 reads this month", no chart, no trend.** A list of events with dates. §2.5.

### 5.3 The console reader gains the same column

`MedicalReadRow` (`apps/org/lib/medical-audit.ts:38-50`) gains:

```ts
/** The integration a read arrived through, resolved from meta.integrationId. null = first-party. */
viaIntegration: string | null;
```

resolved in the same second-pass style `subjectName` already uses (`:148-172`) — a second query
over the distinct integration ids, never a join, because `meta` is untyped `jsonb` and one
malformed historical row must not error a page that must always render (`:106-111`).

**Adding the `meta` keys without adding this column satisfies the schema and fails the
requirement.** A burner asking _"who saw my medical information?"_ would get _"Ren Notfound,
camp lead, 14:22"_ when the truth is _"Ren Notfound, camp lead, 14:22, through Camp 404."_

### 5.4 The manual procedure, until §5.2 ships and for anything it cannot answer

POPIA s23 rights are not conditional on self-service.

| Step | Action                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Request received in writing, any channel. Log the date.                                                                                                                                                     |
| 2    | Verify identity **without collecting new PII** — an authenticated request from the account, or a reply to the address on file. Never ask for an ID document to prove identity for a subject-access request. |
| 3    | `audit_events WHERE action = 'bio.medical.view' AND subject = <users.id>`, **unbounded**. Not `getMedicalAccessLog`, whose window and cap are page ergonomics.                                              |
| 4    | Resolve each row: actor display name and rank at the time, `meta.basis` in English, `meta.integrationId` → integration name, timestamp.                                                                     |
| 5    | State the fail-open caveat verbatim (§5.2).                                                                                                                                                                 |
| 6    | Include live consents from `integration_consents` and how to revoke.                                                                                                                                        |
| 7    | Answer as soon as reasonably practicable; log the date answered; count it in the monthly digest's data-subject-requests line.                                                                               |

---

## 6. Retention

### 6.1 The rule

`audit_events` is **append-only and never pruned**. Not a policy statement — the schema comment
says so (`packages/db/src/schema.ts:1723-1724`) and the indexes added in 0024 exist because it is
the one table here that only ever grows.

| Class                                                                             | Retention                  | Mechanism                                           |
| --------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------- |
| `bio.medical.view` rows                                                           | **indefinite**             | preserved table; never pruned                       |
| integration lifecycle rows (§2.1)                                                 | indefinite                 | same                                                |
| `meta.email` / `contactEmail` / `primaryEmail` on any row for a sanitized account | **erased at sanitization** | `apps/web/lib/account-sanitize.ts:349-355`          |
| `integration_consents`, `integration_tickets`                                     | **purged at sanitization** | added to `SANITIZATION_PURGED_TABLES` (§6.3)        |
| `security_events` (IP, user-agent)                                                | purged at sanitization     | `packages/core/src/account-sanitization.ts:188-192` |

**If a general audit-pruning job is ever built, `bio.medical.view` is exempt by name.** Six years
is the defensible floor borrowed from health-record practice — borrowed as a number, not as an
obligation; AfrikaBurn is not a covered entity. Indefinite is the current behaviour and is
stricter.

### 6.2 What survives a burner's erasure, and why that is right

The disclosure record survives; the live authority does not.

- The `users` row survives as a tombstone, so `actor_id` and `subject` keep resolving.
- `audit_events` is in `SANITIZATION_PRESERVED_TABLES`
  (`packages/core/src/account-sanitization.ts:167-178`) — POPIA erasure does not require
  forgetting that an actor existed.
- `publicMemberName(username, {sanitizedAt})` (`apps/org/lib/medical-audit.ts:169`) already
  renders the departed-burner stub, so an erased subject shows as a stub rather than vanishing
  from a count.
- The consent and the ticket — a live authorisation for a person who no longer exists — are
  deleted (§6.3).

### 6.3 The erasure list change, shipping in the same PR as migration 0029

```ts
// packages/core/src/account-sanitization.ts:188-192 — currently exactly three entries
export const SANITIZATION_PURGED_TABLES = [
  "profile_keys",
  "email_change_requests",
  "security_events",
  "integration_consents", // NEW — a live authorisation for a person who no longer exists
  "integration_tickets", // NEW — cascades from the above, listed because this list is
  //       what the tests assert over and what a reader checks
] as const;
```

`integration_tickets` cascades anyway (`consent_id … ON DELETE CASCADE`, and `session_id →
session ON DELETE CASCADE` with `session` already in `SANITIZATION_IDENTITY_TABLES`,
`account-sanitization.ts:211-215`). It is listed because this array is the readable statement of
intent and what the tests assert over. Belt and braces; the belt is the one that works.

Pinned by `consent-tables-in-erasure`.

### 6.4 The `meta` scrubber does not need extending — and that is a constraint, not a fact

The scrubber is `meta - 'email' - 'contactEmail' - 'primaryEmail'`. The `meta` shape in §2.2 is
ids, enums and a `requestId`, so no new key needs scrubbing. **That is only true for as long as
§2.3 is obeyed.** The scrubber is a hardcoded three-key list and it will not notice a fourth.
Anything a future PR adds to `meta` is permanent, preserved and un-scrubbed by default.

---

## 7. Rejected alternatives

| Rejected                                                                | Reason                                                                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bio.medical.view.api` as a separate action                             | drops out of four filters and back into the trail for the one rank that must not see medical rows (§2.4)                                            |
| `"api"` as a fourth `MedicalAccessBasis`                                | blanks the basis column via `parseBasis` on exactly the rows needing most explanation; the app is a channel, not an authority                       |
| Integration (or a service user) as `audit_events.actor_id`              | the column is `uuid REFERENCES users(id)` (`schema.ts:1712-1714`); it answers "who saw my data?" with the name of a machine                         |
| Reimplementing decrypt + three-state + audit in the `/v1` route handler | one implementation cannot drift from itself; no anti-drift test needed                                                                              |
| `after()` fail-open on the API path                                     | the justification is a medic at a screen, not an HTTP round trip retryable in 40 ms                                                                 |
| Auditing refused reads                                                  | a bigger leak than the reads: names subjects who may have notes, unbounded, trivially generated                                                     |
| A per-integration or per-actor read counter in `meta` or a column       | AGENTS.md:172-177; a detector was built and deliberately removed                                                                                    |
| A rate limit on the medical predicate itself                            | _"A throttle on this path fails closed in an emergency"_ — the wrapper's `integration:subject` budget sits in front, never inside                   |
| `REVOKE UPDATE, DELETE ON audit_events` from the app role               | **incompatible with the POPIA scrubber**, which is an `UPDATE` run by the app role (`apps/web/lib/account-sanitize.ts:349-355`). See §9             |
| A `prev_hash` tamper-evidence chain                                     | a chain held entirely in the database it protects raises the cost of a partial edit and nothing more; real tamper-evidence needs an off-box witness |
| Collapsing `unreadable` into `notes: null`                              | ships the false all-clear the three-state exists to prevent                                                                                         |
| Extending `getMedicalAccessLog`'s 30-day window for subject access      | the window is page ergonomics; the answer is a separate unbounded query                                                                             |

---

## 8. Invariant tests this shard owns

All inside `pnpm turbo run … test`, under the single `CI pass` check.

| Test                                       | Asserts                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `medical-api-audits-before-response`       | source scan: no `after(` in the `via` branch; the insert is `await`ed and precedes the response construction                                                             |
| `medical-audit-actor-is-end-user`          | the inserted `actorId` is the resolved end user, never an integration id or a service identity                                                                           |
| `medical-audit-meta-is-closed`             | the built `meta` has only the keys in §2.2; no spread of a caller-supplied object                                                                                        |
| `medical-audit-meta-has-no-forbidden-keys` | table over §2.3: `email`, `name`, `notes`, `ip`, `userAgent`, `count`, `score`, `threshold`, `severity`, `token` and prefixes never appear as keys                       |
| `medical-action-string-is-singular`        | `grep` finds exactly one `bio.medical.view` literal (the `MEDICAL_VIEW_AUDIT_ACTION` export at `packages/core/src/medical-access.ts:142`) and no string starting with it |
| `medical-basis-union-is-three`             | `parseBasis` accepts exactly `self`/`org_staff`/`camp_lead`; the API path refuses on a `null` basis                                                                      |
| `medical-refusal-writes-nothing`           | a refused, a self-, and an empty-field read insert zero rows                                                                                                             |
| `medical-unreadable-is-audited-on-api`     | `unreadable: true` through `via` writes a row with `meta.unreadable`                                                                                                     |
| `org-actor-fails-closed-on-non-rank`       | `loadOrgActor` returns `null` for a non-rank org membership; no `?? "org_staff"` in the body                                                                             |
| `engineer-rank-survives-row-order`         | the §3.4 fixture, both orders, red on current `main`                                                                                                                     |
| `consent-tables-in-erasure`                | `integration_consents` and `integration_tickets` ∈ `SANITIZATION_PURGED_TABLES`                                                                                          |
| `audit-events-stay-preserved`              | `audit_events` ∈ `SANITIZATION_PRESERVED_TABLES`                                                                                                                         |
| `no-monitoring-on-medical`                 | extends `apps/org/lib/__tests__/medical-audit-surface.test.ts` to `/v1`: no threshold constant, no counter, no alert call reachable from the medical handler             |
| `every-integration-action-has-a-label`     | each §2.1 string has an `ACTIVITY_LABELS` entry (`apps/org/lib/status-board-format.ts:10-47`)                                                                            |
| `medical-response-has-no-basis`            | `MedicalNotesResponse` has no `basis` key — the end user's org affiliation is not on the wire (§4.4)                                                                     |
| `medical-read-row-carries-integration`     | `MedicalReadRow` has `viaIntegration` and `getMedicalAccessLog` populates it                                                                                             |
| coverage floors                            | `packages/core/src/medical-access.ts` and `packages/core/src/privacy.ts` stay 100/100/100/100; `apps/web/lib/medical-access.ts` stays at its per-file floor              |

---

## 9. Contradictions and open items for the architect

1. **`REVOKE UPDATE, DELETE ON audit_events` is incompatible with POPIA erasure.** The threat
   survey recommends it as cheap append-only enforcement. The scrubber at
   `apps/web/lib/account-sanitize.ts:349-355` is an `UPDATE audit_events` executed by the
   application role. Adopting the REVOKE breaks account deletion. If it is wanted, the scrub must
   move to a distinct DB role — a deploy/infrastructure change, not a code change, and out of
   scope here.
2. **The guard and the resolver each build the medical context**, so the `/v1` path runs the
   three-query context build twice (`GUARDS["bio:medical:read"]` then
   `resolveMedicalNotesForViewer`). The mismatch window is fail-closed (the second evaluation can
   only refuse), so it is safe — but it is wasteful, and a membership change landing between them
   produces a 404 for a read the guard allowed. The `ctx?` parameter in §4.1 threads one snapshot
   through; confirm that is the intent.
3. **`unreadable: true` is an unaudited disclosure of existence today.** §4.6 widens the guard.
   Confirm whether the first-party branch widens too, or only `via`.
4. **The two first-party writers disagree on `meta`** (`{basis}` vs `{basis, groupId}`) and
   `groupId` is written but never read. §2.2 normalises both. Confirm.
5. **`apps/org/lib/status-board-format.ts:76` documents a control that must not exist** —
   _"`/audit`, with the enumeration alerts"_. Delete the clause in the same PR.
6. **`SANITIZATION_PURGED_TABLES` currently has exactly three entries** and the prior spec's
   §4.3.12 delegation tables were never in it. §6.3 fixes that; it must ship with 0029, not after.
7. **Two inherited decisions are formally superseded by this shard, and both need signing off
   in `docs/sdk/` rather than only here.** `docs/sdk/01-overview-and-capability-model.md:334`
   (`medical` can never be a scope) and `docs/sdk/04-backend-work-required.md:1016`
   (`bio.medical.view` is unreachable). §2.2 states the supersession and the reasoning; the
   inherited documents still assert the opposite, and a reader who opens them first will build
   the wrong thing.
8. **`docs/sdk/04` §4.3.10's lifecycle table conflicts with §2.1 on five points** (action names,
   `subject` shape, row-per-scope vs diff, `integration.resumed`, `key_prefix` in `meta`). §2.1
   now tabulates each divergence and its reason. Confirm, or the two tables ship side by side
   and the implementer picks one.
9. **`revokedBy` needs a column shard-01 has not specified.** `integration_consents` carries
   `revoked_at` only. Either shard-01 adds a revoker column in migration 0029 or §2.1 drops
   `revokedBy` — it must not be inferred at read time from who happens to be logged in.
10. **Stage ordering is a hard dependency, not a preference.** §3 (the rank fix) gates everything;
    §5.2 (`/account/medical-access`) gates the `bio:medical:read` scope. Both are cheap and both
    are the sort of thing that gets deferred to "after the API works", at which point the API
    works and the burner still cannot find out who read their notes.
