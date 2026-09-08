## `@afrikaburn/sdk` — core package reference

The contract for the isomorphic TypeScript client. This shard specifies what the package
exports, what every method's signature is, which scope each method requires, how failures are
shaped, and what runs where. React bindings are `@afrikaburn/react` and are specified in their
own shard; nothing here imports React.

Three rules govern every line below, and they are not negotiable inside this document:

1. **The SDK contains no authorisation logic.** It reads a server-issued manifest and compares
   strings. The predicates stay in `packages/core/src/org-permissions.ts`,
   `packages/core/src/project-permissions.ts` and `packages/core/src/privacy.ts`, which are FSL
   and stay in the repo.
2. **Compile-time gating is an affordance, never the boundary.** The server re-runs the identical
   guards on every call. This is `AGENTS.md` rule 7 ("hiding a control in the UI is NEVER the
   security boundary") restated at a new frontier.
3. **A field that is never exposable is absent from the type**, not present-and-refused. The
   seven `HARD_LOCKED_PRIVATE_FIELDS` (`packages/core/src/privacy.ts:39-47`) and `medical`
   (`privacy.ts:57`) do not appear in any DTO, any scope string, or any error branch.

---

### 1. Install and quickstart

```bash
npm install @afrikaburn/sdk
```

Zero runtime dependencies. Node ≥ 20, or any runtime with global `fetch`.

**Node / server (holds the key):**

```ts
import { createServerClient } from "@afrikaburn/sdk/server";

const ab = await createServerClient({
  apiKey: process.env.AFRIKABURN_API_KEY!,
  scopes: ["public:camps:read", "public:editions:read"],
});

const edition = await ab.editions.active();
const camps = await ab.camps.list({ editionId: edition.id, limit: 50 });

for (const camp of camps.items) {
  console.log(camp.name, camp.registered ? "registered" : "free");
}
```

**Browser / isomorphic (never holds the key):**

```ts
import { createClient } from "@afrikaburn/sdk";

const ab = createClient({
  baseUrl: "https://api.afrikaburn.org",
  // A delegation token minted server-side. There is no `apiKey` option on this
  // entry point — it does not exist in the type.
  token: async () => (await fetch("/api/ab-token")).text(),
  manifest: hydratedManifest, // optional; see §4.4
});
```

`createServerClient` is `async` because it fetches the capability manifest and reconciles it
against the declared `scopes` tuple before returning (§4.3). `createClient` is synchronous when a
manifest is supplied and lazily fetches on first call otherwise.

**Time to first call is 60 seconds without declaring scopes:**

```ts
const ab = await createServerClient({ apiKey: KEY }); // no `scopes`
await ab.camps.list({ editionId }); // compiles; runtime still gates
```

Omitting `scopes` disables compile-time gating only. Every method still preflights against the
manifest and the server still re-checks.

---

### 2. The scope vocabulary

49 closed literal strings. No wildcards — `["org:*:registrations"]` would silently declare
`org:personal_information:registrations`, which is PII by autocomplete.

```ts
// Re-exported from @afrikaburn/sdk. PROPOSED: generated AT BUILD TIME FROM
// @quagga/types, which is and stays the source of truth — `OrgCapabilityKey`
// (packages/types/src/roles.ts:141-150) and `ProjectPermissionKey` (:262-269)
// are defined there and nowhere else. There is no `@quagga/scopes` workspace
// today (packages/ is auth, core, db, eslint-config, types, typescript-config,
// ui); if one is introduced it must DERIVE from @quagga/types, never the
// reverse, or the SDK becomes a second source of truth for permissions.

// NAME COLLISION, deliberate and worth stating: @quagga/types already exports
// `OrgCapabilityKey` / @quagga/core `OrgCapability` with FIVE members — the
// four below plus `personal_information` (roles.ts:141-150). The SDK type is a
// deliberate NARROWING and shadows the repo name; do not import both.
export type SdkOrgCapability = "create" | "read" | "update" | "delete";
export type OrgCapability = SdkOrgCapability;
export type OrgDomain =
  | "registrations"
  | "suppliers"
  | "supplier_documents"
  | "questionnaires"
  | "bulletins"
  | "camp_categories"
  | "accounts"
  | "audit";

export type OrgScope = `org:${OrgCapability}:${OrgDomain}`; // 4 × 8 = 32
export type CampScope =
  | "camp:view_member_details"
  | "camp:manage_questionnaires"
  | "camp:assign_roles"
  | "camp:manage_roles"
  | "camp:manage_members"; // 5
export type SelfScope =
  | "self:profile:read"
  | "self:profile:write"
  | "self:notifications:read"
  | "self:notifications:write"
  | "self:registrations:read"
  | "self:registrations:write"; // 6
export type PublicScope =
  | "public:editions:read"
  | "public:camps:read"
  | "public:profiles:read"
  | "public:bulletins:read"
  | "public:suppliers:read"
  | "public:categories:read"; // 6

export type Scope = OrgScope | CampScope | SelfScope | PublicScope; // 49
```

`OrgDomain` is `ORG_DOMAINS` verbatim (`packages/core/src/org-domains.ts:72-81`). `CampScope` is
`camp:` prefixed onto `ProjectPermissionKey` (`packages/types/src/roles.ts:262-269`). The four
`OrgCapability` members are `ORG_CAPABILITY_KEYS` (`roles.ts:141-150`, re-exported as
`ORG_CAPABILITIES` at `packages/core/src/org-permissions.ts:212`) **minus** `personal_information`.

**Absent, deliberately, and each absence is load-bearing:**

| Not a scope                                                                    | Why                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org:personal_information:*`                                                   | Verified `apps/org/lib/queries.ts` gates seven third-party contact columns on `seesPersonalInformation`, columns that live on `registrations` and are therefore outside `HARD_LOCKED_PRIVATE_FIELDS` entirely (which keys on `burner_bios` privacy-flag names — `privacy.ts:33-47`). Not issuable to any integrator key at v0.1/v0.2. |
| Anything naming `phone`, `saId`, `passport`, the four emergency-contact fields | `privacy.ts:39-47`. No access path exists in-product; a right that always denies is the affordance that eventually gets a `true`.                                                                                                                                                                                                     |
| `medical`                                                                      | `SAFETY_VISIBLE_FIELDS` (`privacy.ts:57`). Its consented audience is "their camp leads and AfrikaBurn's safety / org staff" (`privacy.ts:12-21`); an integrator is neither, and exposing it would make the integrator's log the compliance record for `bio.medical.view`.                                                             |
| `god` / System manager                                                         | `isSystemManager` reads `memberships.role`, never a permission bit. Not grantable, therefore not scopable.                                                                                                                                                                                                                            |
| camp `lead` / `admin`                                                          | `isPermissionBackstop` is unconditional (`project-permissions.ts:23-25`). Not revocable, therefore not scopable. Reported as `CampGrant.backstop: true`, a flag, never five scopes.                                                                                                                                                   |
| the engineer rank ceiling                                                      | A ceiling on a rank, not a default on a row. Rides with the subject, resolved live.                                                                                                                                                                                                                                                   |

The `never` list is echoed in the manifest as `manifest.never: readonly string[]` for
introspection tooling. It is informational; those strings are not members of `Scope` and cannot be
passed anywhere.

**Vocabulary ≠ operation surface.** All 32 `org:*` strings are valid `Scope` members, but `delete`
is wired to two actions today, both supplier ones (`apps/org/lib/actions/suppliers.ts`
`deleteSupplier`, and `actions/supplier-documents.ts`). `org:delete:registrations` will
type-check, may resolve `true` for a Theme-camps lead, and reaches no method. The
`ScopeContractError`'s `unused` notice (§4.3) is where an integrator finds that out.

---

### 3. Compile-time gating

#### 3.1 The primitives

```ts
declare const DENIAL: unique symbol;

/** A member the declared scope tuple does not authorise. Not callable. */
export interface Deny<S extends Scope> {
  readonly [DENIAL]: S;
}

/**
 * Undeclared (S widened to the whole union) ⇒ ungated at compile time.
 * Runtime gating is unaffected.
 */
export type Gate<S extends Scope, Need extends Scope, T> = [Scope] extends [S]
  ? T
  : [Need] extends [S]
    ? T
    : Deny<Need>;

/** A non-empty literal tuple, or an explicitly empty one. */
export type ScopeTuple = readonly [] | readonly [Scope, ...Scope[]];
```

`ScopeTuple` rather than `readonly Scope[]` closes a measured fail-open: a runtime-computed
`Scope[]` widens `S[number]` to the entire union, and every gate opens silently. With
`ScopeTuple`, that is a compile error, and `createDynamicClient()` (§4.2) is the named, greppable
door for genuinely dynamic scopes.

Rejected: `Omit<Client, "suppliers">` — produces `Property 'suppliers' does not exist`, which
reads as a typo. Rejected: a `this`-context brand — degrades to `'this' context of type 'void'`
on destructure and still renders callable in quickinfo.

#### 3.2 What the emitter writes

Every gated member carries generated JSDoc, because the branded template literal **does not
render on hover** — quickinfo prints `Deny<"org:update:suppliers">` and never an embedded
sentence. JSDoc `tags` are the only mechanism that comes back.

```ts
export interface OrgSuppliersNs<S extends Scope> {
  /**
   * Change a supplier's standing.
   *
   * @requires org:update:suppliers
   * @see https://developers.afrikaburn.org/scopes/org:update:suppliers
   */
  setStanding: Gate<
    S,
    "org:update:suppliers",
    (
      code: string,
      standing: SupplierStanding,
      opts?: RequestOptions,
    ) => Promise<SupplierSummary>
  >;
}
```

What a developer holding `["public:camps:read"]` sees:

```
error TS2349: This expression is not callable.
  Type 'Deny<"org:update:suppliers">' has no call signatures.
```

plus, on hover, `@requires org:update:suppliers` and the `@see` link; plus a **property** icon
rather than a method icon in the completion list. A typo in a scope string yields
`TS2820: … Did you mean '"org:read:suppliers"'?` because scopes are literals.

#### 3.3 Three properties nobody should misread

1. **Undeclared is legal and ungated.** `[Scope] extends [S]` is the escape hatch, on purpose.
2. **A computed array is a compile error**, not a silent full unlock.
3. **The encoding systematically under-reports and never over-reports.** A key whose service
   subject is a camp `lead` resolves everything through the backstop; the declared tuple will not
   say so and those methods stay `Deny<…>`. That direction is chosen deliberately — a type system
   that promises access the server refuses is the "console refuses what it renders" failure
   (`packages/core/src/org-permissions.ts:20-25`) wearing a compiler.

---

### 4. Client construction

#### 4.1 Entry points and what each accepts

| Entry                      | Accepts a key?                               | Runtime                                | Purpose                              |
| -------------------------- | -------------------------------------------- | -------------------------------------- | ------------------------------------ |
| `@afrikaburn/sdk`          | **No — `apiKey` does not exist in the type** | isomorphic                             | token or fetch-callback client       |
| `@afrikaburn/sdk/server`   | yes                                          | Node/edge only; `import "server-only"` | the only entry that takes an API key |
| `@afrikaburn/sdk/manifest` | n/a                                          | isomorphic, serialisable               | manifest types + the pure evaluator  |
| `@afrikaburn/sdk/errors`   | n/a                                          | isomorphic                             | the error taxonomy                   |

The split mirrors `packages/core/src/report-server/index.ts:1-13`, which is _two_ mechanisms —
a distinct `exports` subpath **and** the discipline that `src/index.ts` never re-exports it. Be
stricter than that precedent: Next replaces `process.env.GITHUB_TOKEN` with `undefined` in client
bundles, but an integrator's API key passed as a prop is a **literal the bundler inlines**.

#### 4.2 Factories

```ts
// @afrikaburn/sdk/server
export declare function createServerClient<
  const S extends ScopeTuple = ScopeTuple,
>(config: ServerConfig<S>): Promise<AfrikaBurn<S[number]>>;

// @afrikaburn/sdk
export declare function createClient<const S extends ScopeTuple = ScopeTuple>(
  config: ClientConfig<S>,
): AfrikaBurn<S[number]>;

/**
 * Scopes computed at runtime. Ungated at compile time by construction — this
 * is the named door, so `grep createDynamicClient` finds every place gating
 * was given up.
 */
export declare function createDynamicClient(
  config: Omit<ClientConfig<ScopeTuple>, "scopes"> & {
    scopes: readonly Scope[];
  },
): AfrikaBurn<Scope>;
```

The default type argument is `ScopeTuple`, **not** `readonly Scope[]`: a default must satisfy its
own constraint, and `readonly Scope[]` does not extend `readonly [] | readonly [Scope, ...Scope[]]`
— written that way the declaration itself is a `TS2344`. `ScopeTuple` gives the same ungated
behaviour for free, because `(readonly [] | readonly [Scope, ...Scope[]])[number]` collapses to
`Scope`, which is exactly the `[Scope] extends [S]` escape hatch in §3.1.

#### 4.3 Every config option

```ts
export interface BaseConfig<S extends ScopeTuple> {
  /**
   * Origin of the capabilities endpoint. Per-namespace origins come from
   * `manifest.routes` — endpoints mount in whichever app already owns their
   * store, so there is no single API host to hard-code.
   */
  baseUrl?: string;

  /** The scopes this codebase declares it uses. Omit for no compile-time gating. */
  scopes?: S;

  /**
   * A pre-fetched manifest. Skips the construction round trip. This is the RSC
   * hydration seam: fetch once on the server, serialise, pass here.
   */
  manifest?: Manifest;

  /** Replaces global fetch. See §10. */
  fetch?: FetchLike;

  /** Merged into every request. Reserved `x-afrikaburn-*` names are rejected. */
  headers?: Record<string, string>;

  /** Per-attempt deadline. Default 15_000. */
  timeoutMs?: number;

  /** Whole-call deadline across retries. Default 45_000. */
  deadlineMs?: number;

  /** See §7. Default `{ maxRetries: 2, backoff: "full-jitter", baseMs: 200 }`. */
  retry?: RetryPolicy | false;

  /**
   * Optimistic local scope check before the request. Default true.
   * `false` is the false-negative override: a stale manifest can only be wrong
   * invisibly in the deny direction.
   */
  preflight?: boolean;

  /** Appended to User-Agent. Use your integration's name and version. */
  appName?: string;

  /**
   * Called with every `X-AfrikaBurn-Accepted-Scopes` value observed, success or
   * failure. Lets an integrator build a live scope→endpoint map from ordinary
   * traffic.
   */
  onScopeObserved?: (op: string, acceptedScopes: readonly Scope[]) => void;

  /** Called when the server's `X-AfrikaBurn-Manifest-Version` differs from ours. */
  onManifestStale?: (observed: string, held: string) => void;
}

export interface ServerConfig<S extends ScopeTuple> extends BaseConfig<S> {
  /** `qg_live_…` / `qg_test_…`. Never present on the isomorphic entry. */
  apiKey: string;
}

export interface ClientConfig<S extends ScopeTuple> extends BaseConfig<S> {
  /**
   * A delegation token, or a function producing one. Narrowing-only, audience-
   * bound, ≤10 minutes. Called on 401 to re-mint.
   */
  token?: string | (() => string | Promise<string>);
}
```

There is deliberately **no** `mode: "disabled"` and **no** `ab.refresh()`. With `preflight:
false` and the 300-second manifest TTL, three overlapping staleness hatches is two too many.

#### 4.4 Construction-time reconciliation

`createServerClient` fetches `GET /api/v1/capabilities`, then diffs:

```ts
const declared: readonly Scope[] = config.scopes ?? [];
const granted: readonly Scope[] = manifest.granted.scopes;
const declaredSet = new Set<Scope>(declared);
const grantedSet = new Set<Scope>(granted);

const missing = declared.filter((s) => !grantedSet.has(s));
const unused = granted.filter((s) => !declaredSet.has(s));
```

- **`missing` throws `ScopeContractError` in development and CI; warns loudly in production.**
  Throwing in production would turn a legitimate rights _narrowing_ by an AfrikaBurn operator into
  the integrator's outage. Every affected call then fails with `InsufficientScopeError` anyway.
  Environment is read from `process.env.NODE_ENV` where available, and defaults to
  _development_ (throw) when it is not — fail loud, not silent.
- **`unused` emits an informational notice** listing scopes the key holds that this codebase never
  declares. That is the least-privilege review nobody does, delivered free.

`ScopeContractError.message` prints the missing scopes, each server-authored refusal sentence,
the remediation URL, **and the list of scopes the key does hold**. That last line kills the most
common support ticket, and no vendor in the survey prints it.

```ts
try {
  ab = await createServerClient({
    apiKey: KEY,
    scopes: ["org:update:suppliers"],
  });
} catch (e) {
  if (e instanceof ScopeContractError) {
    e.missing; // readonly Scope[]
    e.held; // readonly Scope[]
    e.refusals; // readonly Refusal[] — server-authored sentences
  }
}
```

---

### 5. The client object

`AfrikaBurn`, conventionally bound to `ab`.

```ts
export interface AfrikaBurn<S extends Scope> {
  // ---- public tier (v0.1) --------------------------------------------------
  readonly editions: EditionsNs<S>;
  readonly groups: GroupsNs<S>; // primary — any joinable entity
  readonly camps: CampsNs<S>; // sugar: kind = "theme_camp"
  readonly artworks: ArtworksNs<S>; // sugar: kind = "artwork"
  readonly vehicles: VehiclesNs<S>; // sugar: kind = "mutant_vehicle"
  readonly categories: CategoriesNs<S>;
  readonly burners: BurnersNs<S>;
  readonly bulletins: BulletinsNs<S>;
  readonly suppliers: SuppliersNs<S>;

  // ---- delegated tier (v0.2) ----------------------------------------------
  readonly notifications: NotificationsNs<S>;
  readonly registrations: RegistrationsNs<S>;

  // ---- org tier (v0.2 read / v1.0 write) ----------------------------------
  readonly org: OrgNs<S>;

  // ---- always available, no scope required --------------------------------
  readonly rights: RightsNs;
}
```

**Naming calls, each grounded:**

- **`ab.groups` is primary; `ab.camps` is a kind-setting view.** `apps/web/lib/groups-store.ts`
  exports the camp-named primitives `prepareCampCreate` (`:819`) and `createCampWrites` (`:886`)
  — split out of `createCamp` (`:926`) for exactly this — and
  `apps/web/lib/project-registration-store.ts` imports both (`:11`, `:133`) to create _artworks
  and mutant vehicles_. That must not be copied into a public surface.
  `ab.groups.create({ kind: "artwork" })` is canonical; `ab.artworks.create()` is sugar that sets
  the kind and nothing camp-named ever touches a non-camp kind.
- **`ab.burners`, never `ab.users`.** The schema has both `users` (`packages/db/src/schema.ts:282`)
  and Better Auth's `user` (`:358`). A public type called `User` is an unresolvable ambiguity, and
  `burner` is the term the product, the docs and AfrikaBurn use.
- **`ab.org`, singular.** `org` is the code token, the group kind and the console's own word.
  Spelling it out drags the `organisation`/`organization` split into every integrator's
  autocomplete.
- **No `ab.collectives`** — parked feature; the only shipped meaning is an artist-credit string.
  **No `ab.wranglers`** at top level — `wrangler` on npm is Cloudflare's CLI; wrangler assignment
  lives at `ab.org.registrations.wrangler`. **No `ab.participants`** — engineering prose, never
  user-facing copy.
- **`"god"` never crosses the boundary.** `manifest.subject.rank` is
  `"system_manager" | "org_staff" | "engineer" | null`, translated at the server. The stored value
  stays `god` (`build-spec.md:97`); a public SDK is a label layer, and the repo's own rule is that
  the label layer is where a rename belongs.

#### 5.1 Namespace gating is method-level only

A namespace object always exists; its methods carry `Deny<…>` and, at runtime, throw. Rejected:
`inert()` Proxy namespaces — a Proxy breaks destructuring, `Object.keys`, and debugger expansion,
and needs a third hand-maintained policy table mapping namespaces to root scopes.

---

### 6. Method surface

Shared shapes used throughout:

```ts
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Required to make a write retryable. See §7.3. */
  idempotencyKey?: string;
  /** Per-call override of the optimistic local check. */
  preflight?: boolean;
  headers?: Record<string, string>;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Opaque. Pass back as `cursor`. `null` ⇒ no further pages. */
  readonly nextCursor: string | null;
}

export interface ListParams {
  cursor?: string | null;
  /** 1–100. Default 25. */
  limit?: number;
}
```

Every method's last parameter is `opts?: RequestOptions`; it is omitted from the tables for
brevity. Every gated method is wrapped by the emitter as `Gate<S, "<scope>", <signature>>`.

#### 6.1 `ab.editions` — `public:editions:read`

| Method   | Signature                                    | Scope                  |
| -------- | -------------------------------------------- | ---------------------- |
| `active` | `() => Promise<Edition>`                     | `public:editions:read` |
| `list`   | `(p?: ListParams) => Promise<Page<Edition>>` | `public:editions:read` |
| `get`    | `(editionId: string) => Promise<Edition>`    | `public:editions:read` |

There is no write path for editions anywhere in the repo (`apps/org/lib/queries.ts:119`
`getActiveEdition` is a read; no action creates one), so the SDK exposes none.

#### 6.2 `ab.groups` / `ab.camps` / `ab.artworks` / `ab.vehicles`

```ts
export interface GroupsNs<S extends Scope> {
  /**
   * The directory listing. Free camps are suppressed for every caller that is
   * not already a member — this is a property of the response, not a filter the
   * caller applies.
   *
   * @requires public:camps:read
   */
  list: Gate<
    S,
    "public:camps:read",
    (
      params: GroupListParams,
      opts?: RequestOptions,
    ) => Promise<Page<GroupSummary>>
  >;

  /**
   * @requires public:camps:read
   * @throws NotFoundError — identical for "no such group", "free group you may
   *   not see", and "group exists, key holds nothing".
   */
  get: Gate<
    S,
    "public:camps:read",
    (
      slug: string,
      params: { editionId: string },
      opts?: RequestOptions,
    ) => Promise<GroupDetail>
  >;

  /** @requires camp:view_member_details */
  members: Gate<
    S,
    "camp:view_member_details",
    (
      groupId: string,
      params?: ListParams,
      opts?: RequestOptions,
    ) => Promise<Page<RosterMember>>
  >;

  readonly roles: GroupRolesNs<S>;
  readonly invites: GroupInvitesNs<S>;
  readonly questionnaires: GroupQuestionnairesNs<S>;
}

export interface GroupListParams extends ListParams {
  editionId: string;
  kind?: GroupKind | readonly GroupKind[];
  /** Substring match against the normalised name, as `listDirectory` does. */
  search?: string;
  categoryId?: string;
  joinability?: Joinability;
  /** Only groups with an approved registration this edition. */
  registered?: boolean;
}
```

`ab.camps`, `ab.artworks` and `ab.vehicles` expose exactly `list`, `get` and (v0.2) `create` with
`kind` pre-bound and removed from the parameter type.

**Free-camp suppression is in the response contract.** `apps/web/lib/groups-store.ts:187` is
`if (!registered && !viewerRole) continue;` — the rule is a query-shape law re-implemented in at
least four places today. The SDK must not become the fifth: §5 of the decision extracts it into
`@quagga/core` as a pure predicate over `(registrationStatus, viewerMembership)` before any read
endpoint ships. Consequences that reach this document:

- **No `total` field on any group page, ever.** A count over a suppressed set is an existence
  oracle. Cursors are opaque and never encode an offset for the same reason: an offset over a
  post-filtered row set is both wrong and informative.
- **A camp probe returns `200` with an empty permissions object**, identical bytes and within the
  same latency budget, for all three of "no such camp", "free camp you cannot see" and "camp
  exists, key holds nothing". That closes the timing channel as well as the status channel.

#### 6.3 `ab.categories` — `public:categories:read`

| Method | Signature                                                         | Scope                    |
| ------ | ----------------------------------------------------------------- | ------------------------ |
| `list` | `(params: { editionId: string }) => Promise<readonly Category[]>` | `public:categories:read` |

Not paginated: the taxonomy is one edition's chip row (`apps/web/lib/groups-store.ts:59`
`listCampCategories`), bounded by construction.

#### 6.4 `ab.burners`

| Method            | Signature                                                                     | Scope                  | Since |
| ----------------- | ----------------------------------------------------------------------------- | ---------------------- | ----- |
| `publicProfile`   | `(ref: { userId: string } \| { username: string }) => Promise<PublicProfile>` | `public:profiles:read` | v0.1  |
| `me`              | `() => Promise<SelfProfile>`                                                  | `self:profile:read`    | v0.2  |
| `updateMe`        | `(patch: SelfProfilePatch) => Promise<SelfProfile>`                           | `self:profile:write`   | v0.2  |
| `privacyFlags`    | `() => Promise<Record<string, boolean>>`                                      | `self:profile:read`    | v0.2  |
| `setPrivacyFlags` | `(flags: Record<string, boolean>) => Promise<Record<string, boolean>>`        | `self:profile:write`   | v0.2  |

**There is no `ab.burners.list()` and there never will be.** `publicProfile` requires a specific
subject. `publicBioView` (`packages/core/src/bio.ts:359`) returns `legalName`, `homeCity` and
`contactEmail` when the owner has flagged them public; a list method over that projection is a
credential-cheap bulk-enumeration endpoint over Burn identities.

`setPrivacyFlags` is a **request**, not an assertion. The server runs `enforcePrivacyFlags`
(`privacy.ts:108-116`), which forces every `ALWAYS_PRIVATE_FIELDS` member to `false` regardless of
input, and the returned object is the enforced state. The SDK does not pre-filter, because a
client-side filter is the failure mode `docs/auth-platform-spec.md:626-630` names. Attempting to
set a hard-locked field public returns `ValidationError` with the offending keys — the
`privacyViolations` list (`privacy.ts:123-127`) — rather than silently correcting.

#### 6.5 `ab.bulletins` / `ab.suppliers` (public read)

| Method           | Signature                                                            | Scope                   |
| ---------------- | -------------------------------------------------------------------- | ----------------------- |
| `bulletins.list` | `(p: ListParams & { editionId: string }) => Promise<Page<Bulletin>>` | `public:bulletins:read` |
| `bulletins.get`  | `(id: string) => Promise<Bulletin>`                                  | `public:bulletins:read` |
| `suppliers.list` | `(p: SupplierListParams) => Promise<Page<SupplierSummary>>`          | `public:suppliers:read` |
| `suppliers.get`  | `(code: string) => Promise<SupplierSummary>`                         | `public:suppliers:read` |

`SupplierSummary` carries name, code, category, services, website, returning and standing. It
does **not** carry `contact` (free text, frequently a personal mobile), `userId` or `importedAt`.

#### 6.6 `ab.groups.roles` — v0.2

| Method           | Signature                                                                                                | Scope               |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ------------------- |
| `list`           | `(groupId: string) => Promise<readonly ProjectRole[]>`                                                   | `camp:manage_roles` |
| `create`         | `(groupId: string, input: RoleCreateInput) => Promise<ProjectRole>`                                      | `camp:manage_roles` |
| `rename`         | `(groupId: string, roleId: string, name: string) => Promise<ProjectRole>`                                | `camp:manage_roles` |
| `setAppearance`  | `(groupId: string, roleId: string, a: RoleAppearance) => Promise<ProjectRole>`                           | `camp:manage_roles` |
| `setPermissions` | `(groupId: string, roleId: string, p: ProjectPermissions) => Promise<ProjectRole>`                       | `camp:manage_roles` |
| `remove`         | `(groupId: string, roleId: string) => Promise<void>`                                                     | `camp:manage_roles` |
| `assign`         | `(groupId: string, membershipId: string, roleIds: readonly string[]) => Promise<readonly ProjectRole[]>` | `camp:assign_roles` |

**`manage_roles ⇒ assign_roles` is materialised once, server-side**, into
`CampGrant.permissions`. It is one line at `packages/core/src/project-permissions.ts:53`; two
implementations of one rule is precisely the failure this design exists to avoid, so the client
evaluator never re-derives it.

**The escalation clause is a second, server-side check.** `roleGrantsElevatedPrivileges`
(`project-permissions.ts:142-150`) means an `assign_roles`-only holder cannot hand out a role
carrying `manage_roles` or `manage_members`, or a `captain`-kind role. That is relationship-level
— it depends on the _target role_, not the caller's scope — so the manifest cannot preflight it
and `assign` can throw `InsufficientRightsError` with `reason: "escalation_clause"` while the
scope check passes. Documented here so nobody reads a green preflight as a promise.

`setPermissions` on a `captain`-kind role is accepted and coerced: `enforceKindPermissions`
(`project-permissions.ts:126-132`) forces the full set on every write. The response is the coerced
row, not the submitted one.

#### 6.7 `ab.groups.invites` — v0.2, `camp:manage_members`

| Method   | Signature                                                                                      | Scope                 |
| -------- | ---------------------------------------------------------------------------------------------- | --------------------- |
| `list`   | `(groupId: string, p?: ListParams) => Promise<Page<Invite>>`                                   | `camp:manage_members` |
| `create` | `(groupId: string, input: { kind: InviteKind; expiresAt?: string }) => Promise<InviteCreated>` | `camp:manage_members` |
| `revoke` | `(groupId: string, inviteId: string) => Promise<void>`                                         | `camp:manage_members` |

**`preview` and `redeem` are not in the SDK.** The invite token _is_ the credential
(`apps/web/lib/invites-store.ts` `getInvitePreview`, `redeemInvite`); an integrator that can mint
and redeem can silently plant members in camps. Minting is defensible under `manage_members`;
redeeming on someone else's behalf is not. `InviteCreated.token` is returned exactly once, at
create, and `Invite` (the list shape) never carries it.

#### 6.8 `ab.groups.questionnaires` — v0.2, the one non-boolean permission

`manage_questionnaires` is not a boolean. It carries
`{ audienceRoles: "all" | string[], mayBlock: boolean }`
(`packages/types/src/roles.ts:280-286`), and `canManageQuestionnaireAudience`
(`project-permissions.ts:74-97`) collapses three distinct refusals into one `false`. A flat scope
cannot express it, so `send` returns a **verdict** rather than throwing:

```ts
export type QuestionnaireVerdict =
  | { ok: true; activationId: string }
  | { ok: false; because: "not_granted"; reason: string }
  | {
      ok: false;
      because: "audience_out_of_scope";
      allowed: readonly string[];
      reason: string;
    }
  | { ok: false; because: "may_not_block"; reason: string };

export interface GroupQuestionnairesNs<S extends Scope> {
  /** @requires camp:manage_questionnaires */
  send: Gate<
    S,
    "camp:manage_questionnaires",
    (
      groupId: string,
      input: {
        definitionId: string;
        targetRoleIds: readonly string[]; // "everyone" ⇒ the baseline role id
        blocking: boolean;
      },
      opts?: RequestOptions,
    ) => Promise<QuestionnaireVerdict>
  >;

  /** @requires camp:manage_questionnaires */
  activations: Gate<
    S,
    "camp:manage_questionnaires",
    (
      groupId: string,
      p?: ListParams,
      opts?: RequestOptions,
    ) => Promise<Page<Activation>>
  >;

  /** @requires camp:manage_questionnaires */
  close: Gate<
    S,
    "camp:manage_questionnaires",
    (
      groupId: string,
      activationId: string,
      opts?: RequestOptions,
    ) => Promise<void>
  >;
}
```

The verdict is computed server-side from the same inputs `canManageQuestionnaireAudience` takes;
the client reads it. `manifest.granted.camps[n].questionnaires` is the scope object or `null`,
never a boolean, so a caller can render an audience picker correctly before sending.

`results` is **not** exposed. `canViewActivationResults` refuses an org actor a camp's
project-scoped results and vice versa, including a System manager — a structural rule, not a
grant, and one an integrator scope cannot address.

#### 6.9 `ab.registrations` — v0.2

| Method              | Signature                                                                                             | Scope                      |
| ------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| `list`              | `(p: ListParams & { editionId: string }) => Promise<Page<RegistrationSummary>>`                       | `self:registrations:read`  |
| `get`               | `(groupId: string, editionId: string) => Promise<RegistrationSummary>`                                | `self:registrations:read`  |
| `saveDraft`         | `(groupId: string, editionId: string, patch: RegistrationDraftPatch) => Promise<RegistrationSummary>` | `self:registrations:write` |
| `submit`            | `(groupId: string, editionId: string) => Promise<RegistrationSummary>`                                | `self:registrations:write` |
| `withdraw`          | `(groupId: string, editionId: string) => Promise<RegistrationSummary>`                                | `self:registrations:write` |
| `reopen`            | `(groupId: string, editionId: string) => Promise<RegistrationSummary>`                                | `self:registrations:write` |
| `declaredSuppliers` | `(groupId: string, editionId: string) => Promise<readonly DeclaredSupplier[]>`                        | `self:registrations:read`  |

`self:registrations:*` means "registrations of groups where the key's subject holds a
membership", resolved per request. It never widens beyond that subject's own memberships.

**Naming hazard, stated rather than hidden:** `registrations` is `group × edition`
(`docs/build-spec.md:103`, `packages/db/src/schema.ts` `registrations`), never `user × edition`.
The `self:` prefix names _how the scope resolves_, not what the row belongs to. The methods take a
`groupId` for exactly that reason, and the manifest reports these under `granted.self`, not
`granted.camps`.

`submit` throws `PreconditionError` with `code: "not_submittable"` and the outstanding sections
when `isSubmittable` (`packages/core/src/entitlements.ts:51-54`) is false. That gate is Form 1
only — `FORM_1_SECTION_KEYS` is `["identity","lnt","participation","suppliers_commerce"]`
(`packages/types/src/registration.ts:79-84`) — and `RegistrationSummary.missingSections` mirrors
it. `saveDraft`/`withdraw`/`reopen` throw `PreconditionError` with `code: "not_editable"` when
the row's status is outside `isEditableStatus` (`apps/web/lib/registration-store.ts:33`). Neither
is preflightable: both are row state, not key scope.

#### 6.10 `ab.notifications` — v0.2

| Method        | Signature                                         | Scope                      |
| ------------- | ------------------------------------------------- | -------------------------- |
| `list`        | `(p?: ListParams) => Promise<Page<Notification>>` | `self:notifications:read`  |
| `unreadCount` | `() => Promise<number>`                           | `self:notifications:read`  |
| `markRead`    | `(ids: readonly string[]) => Promise<void>`       | `self:notifications:write` |
| `markAllRead` | `() => Promise<void>`                             | `self:notifications:write` |

Always self-scoped by the subject. `notifications` has no org domain
(`packages/core/src/org-domains.ts:62-64` — "`/notifications` is the signed-in actor's OWN
inbox"), which is why it is a `self:` scope and not an `org:` cell.

#### 6.11 `ab.org` — v0.2 read, v1.0 write

Where a `requireOrgSession({ capability, domain })` call site exists today, the scope string is
that guard's own arguments verbatim. **It does not exist for every row below, and the gaps are
backend work, not naming.** Verified against every non-test `requireOrgSession(` call site in
`apps/org` (29 of them):

| `(capability, domain)` pair                              | Existing guard?                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `update`/`create`/`read` × `suppliers`                   | yes — `apps/org/lib/actions/suppliers.ts:39,115,217,270,295`; `delete` at `:359`                                                                                         |
| `create`/`update`/`read`/`delete` × `supplier_documents` | yes — `apps/org/lib/actions/supplier-documents.ts:75,167,260,336`                                                                                                        |
| `create`/`update`/`read` × `questionnaires`              | yes — `apps/org/lib/questionnaires/actions.ts:127,248,290,522` and `app/(console)/questionnaires/builder-actions.ts:54`                                                  |
| `create`/`update` × `bulletins`                          | yes — `apps/org/lib/actions/bulletins.ts:125,295,366`; `read` at `components/bulletins/audience-count.ts:66`                                                             |
| `create`/`update` × `registrations`                      | yes — `apps/org/lib/actions/registrations.ts:120,235,274`; `wranglers.ts:146,275` (both `update`)                                                                        |
| **`read` × `registrations`**                             | **no** — registration reads are a bare console-session page guard plus `seesPersonalInformation(actor, "registrations")` (`apps/org/lib/queries.ts:106,1020,1254,1468`)  |
| **`read` × `accounts`**                                  | **no** — same shape (`queries.ts:393,780`)                                                                                                                               |
| **`read` × `audit`**                                     | **no** — no call site names the `audit` domain anywhere in non-test source                                                                                               |
| **`read` × `camp_categories`**                           | **no** — every camp-category action is `requireSystemManager` (`apps/org/lib/actions/categories.ts:54,107,157,214`), and no call site names the `camp_categories` domain |

The four "no" rows are the ones an integrator endpoint must _introduce_ a guard for. Introducing
it means adding the `requireOrgSession({ capability, domain })` call to the existing query path —
never re-deriving the answer in the endpoint.

| Namespace               | Method                                                              | Scope                           |
| ----------------------- | ------------------------------------------------------------------- | ------------------------------- |
| `org.registrations`     | `list`, `get`, `statusBoard`                                        | `org:read:registrations`        |
|                         | `addReview`                                                         | `org:create:registrations`      |
|                         | `decide`, `setReviewStatus`, `wrangler.assign`, `wrangler.unassign` | `org:update:registrations`      |
| `org.suppliers`         | `list`, `get`, `notes.list`                                         | `org:read:suppliers`            |
|                         | `add`, `notes.add`                                                  | `org:create:suppliers`          |
|                         | `setStanding`, `setOnboardingStep`                                  | `org:update:suppliers`          |
|                         | `remove`                                                            | `org:delete:suppliers`          |
| `org.supplierDocuments` | `list`, `get`                                                       | `org:read:supplier_documents`   |
|                         | `create`                                                            | `org:create:supplier_documents` |
|                         | `update`                                                            | `org:update:supplier_documents` |
|                         | `withdraw`                                                          | `org:delete:supplier_documents` |
| `org.questionnaires`    | `definitions.list`, `activations.list`                              | `org:read:questionnaires`       |
|                         | `definitions.create`, `activations.activate`                        | `org:create:questionnaires`     |
|                         | `definitions.update`, `activations.close`                           | `org:update:questionnaires`     |
| `org.bulletins`         | `list`, `get`                                                       | `org:read:bulletins`            |
|                         | `create`                                                            | `org:create:bulletins`          |
|                         | `update`, `publish`, `setPinned`                                    | `org:update:bulletins`          |
| `org.categories`        | `list`                                                              | `org:read:camp_categories`      |
| `org.accounts`          | `search`, `roster`                                                  | `org:read:accounts`             |
| `org.audit`             | `list`                                                              | `org:read:audit`                |

**Deliberately absent from `ab.org`, and each absence is enforced by there being no scope:**

- Departments, org roles, org role assignments, console-rank writes, camp-category CRUD. All are
  `requireSystemManager` (`apps/org/lib/session.ts:364-375`), which asks `isSystemManager`
  directly and never a capability. A key that can call `setAccountOrgRoles` is a
  privilege-escalation primitive by construction.
- `org.registrations.officers` contact detail. `officerContactVisibleToOrg`
  (`packages/core/src/officers.ts:196-201`) is a _consent_ flow scoped to AfrikaBurn org: the
  predicate is `assignment.isOfficer && assignment.consent === "accepted"` — per role
  ASSIGNMENT, not per edition — and it is the single explicit exception to the bio phone
  hard-lock. Widening it to a third party breaks the consent the burner actually gave. The SDK
  exposes officer **slot** and **filled/unfilled** only (`officerSlotFilled`, `officers.ts:204`).
- Medical notes, on any surface. `getRosterMemberDetail`'s `includeMedicalNotes` branch has no SDK
  equivalent, and `RosterMember` does not carry `medicalNotesUnreadable` either — collapsing that
  tri-state produces a false all-clear on a safety path, so the field is dropped entirely rather
  than flattened.
- `org.audit` returns allowlisted `meta` keys only. `audit_events.meta` is free-form jsonb whose
  scrubbing boundary is an unverified-status row in the spec's own matrix; an unbounded read is
  not shippable. The medical access log is excluded outright — a named list of those rows is a
  census of who has disclosed a health condition (`packages/core/src/org-domains.ts:128-129`).

#### 6.12 `ab.rights` — no scope required

```ts
export interface RightsNs {
  /** The whole manifest. Serialisable; this is the React hydration payload. */
  manifest(): Manifest;

  /** Optimistic local check. `on` scopes a `camp:` question to one group. */
  has(scope: Scope, on?: { groupId: string }): boolean;

  /**
   * The server's own refusal sentence, or null when the scope is held.
   * Generated by ONE generator, never a second copy table — see §8.3. NOTE the
   * generator does not take an audience argument today: the real signature is
   * `orgCapabilityRefusal(actor, capability, domain = null): string`
   * (packages/core/src/org-permissions.ts:621-625). Adding the integrator arm is
   * blocking backend work, not an existing API.
   */
  explain(scope: Scope, on?: { groupId: string }): Refusal | null;

  /** Everything the key holds, in vocabulary order. */
  list(): readonly Scope[];

  /** Camp grants, including backstop flags and questionnaire scope objects. */
  camps(): readonly CampGrant[];
}
```

`explain` returns `null` for a held scope and a `Refusal` otherwise — **but only for scopes in the
key's ceiling ∪ the declared tuple.** Refusals are lazy by design: an exhaustive 40-cell prose
array serialised into a browser is the org's domain-ownership map, and department names are the
org chart (`org-domains.ts` `scopeReason` names the owning department out loud). For a scope with
no manifest entry, `explain` returns a generic `{ reason: "not_granted", mode: "notFound" }`.

---

### 7. Pagination, filtering, idempotency, retries, timeouts, cancellation

#### 7.1 Pagination

Cursor-based, opaque, forward-only. **No `total`, no `offset`, no `page` number** — see §6.2.

```ts
export declare function paginate<T, P extends ListParams>(
  fetchPage: (params: P, opts?: RequestOptions) => Promise<Page<T>>,
  params: P,
  opts?: RequestOptions,
): AsyncIterableIterator<T>;
```

```ts
import { paginate } from "@afrikaburn/sdk";

for await (const camp of paginate(
  (p, o) => ab.camps.list(p, o),
  { editionId, limit: 100 },
  { signal },
)) {
  if (camp.registered) console.log(camp.name);
}
```

`paginate` is a standalone function, not a method, so it tree-shakes away when unused. It forwards
its own `opts` (and therefore the `AbortSignal`) to every page fetch and stops on the first
`nextCursor === null`. The signal travels on `RequestOptions`, **not** on the params object —
`ListParams` carries only `cursor` and `limit`.

`limit` is clamped server-side to 100. A cursor is valid for 15 minutes and is bound to the
issuing key; a cursor presented by a different key is `ValidationError`, not a leak.

#### 7.2 Filtering

Filters are explicit named parameters on the params object, never a query-string passthrough and
never a generic `where`. Two reasons: an open filter surface over `groups` would let a caller
probe suppressed rows by binary search on a name prefix; and the emitter's forbidden-field
assertion can only cover a closed set of names.

Filters that would be an existence oracle are absent. There is no `createdBefore` on groups, no
`memberCountGte`, and no free-text search over descriptions — only the normalised-name substring
match `listDirectory` already performs (`apps/web/lib/groups-store.ts:184-192`), applied _after_
the visibility rule, exactly as the store does.

#### 7.3 Idempotency

Every mutating method accepts `opts.idempotencyKey`, a caller-generated string ≤ 255 chars sent as
`Idempotency-Key`. The server records key → response for 24 hours, scoped to
`(apikey.id, method, path)`. A replay returns the stored response with
`X-AfrikaBurn-Idempotent-Replay: true`.

A different body under the same key returns `ConflictError` with `code: "idempotency_mismatch"`.
The SDK does not generate keys automatically: a silently-generated key makes a retry look safe
when the caller has not decided that it is.

The platform never holds or processes money, so idempotency here protects against duplicate
invites, duplicate role assignments and duplicate questionnaire activations — not payments.

#### 7.4 Retries

Default `{ maxRetries: 2, backoff: "full-jitter", baseMs: 200, maxMs: 5_000 }`.

| Condition                                | Retried?                                               |
| ---------------------------------------- | ------------------------------------------------------ |
| Network error, `TransportError`          | Yes, if the request is retryable                       |
| `TimeoutError` on an attempt             | Yes, if the request is retryable                       |
| `429`                                    | Yes, honouring `Retry-After` exactly, ignoring backoff |
| `500`, `502`, `503`, `504`               | Yes                                                    |
| `408`                                    | Yes                                                    |
| `GET` / `HEAD`                           | Always retryable                                       |
| `POST` / `PATCH` / `DELETE`              | Retryable **only** when `idempotencyKey` is set        |
| `400`, `401`, `403`, `404`, `409`, `422` | **Never**                                              |

Rate limiting is keyed on `apikey.id`, not on IP: both existing limiters key on IP
(`packages/db/src/rate-limit.ts` `rateLimitIp`, and better-auth's own `(ip, path)` key), which is
the wrong axis for an integrator on a datacenter NAT. `RateLimitError` carries the limit, the
remaining count and the reset time from the response headers.

Retries never re-fetch the manifest. A `403` is never retried, so a mid-flight rights change
surfaces as a refusal on the next call rather than a silent success on the second attempt.

#### 7.5 Timeouts

Two deadlines. `timeoutMs` (default 15 s) bounds one attempt; `deadlineMs` (default 45 s) bounds
the whole call including retries and is checked before each attempt. Exceeding `timeoutMs` raises
`TimeoutError` for that attempt and may be retried; exceeding `deadlineMs` raises `TimeoutError`
with `phase: "deadline"` and is terminal.

Implemented with an explicit `AbortController` plus `setTimeout`, **not** `AbortSignal.timeout` —
older React Native runtimes lack it, and the manual form keeps the one code path everywhere.

#### 7.6 Cancellation

Pass `opts.signal`. An aborted request **rethrows the signal's `reason` unwrapped** — a native
`DOMException` with `name === "AbortError"` when the caller used `AbortController.abort()` with no
reason. Rationale: wrapping abort in an SDK error class breaks `err.name === "AbortError"`, which
is what every React effect cleanup and every TanStack Query cancellation actually checks.

`signal` composes with the internal timeout controller; whichever fires first wins, and the
resulting error distinguishes them (`AbortError` vs `TimeoutError`).

---

### 8. Error taxonomy

`@afrikaburn/sdk/errors`. All classes extend `AfrikaBurnError`, which extends `Error`.

```ts
export abstract class AfrikaBurnError extends Error {
  /** Stable machine identifier. One code per cause — never overloaded. */
  abstract readonly code: ErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  /** RFC 9457 `type` URI when the response carried problem+json. */
  readonly type?: string;
  readonly docsUrl?: string;
  readonly manifestVersion?: string;
}
```

#### 8.1 The hierarchy

```
AfrikaBurnError
├── ScopeContractError          construction-time: declared ⊄ granted
├── AuthenticationError         401 — key/token invalid, disabled, expired (collapsed)
├── AuthorisationError (abstract)
│   ├── InsufficientScopeError  the KEY does not carry the scope
│   ├── InsufficientRightsError the SUBJECT's live rights refuse it
│   └── RankCeilingError        an engineer-rank carve-out; no role edit can help
├── ManifestDriftError          manifest allowed, server refused — wraps the cause
├── NotFoundError               404, or an existence-privileged refusal
├── ValidationError             400 — request shape, with a JSON pointer
├── PreconditionError           422 — row state refuses (not_submittable, not_editable)
├── ConflictError               409 — unique clash, idempotency mismatch
├── RateLimitError              429
├── ServerError                 5xx
├── TransportError              network/DNS/TLS failure, no HTTP response
│   └── TimeoutError            attempt or deadline exceeded
└── ProtocolError               a 2xx whose body did not match the declared envelope
```

`AbortError` is deliberately absent — §7.6.

#### 8.2 Every code, and when it is thrown

| `code`                 | Class                     | HTTP | Thrown when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope_contract`       | `ScopeContractError`      | —    | Construction: a declared scope is not in the manifest, in dev/CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `unauthenticated`      | `AuthenticationError`     | 401  | Key or token missing, malformed, disabled, expired, or belonging to a suspended integration. **All collapsed into one opaque message** — the distinct `INVALID_API_KEY` / `KEY_DISABLED` / `KEY_EXPIRED` codes better-auth's `apiKey` plugin emits are an enumeration oracle, and sign-in already collapses the same way. (Speculative on the plugin's exact code names: **no api-key plugin is installed in this repo today** — `packages/auth/src/config.ts` configures none and no `apiKey`/`api-key` dependency exists in any workspace.) |
| `insufficient_scope`   | `InsufficientScopeError`  | 403  | The key's ceiling does not carry the scope. Also thrown **locally** by preflight, without a request. Fix: rotate/re-scope the key                                                                                                                                                                                                                                                                                                                                                                                                             |
| `insufficient_rights`  | `InsufficientRightsError` | 403  | The scope is in the ceiling but the live subject's rights refuse. Carries `reason` — `no_roles`, `wrong_department`, `unowned_domain`, `not_granted`, `escalation_clause`, `not_delegated`. Fix: ask an AfrikaBurn operator for a role or a department                                                                                                                                                                                                                                                                                        |
| `rank_ceiling`         | `RankCeilingError`        | 403  | The subject's rank denies it regardless of roles — the engineer carve-outs. Reported **first** among refusals, matching `orgCapabilityRefusal`'s own ordering (`org-permissions.ts:631-633` comment — "The rank ceiling comes FIRST, because for an engineer it is the whole answer" — over the `isRankCarveOut` branch at `:634-638`). Fix: nobody can, by role edit                                                                                                                                                                         |
| `manifest_drift`       | `ManifestDriftError`      | 403  | Preflight passed, server refused. `cause` is the real authorisation error. **Always loud** — this is the self-correcting half of the manifest's failure modes                                                                                                                                                                                                                                                                                                                                                                                 |
| `not_found`            | `NotFoundError`           | 404  | The resource does not exist, or knowing that it exists is privileged. Carries **no** `requiredScopes` field, ever                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `invalid_request`      | `ValidationError`         | 400  | Body/params failed the server's zod input schema. `pointer` is an RFC 6901 JSON pointer; `violations` lists field paths                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `not_submittable`      | `PreconditionError`       | 422  | `isSubmittable` false. `missingSections: SectionKey[]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `not_editable`         | `PreconditionError`       | 422  | Registration status outside the editable set                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `precondition_failed`  | `PreconditionError`       | 422  | Any other row-state refusal, e.g. last-lead protection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `conflict`             | `ConflictError`           | 409  | Unique-name clash (`groups` is unique on `(kind, name_normalized)`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `idempotency_mismatch` | `ConflictError`           | 409  | Same `Idempotency-Key`, different body                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `rate_limited`         | `RateLimitError`          | 429  | Per-key quota exceeded. `retryAfterMs`, `limit`, `remaining`, `resetAt`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `server_error`         | `ServerError`             | 5xx  | Anything the platform did not intend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `transport_error`      | `TransportError`          | —    | No HTTP response: DNS, TLS, socket, CORS preflight                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `timeout`              | `TimeoutError`            | —    | `phase: "attempt" \| "deadline"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `protocol_error`       | `ProtocolError`           | 2xx  | The envelope did not parse, or a required field was absent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Three refusal codes, three different people to go and ask.** That split is the point:
`insufficient_scope` is a key problem (the integrator fixes it), `insufficient_rights` is a
subject problem (an AfrikaBurn operator fixes it), `rank_ceiling` is nobody's problem to fix.
Cloudflare's error 9109 overloads permission-denied with IP restriction and auth-failure lockout;
that is the mistake being avoided.

#### 8.3 Authorisation error shape

```ts
export class InsufficientScopeError extends AuthorisationError {
  readonly code = "insufficient_scope";
  /** The scopes the operation wanted. Never present on a 404. */
  readonly requiredScopes: readonly Scope[];
  /** The server's own sentence. Surfaced verbatim — never re-worded. */
  readonly refusal: Refusal;
  /** Console deep link, when one exists. */
  readonly remediationUrl?: string;
  /** Everything the key does hold. The line that closes the support ticket. */
  readonly heldScopes: readonly Scope[];
}
```

The wire form is RFC 9457 `application/problem+json` plus RFC 6750:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json
WWW-Authenticate: Bearer error="insufficient_scope", scope="org:update:suppliers"
X-AfrikaBurn-Accepted-Scopes: org:update:suppliers
X-AfrikaBurn-Manifest-Version: 2027.04.11-a3f9c1

{
  "type": "https://developers.afrikaburn.org/errors/insufficient-scope",
  "title": "API key lacks a required scope",
  "status": 403,
  "detail": "This key is not authorised to change a supplier's standing.",
  "instance": "/api/v1/org/suppliers/SUP-2027-0416/standing",
  "code": "insufficient_scope",
  "required_scopes": ["org:update:suppliers"],
  "key_id": "qg_live_a3f9c1",
  "remediation_url": "https://org.afrikaburn.org/integrations/qg_live_a3f9c1",
  "request_id": "req_01JQ…"
}
```

**Refusal copy is never written by the SDK.** `Refusal.message` comes from the existing generator
`orgCapabilityRefusal` (`packages/core/src/org-permissions.ts:621-655`), never a second copy
table, for the reason its own comment gives at `:611-615`: a per-capability switch is the shape
that let `manage_camp_categories` exist. **Two changes to that function are required and do not
exist today**: its signature is `(actor: OrgActor | null | undefined, capability: OrgCapability,
domain: OrgDomain | null = null) => string` — there is no fourth `{ audience }` parameter, and it
returns a bare `string`, not a `Refusal` object. Both are blocking backend work; the SDK consumes
`{ audience: "integrator" }` output that a backend change must first produce. The integrator
audience arm is pinned by a test asserting
that no `ORG_DOMAIN_LABELS` value and no department name appears in it — department names are the
org chart.

#### 8.4 `mode` — the existence oracle, and who decides

```ts
export interface Refusal {
  readonly scope: Scope;
  readonly reason:
    | "rank_ceiling"
    | "no_roles"
    | "wrong_department"
    | "unowned_domain"
    | "not_granted"
    | "not_delegated"
    | "key_ceiling";
  readonly message: string;
  /** SERVER-AUTHORED. A client may narrow "explain" to "notFound", never widen. */
  readonly mode: "explain" | "notFound";
  readonly remediationUrl?: string;
}
```

`mode` is chosen by the server, never the client. `mode: "notFound"` means the SDK must render
nothing and must not say why. An integrator writing `degrade="explain"` in the React layer must
not be able to confirm that a free camp exists — `groups-store.ts:187` is the law being protected,
and a helpful sentence is exactly how it would be broken.

#### 8.5 Handling

```ts
import {
  InsufficientScopeError,
  InsufficientRightsError,
  RankCeilingError,
  NotFoundError,
  RateLimitError,
} from "@afrikaburn/sdk/errors";

try {
  await ab.org.suppliers.setStanding("SUP-2027-0416", "watch");
} catch (e) {
  if (e instanceof InsufficientScopeError) {
    // Your key. Rotate it with the scope, or drop the feature.
    console.error(e.refusal.message, e.remediationUrl, e.heldScopes);
  } else if (e instanceof RankCeilingError) {
    // Nobody can fix this by editing a role.
    console.error(e.refusal.message);
  } else if (e instanceof InsufficientRightsError) {
    // Ask AfrikaBurn for a department or a role.
    console.error(e.refusal.message, e.reason);
  } else if (e instanceof NotFoundError) {
    // Do not speculate about why. There is nothing here to tell them.
  } else if (e instanceof RateLimitError) {
    await sleep(e.retryAfterMs);
  } else throw e;
}
```

---

### 9. Typed responses and DTO shapes

Every response body is produced server-side by a **zod output schema whose `.parse()` is the PII
stripper** — `docs/auth-platform-spec.md:626-630`, decision 2, which does not exist today.
`packages/core/src/privacy.ts` is 127 lines and holds the three field-class tuples
(`HARD_LOCKED_PRIVATE_FIELDS`, `SAFETY_VISIBLE_FIELDS`, `ALWAYS_PRIVATE_FIELDS`) plus six
predicates — `isHardLockedPrivate`, `isSafetyVisibleField`, `isAlwaysPrivate`, `canBePublic`,
`enforcePrivacyFlags`, `privacyViolations`. Every one answers a question about a _flag name_;
none of them takes a payload. The nearest thing to a stripper is `publicBioView` at `bio.ts:359`,
which is a public-projection builder over `BurnerBioFields` — not an unconditional stripper.

The SDK ships the **types only**. A field absent from the server's schema cannot be in the body,
in the type, or in the documentation; "someone forgot to call the stripper" becomes inexpressible.
The SDK deliberately does **not** ship a runtime strip function: if it did, integrators would
reasonably believe stripping happens on their side, and the one time a response arrived unstripped
nothing would catch it.

Two build-failing assertions on the emitter, both citing imported constants rather than
hand-retyped lists:

1. A recursive forbidden-field walk over
   `HARD_LOCKED_PRIVATE_FIELDS ∪ SAFETY_VISIBLE_FIELDS ∪ REGISTRATION_CONTACT_KEYS`.
   **Blocking:** the first two are exported from `@quagga/core` and importable today; the third is
   **not** — `REGISTRATION_CONTACT_KEYS` is a module-private `const` in an app
   (`apps/org/lib/queries.ts:952-961`, not exported, not in any package). It has to move into
   `@quagga/core` (or `@quagga/types`) and be re-imported by `queries.ts` before this assertion
   can be written. Re-typing the seven names in the SDK is the exact second-source-of-truth this
   assertion exists to prevent.
2. A ban on `z.any`, `z.unknown`, `z.record` and `.passthrough()` anywhere in a response tree.
   One `z.record()` disables stripping for its whole subtree — a review-invisible one-line PII
   bypass in the exact mechanism the safety argument rests on.

#### 9.1 Public DTOs

```ts
export interface Edition {
  id: string;
  name: string;
  year: number;
  startDate: string; // ISO date
  endDate: string;
  isActive: boolean;
}

export interface Category {
  id: string;
  label: string;
  emoji: string | null;
}

/** Projection of `DirectoryEntry` (apps/web/lib/groups-store.ts:41-53). */
export interface GroupSummary {
  id: string;
  name: string;
  slug: string;
  kind: GroupKind;
  description: string | null;
  joinability: Joinability;
  /** Derived: an approved registration exists this edition (`isRegistered`). */
  registered: boolean;
  memberCount: number;
  /** The key's subject's structural role, or null. Never another burner's. */
  viewerRole: MembershipRole | null;
  categories: readonly Category[];
}
```

Dropped from `GroupSummary` relative to the row: `nameNormalized`, `createdByUserId`,
`visibility` (a reserved column, currently unused — `packages/types/src/groups.ts:38-47`).

```ts
export interface GroupDetail extends GroupSummary {
  registrationStatus: RegistrationStatus | null;
  /** Roster. Never carries email, bio or medical — see below. */
  members: readonly RosterMember[];
  wranglerName: string | null;
}

/**
 * `getCampBySlug`'s member projection (apps/web/lib/groups-store.ts:356-380) —
 * field-for-field the `CampMember` interface at `:209-218`.
 * The comment there is explicit: never select the account email on this list —
 * it renders on the public camp page and email is POPIA-relevant PII. The name
 * comes from the account-level username via `publicMemberName` and falls back to
 * a neutral placeholder, never to email and never to a legal name.
 */
export interface RosterMember {
  membershipId: string;
  userId: string;
  role: MembershipRole;
  refCode: string | null;
  displayName: string;
  isViewer: boolean;
}
```

```ts
/**
 * `PublicBioView` (packages/core/src/bio.ts:331-349) — every field appears only
 * when the owner flagged it public AND `canBePublic` allows it. The always-
 * private classes are not merely nulled here; they are not part of the shape.
 */
export interface PublicBio {
  legalName: string | null;
  homeCity: string | null;
  bio: string | null;
  skills: readonly string[];
  attendedYears: readonly number[];
  firstTime: boolean | null;
  contactEmail: string | null;
  about: string | null;
  campHistory: readonly CampHistoryDisplay[];
  volunteeringInterests: readonly string[];
  volunteeringOther: string | null;
  rangerTraining: boolean;
  rangerCurious: boolean;
  greenDotTraining: boolean;
}

export interface PublicProfile {
  userId: string;
  /** `publicMemberName` — a sanitized account renders the departed-burner stub. */
  displayName: string;
  publicFields: PublicBio;
  /** Linked entries render as camp links only when registered. */
  campHistory: readonly CampHistoryDisplay[];
  /** Registered camps only — free-camp memberships are never broadcast. */
  camps: readonly BurnerCamp[];
}
```

```ts
export interface SupplierSummary {
  id: string;
  name: string;
  code: string;
  category: string | null;
  services: readonly string[];
  website: string | null;
  returning: boolean;
  standing: SupplierStanding; // "good" | "watch" | "suspended"
}

export interface Bulletin {
  id: string;
  title: string;
  body: string;
  publishedAt: string | null;
  pinned: boolean;
}
```

#### 9.2 Delegated DTOs

```ts
export interface RegistrationSummary {
  groupId: string;
  editionId: string;
  status: RegistrationStatus;
  completedSections: readonly SectionKey[];
  /** Form 1 only — `missingSections` (entitlements.ts:64-69). */
  missingSections: readonly SectionKey[];
  missingForm2Sections: readonly SectionKey[];
  isSubmittable: boolean;
  submittedAt: string | null;
  decidedAt: string | null;
}
```

`RegistrationSummary` **strips all seven `REGISTRATION_CONTACT_KEYS`** — the exact set
`loadRegistrationRow` refuses a caller without `personal_information`
(`apps/org/lib/queries.ts:952-961`, applied at `:988-996`):

`s1ContactEmail`, `s1AltContactName`, `s1AltContactPhone`, `s1AltContactEmail`, `s2LntLeadName`,
`s2LntLeadPhone`, `s2LntLeadEmail`.

Note the two NAME columns and `s1ContactEmail` are in that set — an earlier draft of this document
listed only the four phone/email columns, which would have shipped two named third parties.

These seven live on `registrations`, not `burner_bios`, and are therefore outside
`HARD_LOCKED_PRIVATE_FIELDS` entirely — which is precisely why the forbidden-field assertion needs
`REGISTRATION_CONTACT_KEYS` rather than the privacy module. This is the sharpest hole in the whole
surface and it is closed by a build failure, not by a review.

`RegistrationSummary` **additionally** omits `decisionReason` and `decidedByUserId` (reviewer
identity and internal reasoning; not an integrator's business), and `s6FeeStructure` /
`s6ExpectedBudgetZar`. Those last two are an SDK-surface choice, **not** a PII rule: `queries.ts`
is explicit that budget "is the camp's answer, not a person's, and every rank reads it"
(`:950-951`). Do not cite them as contact columns.

```ts
/**
 * `manage_questionnaires` is the scope object or `null`, never a boolean.
 * Captain-kind rows are coerced by `enforceKindPermissions` on every write.
 */
export interface ProjectRole {
  id: string;
  name: string;
  kind: ProjectRoleKind;
  color: RoleColor;
  emoji: string | null;
  permissions: ProjectPermissions;
  officerKey: OfficerKey | null;
  deletable: boolean; // derived from UNDELETABLE_ROLE_KINDS
  renameable: boolean; // derived from RENAMEABLE_ROLE_KINDS
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  /**
   * `{ app, path }`, never the raw column. `notifications.link` is app-relative
   * and meaningless without `link_app` — a proven 404 documented in the schema.
   */
  link: { app: "web" | "org" | "suppliers"; path: string } | null;
}
```

#### 9.3 Fields no DTO carries

| Field(s)                                                                           | Source of the rule                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `phone`, `saId`, `passport`, `onsiteContactName/Phone`, `offsiteContactName/Phone` | `privacy.ts:39-47` — no access path of any kind                                                                                       |
| `medical`, `medicalNotesUnreadable`                                                | `privacy.ts:57`; the tri-state is dropped rather than flattened, because a collapsed all-clear on a safety path is worse than absence |
| Officer `phone` / `contactEmail`                                                   | `officers.ts:196-201` — a per-edition consent scoped to AfrikaBurn org                                                                |
| `users.email` on any roster or list                                                | `groups-store.ts:356-359` (the never-select-email comment over the `getCampBySlug` member projection at `:360-371`)                   |
| `suppliers.contact`                                                                | Free text, frequently a personal mobile                                                                                               |
| `audit_events.meta` beyond an allowlist                                            | Unverified scrubber; allowlist, never blocklist                                                                                       |
| Any `total` count over a suppressible set                                          | Existence oracle — §6.2                                                                                                               |

---

### 10. The transport seam

```ts
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;
```

`url` is a `string`, not `Request | URL`, and `init` is a narrowed literal rather than
`RequestInit`. That is the intersection every runtime in §11 implements identically, and it makes
the seam trivially mockable without a `Request` polyfill.

```ts
const ab = await createServerClient({
  apiKey: KEY,
  fetch: async (url, init) => {
    const started = Date.now();
    const res = await undiciFetch(url, init);
    metrics.observe(url, res.status, Date.now() - started);
    return res;
  },
});
```

There is **no middleware chain**. One override, one place to instrument. A chain is a second
place for a header to be added or removed, and the header set here is load-bearing
(`Authorization`, `Idempotency-Key`, `X-AfrikaBurn-Manifest-Version`).

Reserved request headers — anything matching `x-afrikaburn-*`, plus `authorization`,
`idempotency-key` — are rejected at construction if supplied in `config.headers`. Silently losing
a caller's header is worse than refusing it.

Response headers the SDK reads on **every** response, success included:

| Header                          | Use                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-AfrikaBurn-Accepted-Scopes`  | Fed to `onScopeObserved`. Lets a client build a live scope→endpoint map from ordinary traffic, the way GitHub's `X-Accepted-OAuth-Scopes` does |
| `X-AfrikaBurn-Manifest-Version` | Compared to the held manifest; a mismatch fires `onManifestStale`. This is how a mid-session revocation reaches a rendered UI                  |
| `Retry-After`                   | Honoured exactly on 429                                                                                                                        |
| `ETag` on `/capabilities`       | Conditional refetch; the endpoint answers 304                                                                                                  |

---

### 11. Runtime support

| Target                       | `@afrikaburn/sdk`                        | `/server` | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 20, 22, 24              | yes                                      | yes       | `engines: { node: ">=20" }` declared explicitly — the root workspace's `>=22` does not travel to consumers                                                                                                                                                                                                                                                                                                                                    |
| Browsers (evergreen)         | yes                                      | **no**    | No key handling, no `node:*` import anywhere in the isomorphic entry                                                                                                                                                                                                                                                                                                                                                                          |
| Vercel Edge / Workers / Deno | yes                                      | yes       | Nothing in `/server` uses `node:crypto`: keys are bearer strings hashed server-side, so there is no client-side signing path. (The intended hasher is better-auth's `apiKey` plugin from `better-auth/plugins` — **not yet installed**; `packages/auth/src/config.ts` configures no api-key plugin and there is no `@better-auth/api-key` package in any workspace. better-auth is pinned at `1.6.25` in `packages/auth` and all three apps.) |
| Bun                          | yes                                      | yes       | Global `fetch`, `exports` map honoured                                                                                                                                                                                                                                                                                                                                                                                                        |
| React Native                 | **untested — not in the support matrix** | no        | `fetch` exists, but Metro's `exports`-map support is version-dependent and older runtimes lack `AbortSignal.timeout` (which is why §7.5 uses an explicit controller). An unverified support claim is worse than an absent one; this row moves to "yes" when a test proves it                                                                                                                                                                  |

`/server` carries `import "server-only"` so a Next build fails rather than bundling it into a
client component. That is defence in depth on top of the `exports` map and the eslint
`no-restricted-imports` rule; none of the three is the boundary on its own.

---

### 12. Tree-shaking and subpath exports

```jsonc
// packages/sdk/package.json
{
  "name": "@afrikaburn/sdk",
  "license": "Apache-2.0",
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20" },
  "files": ["dist", "LICENSE", "NOTICE", "README.md"],
  "publishConfig": { "access": "public", "provenance": true },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
    },
    "./server": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.js",
      "require": "./dist/server/index.cjs",
    },
    "./manifest": {
      "types": "./dist/manifest/index.d.ts",
      "import": "./dist/manifest/index.js",
      "require": "./dist/manifest/index.cjs",
    },
    "./errors": {
      "types": "./dist/errors/index.d.ts",
      "import": "./dist/errors/index.js",
      "require": "./dist/errors/index.cjs",
    },
  },
}
```

`"files"` is an allowlist, not an `.npmignore` denylist — a denylist fails open, so the first
server-shaped file someone adds ships by default.

**Licence — architect's call, flagged rather than assumed.** The repo is **FSL-1.1-ALv2**
(`LICENSE`, and `"license": "FSL-1.1-ALv2"` at root `package.json:4`); no `packages/*` manifest
declares a licence of its own today. `"Apache-2.0"` above is this document's _proposal_ for the
published SDK — it is the FSL's own future licence and the only value that makes a client library
usable by third parties, but it is a deliberate divergence from the monorepo's licence and needs
an explicit decision plus a `NOTICE` that says which files it covers. It is not a fact about the
repo.

**Build.** tsdown, extending `packages/typescript-config/node.json` — verified to set
`module: NodeNext`, `moduleResolution: NodeNext`, `noEmit: false`, `outDir: dist`, and verified to
be used by no package today. **Not** `base.json`, whose `moduleResolution: "Bundler"` is correct
for `transpilePackages` and wrong for a published package: it permits extensionless relative
imports that emit unresolvable ESM under Node.

**Shaking properties:**

- Zero runtime dependencies. Nothing to shake that the integrator did not ask for.
- Unbundled output — one emitted module per source module — so a consumer importing only
  `ab.editions` does not pull the org namespace's method table.
- Namespaces are constructed lazily per-property from a generated operation table; each
  namespace's table is its own module.
- `paginate` and every error class are named exports of leaf modules, never re-exported through a
  side-effecting barrel.
- `@afrikaburn/sdk/manifest` is the smallest useful entry: types plus a pure evaluator, no
  transport, no error classes. It is what an RSC imports to type a serialised manifest, and it is
  the seam `@afrikaburn/react` builds on.

**Gate.** `publint && attw --pack` run in the package's `lint` script, so packaging correctness
rides `pnpm turbo run lint typecheck test build` — the CI gate that already exists
(`.github/workflows/ci.yml`) — rather than a job someone has to remember. Note that adding a
`build` script to this package makes `turbo.json`'s `dependsOn: ["^build"]` stop being a no-op: no
`packages/*` workspace has a `build` script today.

**Import-boundary rule.** An eslint `no-restricted-imports` config in `packages/sdk` bans, from the
isomorphic entry: `./server`, `@quagga/db`, `@quagga/auth`, `better-auth`, `drizzle-orm`,
`@neondatabase/serverless`, `next/*`, `server-only`. `@quagga/auth` is banned by name because it
cannot emit declarations at all — its `tsconfig.json` disables `declaration`/`declarationMap`
deliberately, since the passkey plugin's inferred types reference `@simplewebauthn/server` through
pnpm's virtual store (TS2883). It is doubly disqualified, and the ban says so.

---

### 13. What the SDK does not promise

Stated in the README in these words, because otherwise it will be oversold and the first support
ticket will be about a 403 the SDK promised would not happen:

> The manifest eliminates **key-scope** errors, not **authorisation** errors.

The manifest can preflight roughly five of the twelve deny-by-construction rules. The rest are
relationship-level and arrive over the wire: free-camp visibility, questionnaire result-scope
crossing, officer consent, `isEditableStatus`, the escalation clause, and the
`manage_questionnaires` audience sub-algebra. Each has a documented error code in §8.2, and none of
them is a bug when it fires.

The dangerous direction is the false _negative_: the SDK refuses locally, the request never
happens, no telemetry exists, and the integrator concludes the platform is broken. Three
mitigations, all specified above: the manifest TTL is 300 s, matched to the session cookie cache
so there is one staleness story to explain; `preflight: false` is documented at the top of the
README, not buried in an options table; and `X-AfrikaBurn-Manifest-Version` on every response
means a stale manifest announces itself on the next successful call rather than waiting for a
failure.
