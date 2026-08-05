# The architecture decision

The synthesis that `01`–`05` implement. Produced by a judged panel of four rival designs.

---

TOOL_LAYER_OK — precheck passed, all citations below re-verified against the working tree in this session.

---

# THE DECISION

## 1. THE ARCHITECTURE IN ONE PARAGRAPH

We ship **rights as a server-issued document, never as shipped predicates**: one new pure producer in `@quagga/core` (`integration-manifest.ts`) assembles the _already-existing, already-tested_ exports — `summarizeOrgActor`, `orgCanInDomain`, `orgCapabilityRefusal`, `hasProjectPermission` — into a **capability manifest** that an API key fetches at construction and that the SDK treats as an optimistic pre-check, with the server re-running the identical guards on every call. The published package (`@afrikaburn/sdk`, Apache-2.0) contains **no authorisation logic whatsoever** — only 49 closed scope strings, generated method stubs, a manifest evaluator that reads a document, and response DTO types; `org-permissions.ts`, `project-permissions.ts` and `privacy.ts` stay FSL and stay in the repo. Compile-time gating is a **declared-scope contract** (`createServerClient<const S extends ScopeTuple>`) where a missing right is a `Deny<"org:update:suppliers">` property-brand naming the scope, backed by generated `@requires`/`@see` JSDoc — because the DX judge measured that the branded template literal _does not render on hover_ and JSDoc is the only mechanism that does — and reconciled against reality by a construction-time `ScopeContractError` diff. Every response body is produced by a **zod output schema whose `.parse()` is the PII stripper** (§9.4 decision 2, unbuilt today — `grep stripHardLocked` returns zero), with a build-failing recursive assertion that no forbidden field name can appear in any response type. Endpoints mount in whichever app already owns their store, and `manifest.routes` carries namespace→origin as _data_, so the 6,938-line store extraction and `apps/api` are deferred out of v1 entirely rather than blocking it.

## 2. DECISIONS TABLE

| #   | Decision                      | Choice                                                                                                         | Rejected                                                              | Reason                                                                                                                                                                                                                               |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Where rights live             | Server-issued manifest document                                                                                | Ship the predicate kernel to integrators                              | `org-permissions.ts:20-25` deleted a second permissions table on principle; a pinned Apache copy in strangers' `node_modules` reintroduces it across a version axis nobody controls                                                  |
| 2   | Relicensing                   | **Nothing relicensed.** SDK ships vocabulary + DTOs only                                                       | Extract 1,845-LOC kernel to Apache-2.0                                | Irrevocable per version; also moves six files carrying 100/100/100/100 coverage floors out of the workspace whose CI job enforces them                                                                                               |
| 3   | Key semantics                 | **Ceiling.** `effective = resolve(serviceUser) ∩ key.permissions`                                              | Key as a source of rights                                             | `isSystemManager` reads `memberships.role` (`:438-440`); `isPermissionBackstop` is unconditional. A key carrying its own rank makes both forgeable                                                                                   |
| 4   | Key identity                  | Synthetic service `user` + own `memberships`/`org_role_assignments`; `users.kind='service'`                    | Delegated human identity                                              | Lets `resolveOrgSession`/`orgCanInDomain`/`hasProjectPermission`/`writeAuditEvent` run unmodified — a second authz path for a second caller class is how the two drift                                                               |
| 5   | Compile-time encoding         | `Deny<S>` property brand (named interface alias)                                                               | `Omit<Client,'ns'>`; `this`-context brand; bare string literal        | Measured: `Omit` → "Property does not exist" (reads as typo); `this`-brand degrades to `'this' context of type 'void'` on destructure and still renders callable in quickinfo; bare literal widens to `String` and loses the message |
| 6   | Hover remediation             | **Generated `@requires` / `@see` JSDoc on every gated member**                                                 | Rely on the brand's template literal                                  | Measured on TS 6.0.2: quickinfo prints `Deny<"org:delete:suppliers">` and _never_ the embedded sentence. Only JSDoc `tags` come back                                                                                                 |
| 7   | Scope tuple typing            | `ScopeTuple = readonly [] \| readonly [Scope, ...Scope[]]` + named `createDynamicClient()` door                | `S extends readonly Scope[]`                                          | Measured fail-open: a runtime-computed `Scope[]` widens `S[number]` to the whole union and **every gate opens silently**                                                                                                             |
| 8   | Scope wildcards               | **None.** 49 literal strings only                                                                              | `org:*:${domain}` / `org:${cap}:*`                                    | `["org:*:registrations"]` silently declares `org:personal_information:registrations` — PII by autocomplete                                                                                                                           |
| 9   | `org:personal_information:*`  | **Not issuable to any integrator key at v0.1/v0.2**                                                            | Issue it as one of the five CRUD+PII cells                            | Verified `apps/org/lib/queries.ts:952-960`: it unlocks 7 third-party contact columns outside `HARD_LOCKED_PRIVATE_FIELDS`. No design's "hard-locked is outside all scopes" claim covers them                                         |
| 10  | PII stripping                 | **Zod output schema `.parse()` at the response boundary** + build-failing forbidden-field assertion            | A `stripHardLockedFields()` helper called per handler                 | A field absent from the schema cannot be in the body, the type, or the doc. "Someone forgot to call the stripper" becomes inexpressible                                                                                              |
| 11  | Forbidden-field list source   | `import { REGISTRATION_CONTACT_KEYS }` + `HARD_LOCKED_PRIVATE_FIELDS` + `SAFETY_VISIBLE_FIELDS`                | Hand-retyped denylist                                                 | The openapi design retyped 4 of the 7 and its regex caught none of the other 3                                                                                                                                                       |
| 12  | Open-ended zod in responses   | **Banned by emitter assertion**: no `z.any`/`z.unknown`/`z.record`/`.passthrough`/`unrepresentable:"any"`      | Documented workaround                                                 | One `z.record()` disables stripping for its whole subtree — a review-invisible one-line PII bypass in the mechanism the safety argument rests on                                                                                     |
| 13  | Contract format               | **Registry-first, OpenAPI emitted later as a v1.0 artifact**                                                   | OpenAPI doc + generated client as the v0.1 spine                      | The safety property (§10-12) needs zod output schemas, not an OpenAPI document. Its own author: "pays for itself around operation 25"                                                                                                |
| 14  | Store layer                   | Mount each namespace in the app that owns its store; `manifest.routes` carries origins                         | Extract 6,938 lines into `packages/data` + `apps/api` first           | Highest-risk lowest-immediate-value item in the field; it also moves stores out from under `coverage.include: lib/**`                                                                                                                |
| 15  | Refusal copy                  | One generator, `orgCapabilityRefusal(actor, cap, domain, { audience: "integrator" })`                          | Two manifest profiles (`full`/`public`); or a second copy table       | Rules for security (department names are the org chart, `:602`) using DX's shape (one sentence per scope, no dual-path divergence bug)                                                                                               |
| 16  | Refusal delivery              | **Lazy**: refusals only for scopes in the key's ceiling ∪ declared tuple                                       | Exhaustive 40-cell `refusals[]` in every manifest                     | Exhaustive prose serialised into a browser is the domain-ownership map                                                                                                                                                               |
| 17  | Browser credential            | **Delegation tokens only**, minted server-side, narrowing-only, ≤10 min, audience-bound                        | `ab_pk_live_*` publishable key with `Origin` pinning                  | `curl -H 'Origin: …'` defeats it. `public:profiles:read` → `publicBioView` returns legalName/homeCity/contactEmail — a credential-free bulk-enumeration endpoint over Burn identities                                                |
| 18  | Existence oracle              | Server-authored `mode: "explain" \| "notFound"`; `degrade` may only **narrow**; 200-with-empty for camp probes | Client chooses the degradation                                        | `groups-store.ts:187` (`if (!registered && !viewerRole) continue;`) verified. An integrator writing `degrade="explain"` must not be able to confirm a free camp exists                                                               |
| 19  | Namespace gating              | Method throws only                                                                                             | `inert()` Proxy namespaces                                            | Proxy breaks destructuring, `Object.keys` and debugger expansion; needs a third hand-maintained policy table (`NAMESPACE_ROOT_SCOPE`)                                                                                                |
| 20  | `manage_roles ⇒ assign_roles` | Materialised **once**, server-side, into `CampGrant.permissions`                                               | Re-derived in the client evaluator                                    | It is one line at `project-permissions.ts:53`. Two implementations of one rule is the failure this whole design exists to avoid                                                                                                      |
| 21  | `manage_questionnaires`       | Runtime discriminated verdict (4 arms)                                                                         | Flat boolean scope                                                    | It carries `{audienceRoles, mayBlock}`; `canManageQuestionnaireAudience` collapses 3 distinct refusals into one `false` (verified `:74-97`)                                                                                          |
| 22  | `integration_scopes`          | Rows, validated **in code**                                                                                    | Rows with a `CHECK` against the vocabulary                            | Keeps the diffable audit row; avoids turning "add a domain" into production DDL forever on an auto-applying migration pipeline                                                                                                       |
| 23  | Vocabulary source             | New **private** `packages/scopes`; invert `roles.ts:150` so zod derives from the tuple                         | Publish it; or leave `ORG_CAPABILITY_KEYS = OrgCapabilityKey.options` | Verified: `roles.ts:1` is `import { z }`. One cross-cutting 10-line edit gives a zod-free tuple to the producer, the SDK and `@quagga/types` alike                                                                                   |
| 24  | React data layer              | `@tanstack/react-query` peer on `@afrikaburn/react` only; core is `fetchOnly` + optional `queryOptions`        | Bespoke cache; peer on the core                                       | Manifest TTL + version-invalidation + SSR hydration _is_ TanStack Query; writing it is writing it badly                                                                                                                              |
| 25  | Packages                      | `@afrikaburn/sdk` + `@afrikaburn/react`                                                                        | Six domain packages; one merged package                               | Rights are one type in one version — `camps@2` + `core@1` gates against the wrong vocabulary. React needs a `react` peer the Node entry must not have                                                                                |
| 26  | npm scope                     | `@afrikaburn/*`, gated on an AfrikaBurn-controlled npm org; fallback `@quagga-portal/*`                        | `@quagga/*`                                                           | Load-bearing as the private workspace scope (7 packages, all `private:true`); `quagga` on npm is QuaggaJS                                                                                                                            |
| 27  | Build                         | tsdown, extending `packages/typescript-config/node.json`                                                       | `base.json` (`moduleResolution: "Bundler"`); tsc alone                | Verified `node.json` has the right shape and is used by nothing. `"use client"` directive preservation for the React package                                                                                                         |
| 28  | Docs source                   | Generated from tests + the registry, **never** from core's prose                                               | Doc-comments in `org-permissions.ts`                                  | `DEPARTMENT_SCOPED_CAPABILITIES = ORG_CAPABILITIES` (verified) directly contradicts the 24-line comment above it _and_ `summarizeOrgActor`'s own doc block. Both are stale                                                           |

## 3. THE CAPABILITY MODEL

### 3.0 The invariant everything hangs from

A scope string is **an address into the existing algebra, never a new grant.** Each of the 49 scopes resolves to exactly one existing predicate call with concrete arguments. There is no fourth permission model, and the SDK never evaluates a predicate — it reads a document produced by predicates.

```
effective(key, op) = resolveLiveSubject(key.serviceUserId) ∩ key.ceiling
```

Intersection, never union. The subject's rank/backstop/carve-outs are resolved **live, per request**, so a key can never carry a forgeable rank and a revoked department assignment takes effect on the next call.

### 3.1 The closed vocabulary (49 strings)

```ts
// packages/scopes — PRIVATE workspace, zod-free, as-const tuples.
// packages/types/src/roles.ts:150 inverts to derive z.enum FROM these.
type OrgScope = `org:${"create" | "read" | "update" | "delete"}:${OrgDomain}`; // 4 × 8 = 32
type CampScope = `camp:${ProjectPermissionKey}`; // 5
type SelfScope =
  | "self:profile:read"
  | "self:profile:write"
  | "self:notifications:read"
  | "self:notifications:write"
  | "self:registrations:read"
  | "self:registrations:write"; // 6
type PublicScope =
  | "public:editions:read"
  | "public:camps:read"
  | "public:profiles:read"
  | "public:bulletins:read"
  | "public:suppliers:read"
  | "public:categories:read"; // 6
type Scope = OrgScope | CampScope | SelfScope | PublicScope; // 49
```

**`personal_information` is deliberately absent** (decision 9). It is a fifth org capability in the console; it is not an issuable integrator scope. Re-admitting it is a v1.0 decision made explicitly against `apps/org/lib/queries.ts:952-960`, not a consequence of the vocabulary's shape.

**Not scopes, and structurally unable to become scopes:** the 7 `HARD_LOCKED_PRIVATE_FIELDS`, `medical` (`SAFETY_VISIBLE_FIELDS`), `god`/System-manager, the engineer rank ceiling, the lead/admin backstop. Each for the same reason stated differently: a right that always denies is the affordance that eventually gets a `true`.

### 3.2 The manifest

```ts
interface Manifest {
  manifestVersion: 1;
  kernel: string; // server build stamp, echoed on every response
  etag: string;
  issuedAt: string;
  expiresAt: string; // TTL 300s
  key: { id: string; prefix: string; name: string; integrationSlug: string };
  subject: {
    kind: "service";
    id: string;
    rank: "system_manager" | "org_staff" | "engineer" | null;
  }; // LABELS. "god" never crosses.
  granted: {
    org: OrgGrant[]; // from summarizeOrgActor, ∩ ceiling
    camps: CampGrant[]; // mint-time allowlist, bounded
    self: SelfScope[];
    public: PublicScope[];
  };
  refusals: Refusal[]; // LAZY: ceiling ∪ declared only, never all 40 cells
  routes: Record<string, { base: string }>; // namespace → origin
  never: readonly string[]; // informational only, NOT in Scope
  limits: { rateLimit: { max: number; windowSeconds: number } };
  vocabulary: {
    orgCapabilities: string[];
    orgDomains: string[];
    campPermissions: string[];
  };
}

interface OrgGrant {
  capability: OrgCapability;
  departments: { id: string; name: string }[] | null; // null = org-wide
  domains: OrgDomain[] | null;
  hollow: boolean; // domains.length === 0 — a grant that reaches nothing
}
interface CampGrant {
  groupId: string;
  slug: string;
  kind: GroupKind;
  backstop: boolean; // lead/admin — a FLAG, never five scopes
  permissions: CampScope[]; // manage_roles ⇒ assign_roles ALREADY materialised
  questionnaires: { audienceRoles: "all" | string[]; mayBlock: boolean } | null;
}
interface Refusal {
  scope: Scope;
  reason:
    | "rank_ceiling"
    | "no_roles"
    | "wrong_department"
    | "unowned_domain"
    | "not_granted"
    | "not_delegated"
    | "key_ceiling";
  message: string; // orgCapabilityRefusal(…, {audience:"integrator"})
  mode: "explain" | "notFound"; // SERVER-AUTHORED policy
  remediationUrl?: string;
}
```

Three shape rules an implementer must not soften:

- **`hollow` is not `granted`.** `summarizeOrgActor` distinguishes `domains: null` (org-wide) from `domains: []` (scoped to a department owning nothing) precisely because "a summary that overstates access to the exact person deciding whether the access is acceptable" is the failure (verified comment at `:764-775`). Flattening it is over-reporting.
- **`backstop: true` short-circuits the camp tier.** `isPermissionBackstop` is unconditional (`:23-25`). Report the flag; never enumerate a lead's rights as revocable scopes.
- **`questionnaires` is the object or `null`.** Never a boolean.

### 3.3 Build time — the declared-scope contract

```ts
declare const DENIAL: unique symbol;
export interface Deny<S extends Scope> {
  readonly [DENIAL]: S;
}

/** Undeclared (S = Scope) ⇒ ungated at compile time; runtime still gates. */
export type Gate<S extends Scope, Need extends Scope, T> = [Scope] extends [S]
  ? T
  : [Need] extends [S]
    ? T
    : Deny<Need>;

export type ScopeTuple = readonly [] | readonly [Scope, ...Scope[]];

export declare function createServerClient<
  const S extends ScopeTuple = readonly Scope[],
>(cfg: ServerConfig & { scopes?: S }): AfrikaBurn<S[number]>;
```

Every gated member carries **generated** JSDoc, because that is the only thing that renders:

```ts
export interface SuppliersNs<S extends Scope> {
  /**
   * Change a supplier's standing.
   * @requires org:update:suppliers
   * @see https://developers.afrikaburn.org/scopes/org:update:suppliers
   */
  setStanding: Gate<
    S,
    "org:update:suppliers",
    (code: string, standing: Standing) => Promise<void>
  >;
}
```

What the developer sees, measured on TS 6.0.2:

```
error TS2349: This expression is not callable.
  Type 'Deny<"org:update:suppliers">' has no call signatures.
```

plus hover: `@requires org:update:suppliers` / `@see …`, plus a **property** icon in the completion list rather than a method icon. A typo yields `TS2820 … Did you mean '"org:read:suppliers"'?` because scopes are literals.

Three properties of this encoding, stated so nobody misreads them:

1. **Omitting `scopes` is legal and ungated.** `[Scope] extends [S]` is the escape. Time-to-first-call stays at 60 seconds; the runtime still gates.
2. **A computed `Scope[]` is a compile error**, not a silent full unlock — `ScopeTuple` closes the measured fail-open. `createDynamicClient()` is the greppable door for genuinely dynamic scopes.
3. **It systematically under-reports and never over-reports.** A key whose subject is a camp `lead` resolves everything; the declared tuple won't say so. That direction is chosen deliberately: a type system that promises access the server refuses is the "console refuses what it renders" failure, wearing a compiler.

### 3.4 Construction time — reconciling declared vs granted

```ts
const missing = declared.filter((s) => !granted.has(s)); // → ScopeContractError
const unused = granted.filter((s) => !declared.has(s)); // → info notice
```

`missing` **throws in dev/CI, warns loudly in production** and every affected call then fails with `NotAuthorisedError`. Throwing in prod would turn a legitimate rights _narrowing_ by an operator into the integrator's outage. The thrown error prints the missing scopes, each `Refusal.message`, `remediationUrl`, **and the held-scope list** — the single line that kills the most common support ticket, and one nobody in the vendor landscape prints.

`unused` is the least-privilege review nobody does, delivered free.

### 3.5 Runtime — one gate, one throw site

```ts
export function assertScopes(
  m: Manifest,
  req: { scopes: readonly Scope[]; groupId?: string },
): void;
```

Every method is one `scopes:` array and nothing else; a method missing one fails a source-scanning test (the idiom already exists — `apps/org/lib/__tests__/org-rank-enforcement.test.ts` reads ~20 source files). Escapes: `preflight: false` per call (the false-negative override, since a stale manifest can only be wrong invisibly in the deny direction). `mode: "disabled"` and `ab.refresh()` are **cut** — three overlapping staleness hatches is two too many.

`manage_questionnaires` returns a verdict rather than throwing:

```ts
type QuestionnaireVerdict =
  | { ok: true; activationId: string }
  | { ok: false; because: "not_granted"; reason: string }
  | {
      ok: false;
      because: "audience_out_of_scope";
      allowed: string[];
      reason: string;
    }
  | { ok: false; because: "may_not_block"; reason: string };
```

Evaluated **server-side** from the same `canManageQuestionnaireAudience` inputs; the client reads the verdict. This is the one permission the flat-scope model cannot express, and we say so rather than pretending.

### 3.6 Server — the only boundary

Ceiling first (`insufficient_scope`, key-level), then the live guard (`insufficient_rights`, subject-level), then `rank_ceiling` reported _first among refusals_ because for an engineer a role edit cannot help — matching `orgCapabilityRefusal`'s own ordering (verified `:633-640`). Three codes, three different people to go ask.

`403` + `WWW-Authenticate: Bearer error="insufficient_scope", scope="…"` when the right is missing on a resource the key already knows about; **`404`, with no `required_scopes` field at all**, when knowing the resource exists is privileged. Camp probes return **200 with empty permissions** for "no such camp" / "free camp you cannot see" / "camp exists, key holds nothing" — same bytes, same latency budget, closing the timing channel as well as the status channel.

`X-AfrikaBurn-Accepted-Scopes` and `X-AfrikaBurn-Manifest-Version` on **every** response, success included. The first lets the SDK build a live scope→endpoint map from ordinary traffic; the second is how a mid-session revocation reaches a rendered UI.

### 3.7 React

Manifest is JSON; the key never crosses. RSC fetches it with the key, `<RightsHydrator>` serialises it, `useCan(scope, on?)` is **synchronous on first render**. `<Can I= degrade= >` renders granted / `hollow` (disabled + amber + `grantScopeClause`) / denied-`explain` (disabled + server sentence in `title` and `aria-describedby`) / denied-`notFound` (nothing) / pending (sized skeleton) / **fetch-failed → fallback, fail closed**. `degrade` may only narrow — it can never turn a server `notFound` into an `explain`, because that sentence confirms a free camp exists. `<RightsInspector />` (dev-only) renders the whole manifest: the answer to "what can my key do" that no vendor ships.

## 4. PACKAGE + NAMING

```
packages/scopes/       @quagga/scopes            PRIVATE, FSL   49 scopes + as-const vocabularies, zero deps
packages/sdk/          @afrikaburn/sdk           PUBLIC, Apache-2.0
packages/sdk-react/    @afrikaburn/react         PUBLIC, Apache-2.0
packages/core/src/integration-manifest.ts        PRIVATE, FSL   the producer (assembly, not policy)
packages/types/src/responses/*                   PRIVATE, FSL   zod OUTPUT schemas = the stripper
```

```jsonc
// @afrikaburn/sdk — exports
".":          "isomorphic. NO apiKey option exists in its type. Token or fetch-callback only."
"./server":   "import 'server-only'. The only entry accepting an API key."
"./manifest": "types + the pure evaluator. Safe in an RSC, serialisable. The React seam."
"./errors":   "the taxonomy."
```

Enforced by the `exports` map **and** an eslint `no-restricted-imports` rule in `packages/sdk` banning `./server`, `@quagga/db`, `@quagga/auth`, `better-auth`, `drizzle-orm`, `@neondatabase/serverless`, `next/*`, `server-only` from the isomorphic entry — riding `pnpm turbo run lint`, which already exists. This mirrors `report-server`, which is _two_ mechanisms: a subpath **and** the discipline that `src/index.ts` never re-exports it. Be stricter than that precedent: Next replaces `process.env.GITHUB_TOKEN` with `undefined` in client bundles, but an integrator's API key passed as a prop is a **literal the bundler inlines**. `@quagga/auth` is banned by name — it cannot emit declarations at all (TS2883).

Client object: `AfrikaBurn`, conventional variable `ab`. Namespaces: `ab.groups` primary with `ab.camps`/`ab.artworks`/`ab.vehicles` as kind-setting sugar (`createCamp` currently creates artworks — that must not be copied); `ab.burners` never `ab.users` (the schema has both `users` and `user`); `ab.org`; `ab.rights`. No `ab.collectives`, no `ab.wranglers`, no `participant`, and `"god"` never crosses the boundary.

**Naming gate:** `@afrikaburn/*` requires an AfrikaBurn-controlled npm org before first publish — scope ownership is not transferable without npm support, and today `git remote` is a personal account under a licence naming an individual. Fallback `@quagga-portal/*`. **Never** `@quagga/*`.

## 5. BACKEND WORK REQUIRED

Ordered. **[B]** = blocking for v0.1.

1. **[B] `commitlint.config.mjs` `SCOPES` += `scopes`, `sdk`, `react`; mirror in `CONTRIBUTING.md`.** Verified: the allowlist is 10 entries, `scope-enum` is severity 2, CI lints the PR title _and every commit in the range_. Nothing merges until this does.
2. **[B] Invert `packages/types/src/roles.ts:150`.** Verified today: `export const ORG_CAPABILITY_KEYS = OrgCapabilityKey.options;` — the tuple derives from the zod enum. Flip it (`z.enum(ORG_CAPABILITY_KEYS)`), source the tuples from the new private `packages/scopes`. ~10 lines, unblocks a zod-free vocabulary shared by producer, SDK and `@quagga/types`.
3. **[B] Zod response schemas in `@quagga/types/responses`** for the v0.1 DTOs, plus the emitter assertions: (a) recursive forbidden-field walk over `HARD_LOCKED_PRIVATE_FIELDS ∪ SAFETY_VISIBLE_FIELDS ∪ REGISTRATION_CONTACT_KEYS` **imported, never retyped**; (b) ban `z.any`/`z.unknown`/`z.record`/`.passthrough` in any response tree. Both fail the build with a JSON pointer. This is §9.4 decision 2, and it does not exist today.
4. **[B] Extract the free-camp law into `@quagga/core`** as a pure predicate over `(registrationStatus, viewerMembership)`. It is re-implemented in at least four places; every SDK read endpoint becomes the fifth. Verified at `groups-store.ts:187`.
5. **[B] Migration `0029`** (latest on disk is `0028_questionnaire_responses_group_scope.sql`): `apikey` (hand-placed per `schema.ts:320-328`, registered in the drizzle adapter map); `integrations` (`owner_department_id`, `service_user_id`, `status`); `integration_scopes` (rows, **no CHECK**); `users.kind` default `'human'`. All additive, backfill-free. Neon preview branching means PRs exercise it on isolated branches first.
6. **[B] Invariant tests, each with a named assertion:** `isSystemManager(serviceActor) === false` for every `integrations` row; no service user holds camp `lead`/`admin`; `bootstrapGod` short-circuits on `kind='service'`; `enableSessionForAPIKeys === false` (its session-injection hook reportedly calls `validateApiKey` **without** `permissions` — a total scope bypass; second-hand, `node_modules` is absent, so verify against the tarball before shipping); `disableKeyHashing === false`.
7. **[B] `packages/core/src/integration-manifest.ts`** — `manifestForKey()`. Pure assembly over `summarizeOrgActor`, `orgCanInDomain`, `orgCapabilityRefusal`, `hasProjectPermission`. Plus the **anti-drift test**: for a generated matrix of actors × keys, `assertScopes(manifestForKey(x), scope)` passes ⟺ the corresponding guard passes.
8. **[B] `orgCapabilityRefusal(..., { audience: "integrator" })`** — one extra arm on the _existing_ generator (never a second copy table; `:611-615` names that failure). Pinned by a test asserting no `ORG_DOMAIN_LABELS` value and no department name appears in an integrator-audience refusal.
9. **[B] Endpoints:** `GET /api/v1/capabilities` (ETag, 304, `private, max-age=300`), `GET /api/v1/capabilities/camps?slugs=`, and the v0.1 read tranche. Mounted where their stores already live; `manifest.routes` carries origins.
10. **[B] Rate limiting keyed on `apikey.id`.** Both existing limiters miss an API caller: better-auth's keys on `(ip, path)` and fires only on `/api/auth/*`; `consumeRateLimit` keys on IP and **fails open**. Use the `apikey` row's own guarded single-statement counters — never consolidate into `rate_limit`, whose unfiltered sweep already cost the forgot-password budget. Add a cheap IP pre-filter _in front of_ the key lookup.
11. **[B] CI:** add coverage-matrix rows for the new workspaces (`ci.yml` uses an explicit `include:` list — verified — so a new workspace is **not** auto-enrolled). Switch the publish leg to `--frozen-lockfile`; the 270 KB lockfile is committed and CI still installs `--no-frozen-lockfile`. Add `publint && attw --pack` to each SDK `lint` script. Note: **these are the repo's first workspaces with a `build` script**, so `turbo.json`'s `dependsOn: ["^build"]` stops being a no-op the day this lands.
12. **[B] Docs/licence split.** `README.md:10`, `README.md:218-224`, `AGENTS.md:34-35` assert FSL repo-wide and become false. Add `packages/sdk/LICENSE` + `NOTICE`. Changesets with `privatePackages: {version:false, tag:false}`; separate `release-pr.yml`/`publish.yml`; **never** `id-token: write` inside `ci.yml`.
13. Write tranche (v0.2): registration draft/submit, roles, invites, questionnaire send.
14. Org tranche (v0.2/v1.0): `org:read|create|update|delete:<domain>`.
15. Integrations console screen (v1.0): mint, rotate-with-grace, suspend, per-key camp allowlist, scope diff.
16. `GET /.well-known/afrikaburn-scopes` catalogue + emitted OpenAPI document (v1.0).
17. **Deferred indefinitely, on purpose:** extracting the 6,938-line stores into `packages/data` and standing up `apps/api`. `manifest.routes` buys us out of it; when it happens it is a refactor with no SDK release.

## 6. STAGED DELIVERY

**v0.1 — "a stranger can read the burn."** Scopes: `public:*` only. Endpoints: editions, camp directory + detail, categories, public burner profile, bulletins, supplier directory. Manifest, `Deny<>` gating, `ScopeTuple`, generated JSDoc, `ScopeContractError`, error taxonomy, `@afrikaburn/sdk` only (no React).
_Proof it's done:_ the anti-drift test is green across the full actor×key matrix; the forbidden-field assertion fails the build when a `phone` is added to any response schema (demonstrate with a deliberate red build); a key with `scopes: ["public:camps:read"]` gets `Deny<"org:read:suppliers">` in an editor and `insufficient_scope` from the wire; an unregistered camp returns identical bytes and timing for all three not-visible cases; `publint`+`attw` clean; a published tarball contains zero files from `packages/core`.

**v0.2 — "an integrator can act for a camp."** Adds `camp:*` and `self:*` scopes, the mint-time camp allowlist, delegation tokens, `@afrikaburn/react` (`useCan`, `<Can>`, `<RightsHydrator>`, `<RightsInspector>`), the write tranche, and the org read tranche.
_Proof:_ a demo React app renders a roster with a correctly-disabled "Edit roles" button _and_ the server's own sentence, hydrated with zero browser round trips and zero flash; a `hollow` grant renders amber, not enabled; `degrade="explain"` on an existence-privileged camp still renders nothing; revoking a department assignment mid-session flips the button within one request via the version header; a delegation token cannot be widened beyond its minting key (test).

**v1.0 — "it is a platform."** Org write tranche, Integrations console, rotation-with-grace, `/.well-known` catalogue, emitted OpenAPI document (committed + `git diff --exit-code` drift gate), deprecation metadata → generated `@deprecated`, semver policy with a **two-edition** sunset window (the product's clock is the burn, not six months).
_Proof:_ an operator can mint, scope, rotate and suspend a key without an engineer; a scope change on an existing operation fails CI unless the changeset is `major`; a deprecated method shows a strikethrough in an integrator's editor; `personal_information` is either still unissued or its admission is recorded as an explicit decision against the seven `REGISTRATION_CONTACT_KEYS` column names.

## 7. THE THREE THINGS MOST LIKELY TO GO WRONG

**1. The zod response schemas get cut, and the whole safety argument silently becomes "we remembered."** They are the largest single line item, they produce no visible feature, and every deadline conversation will offer them up first — with the plausible substitute "just call a `stripHardLockedFields()` helper in each handler." That substitute is exactly the per-caller filter §9.4 decision 2 forbids, and it cannot see the seven `REGISTRATION_CONTACT_KEYS` at all, because `HARD_LOCKED_PRIVATE_FIELDS` is keyed on `burner_bios` privacy-flag names and those columns live on `registrations`. **Tripwire:** ship the deliberately-red build in v0.1 (add a `phone` to a response schema, watch CI fail, revert) and put that commit hash in the README. If the assertion ever becomes skippable, the SDK is no longer safe to point at this database. **This is the item to defend hardest.**

**2. The manifest is wrong in the deny direction and nobody finds out.** The false _positive_ (manifest allows, server refuses) self-corrects — the request happens, `ManifestDriftError` fires loudly. The false _negative_ is invisible: the SDK refuses locally, the request never happens, no telemetry exists, and the integrator concludes the platform is broken. Compounding it, the manifest can only preflight about five of the twelve deny-by-construction rules; the rest — free-camp visibility, questionnaire result-scope crossing, officer consent, `isEditableStatus`, the escalation clause, the audience sub-algebra — are relationship-level and still arrive over the wire. **Mitigations:** 300s TTL matched to `cookieCacheMaxAgeSeconds` so there is one staleness story to explain, `preflight: false` documented at the top of the README, and the README must state in its own words that _the manifest eliminates key-scope errors, not authorisation errors_ — or it will be oversold and the first support ticket will be about a 403 the SDK promised wouldn't happen.

**3. The docs get written from core's prose, and ship a wrong permission model to strangers.** Verified in this session: `DEPARTMENT_SCOPED_CAPABILITIES = ORG_CAPABILITIES` sits directly beneath a 24-line comment arguing that `read`/`write` are deliberately _not_ department-scoped, and `summarizeOrgActor`'s own doc block states "a role's department narrows `delete` and `read_personal_information` and nothing else" — retired key names, and false. `SYSTEM_MANAGER_ONLY_CAPABILITIES` is `[]`, so `orgCapabilityRefusal`'s "Only a System manager can do that" arm is unreachable today. An SDK author reading those comments builds a model that is wrong in the _permissive_ direction and writes documentation that teaches integrators the wrong boundary. **Mitigation:** SDK documentation is generated from the registry and the test matrix, never from doc-comments; and the stale prose in `org-permissions.ts:239-262`, `:195-211` and `org-roles.ts:239-251` is corrected in the same PR as item 2 of §5, because it is now load-bearing for a third party.
